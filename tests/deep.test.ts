/**
 * 結合テスト（踏み込み編）— 画面とAPIの食い違い、原子性、同時実行、
 * 表示とデータの一致など、単純な正常系では出てこないところを突く。
 *
 * 使い捨てのデータベースに向けたサーバーに対してのみ実行すること。
 *
 *   BASE_URL=http://localhost:3981 ADMIN_PASSWORD=... \
 *     npx tsx --test --test-concurrency=1 tests/deep.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://localhost:3981";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "qa-password";

let adminCookie = "";

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* CSV や HTML はそのまま */
  }
  return { status: res.status, body: body as never, text, res };
}

const asAdmin = (init: RequestInit = {}) => ({
  ...init,
  headers: { ...(init.headers ?? {}), Cookie: adminCookie },
});

async function login() {
  if (adminCookie) return;
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(res.status, 200, "管理ログインに失敗");
  adminCookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
}

interface InventoryRow {
  id: string;
  product_id: string;
  production_quantity: number;
  reserved_quantity: number;
  is_sold_out: boolean;
  is_hidden: boolean;
  product?: { name: string; is_active: boolean };
}

/** 予約できる受取日と、その日の在庫のある商品を返す。 */
async function bookableDate() {
  const { body } = await api("/api/events");
  const event = body as {
    id: string;
    pickup_time_slots: string;
    event_dates: Array<{ id: string; pickup_date: string; reservation_status: string }>;
  };
  const date = event.event_dates.find((d) => d.reservation_status !== "closed");
  assert.ok(date, "予約できる受取日が1つもない");

  const { body: detail } = await api(`/api/reserve/${date.id}`);
  const inventory = (detail as { inventory: InventoryRow[] }).inventory;
  const rows = inventory.filter(
    (i) => !i.is_sold_out && i.production_quantity > i.reserved_quantity
  );
  assert.ok(rows.length >= 2, "在庫のある商品が2つ以上必要");

  const slots = event.pickup_time_slots
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  return { event, date, rows, slot: slots[0] };
}

function order(
  event_id: string,
  event_date_id: string,
  items: Array<{ product_id: string; quantity: number }>,
  extra: Record<string, unknown> = {}
) {
  return JSON.stringify({
    event_id,
    event_date_id,
    customer_name: "深掘り テスト",
    customer_email: "deep@example.com",
    customer_phone: "090-0000-0000",
    payment_method: "cash",
    items,
    ...extra,
  });
}

/** その日その商品の引当数。 */
async function reserved(dateId: string, productId: string) {
  const { body } = await api(`/api/reserve/${dateId}`);
  const row = (body as { inventory: InventoryRow[] }).inventory.find(
    (i) => i.product_id === productId
  );
  return row?.reserved_quantity ?? -1;
}

/* ============================================== 注文の原子性・整合性 */

test("複数商品のうち1つでも在庫が足りなければ、どの商品の在庫も減らない", async () => {
  const { event, date, rows, slot } = await bookableDate();
  const plenty = rows[0];
  const scarce = rows[1];

  const before = {
    plenty: await reserved(date.id, plenty.product_id),
    scarce: await reserved(date.id, scarce.product_id),
  };

  // 2つ目だけ、確実に足りない数を頼む
  const tooMany = scarce.production_quantity - scarce.reserved_quantity + 1;

  const { status, body } = await api("/api/orders", {
    method: "POST",
    body: order(
      event.id,
      date.id,
      [
        { product_id: plenty.product_id, quantity: 1 },
        { product_id: scarce.product_id, quantity: tooMany },
      ],
      { pickup_time_slot: slot }
    ),
  });

  assert.equal(status, 400);
  assert.ok(
    (body as { details?: string[] }).details?.some((d) => d.includes(scarce.product!.name)),
    "足りない商品の名前が知らされていない"
  );

  assert.equal(
    await reserved(date.id, plenty.product_id),
    before.plenty,
    "通った方の商品の在庫が減ったまま戻っていない"
  );
  assert.equal(await reserved(date.id, scarce.product_id), before.scarce);
});

test("同じ商品を2行に分けて頼むと、合算して1つの引当になる", async () => {
  const { event, date, rows, slot } = await bookableDate();
  const row = rows[0];
  const before = await reserved(date.id, row.product_id);

  const { status } = await api("/api/orders", {
    method: "POST",
    body: order(
      event.id,
      date.id,
      [
        { product_id: row.product_id, quantity: 1 },
        { product_id: row.product_id, quantity: 2 },
      ],
      { pickup_time_slot: slot }
    ),
  });

  assert.equal(status, 201);
  assert.equal(await reserved(date.id, row.product_id), before + 3, "合算されていない");
});

test("存在しない商品IDを混ぜると、注文ごと断られる", async () => {
  const { event, date, rows, slot } = await bookableDate();
  const before = await reserved(date.id, rows[0].product_id);

  const { status } = await api("/api/orders", {
    method: "POST",
    body: order(
      event.id,
      date.id,
      [
        { product_id: rows[0].product_id, quantity: 1 },
        { product_id: "00000000-0000-4000-8000-000000000000", quantity: 1 },
      ],
      { pickup_time_slot: slot }
    ),
  });

  assert.equal(status, 400);
  assert.equal(await reserved(date.id, rows[0].product_id), before, "在庫が減っている");
});

/* ======================================== API のかたちと画面の期待の一致 */

test("予約完了画面が読む項目が、注文APIの返り値に揃っている", async () => {
  const { event, date, rows, slot } = await bookableDate();

  const { status, body } = await api("/api/orders", {
    method: "POST",
    body: order(event.id, date.id, [{ product_id: rows[0].product_id, quantity: 1 }], {
      pickup_time_slot: slot,
    }),
  });
  assert.equal(status, 201);

  const created = body as Record<string, unknown>;
  // 完了画面はこの形を localStorage から読み直して描く
  for (const key of [
    "order_number",
    "total_amount",
    "payment_method",
    "pickup_time_slot",
    "items",
    "event_date",
    "pickup_location",
    "contact_phone",
  ]) {
    assert.ok(key in created, `注文APIの返り値に ${key} が無い`);
  }

  const items = created.items as Array<Record<string, unknown>>;
  assert.ok(items.length > 0, "明細が空");
  for (const key of ["product_name_snapshot", "unit_price", "quantity", "subtotal"]) {
    assert.ok(key in items[0], `明細に ${key} が無い`);
  }

  const eventDate = created.event_date as Record<string, unknown>;
  assert.ok("pickup_date" in eventDate, "受取日が返っていない");
});

test("ダッシュボードが読む集計の形が、APIの返り値と一致している", async () => {
  await login();
  const { status, body } = await api("/api/admin/dashboard", asAdmin());
  assert.equal(status, 200);

  const data = body as {
    dates: Array<{ id: string; pickup_date: string }>;
    today: string;
    summary?: {
      total_sales: number;
      today_reservations: number;
      today_picked_up: number;
      by_date: Array<{ event_date_id: string; order_count: number; total_amount: number }>;
    };
    lowStockItems: unknown[];
    zeroCapacity: unknown[];
    stuckOrders: unknown[];
  };

  assert.ok(data.summary, "summary が無い（画面は全件取得をやめてこれを読む）");
  for (const key of ["total_sales", "today_reservations", "today_picked_up", "by_date"]) {
    assert.ok(key in data.summary!, `summary に ${key} が無い`);
  }
  assert.ok(Array.isArray(data.summary!.by_date), "by_date が配列でない");
  assert.ok(Array.isArray(data.stuckOrders), "stuckOrders が配列でない");

  // 数値であること（NaN や null が混ざると画面が崩れる）
  assert.equal(typeof data.summary!.total_sales, "number");
  assert.ok(Number.isFinite(data.summary!.total_sales));
  for (const row of data.summary!.by_date) {
    assert.ok(Number.isFinite(row.order_count), "order_count が数値でない");
    assert.ok(Number.isFinite(row.total_amount), "total_amount が数値でない");
  }

  // 集計の対象日が、返ってきた受取日の中にあること
  const dateIds = new Set(data.dates.map((d) => d.id));
  for (const row of data.summary!.by_date) {
    assert.ok(dateIds.has(row.event_date_id), "集計に知らない受取日が混じっている");
  }
});

test("ダッシュボードの日別集計が、注文を1件足すと1件ぶん増える", async () => {
  await login();
  const { event, date, rows, slot } = await bookableDate();

  const read = async () => {
    const { body } = await api("/api/admin/dashboard", asAdmin());
    const s = (body as { summary: { by_date: Array<{ event_date_id: string; order_count: number; total_amount: number }> } })
      .summary.by_date.find((d) => d.event_date_id === date.id);
    return { count: s?.order_count ?? 0, amount: s?.total_amount ?? 0 };
  };

  const before = await read();

  const { status, body } = await api("/api/orders", {
    method: "POST",
    body: order(event.id, date.id, [{ product_id: rows[0].product_id, quantity: 1 }], {
      pickup_time_slot: slot,
    }),
  });
  assert.equal(status, 201);
  const total = (body as { total_amount: number }).total_amount;

  const after = await read();
  assert.equal(after.count, before.count + 1, "件数が増えていない");
  assert.equal(after.amount, before.amount + total, "金額が合っていない");
});

test("注文一覧の明細に、画面とCSVが使う項目が揃っている", async () => {
  await login();
  const { status, body } = await api("/api/admin/orders", asAdmin());
  assert.equal(status, 200);

  const orders = (body as { orders: Array<{ order_items: Array<Record<string, unknown>>; event_date?: Record<string, unknown> }> }).orders;
  assert.ok(orders.length > 0, "注文が1件も無い状態ではこのテストができない");

  const withItems = orders.find((o) => o.order_items.length > 0);
  assert.ok(withItems, "明細を持つ注文が無い");

  // 画面は product_name_snapshot を読む。商品マスタの同梱をやめたので、
  // ここが欠けると注文一覧の中身が空欄になる。
  for (const key of ["product_name_snapshot", "quantity", "unit_price", "subtotal"]) {
    assert.ok(key in withItems!.order_items[0], `明細に ${key} が無い`);
  }
  assert.ok(withItems!.event_date?.pickup_date, "受取日が同梱されていない");
});

/* ================================================ お客様に見せないもの */

test("取り下げた商品・非公開にした在庫は、お客様側に出ない", async () => {
  await login();
  const { date } = await bookableDate();

  const { body: before } = await api(`/api/reserve/${date.id}`);
  const visibleBefore = (before as { inventory: InventoryRow[] }).inventory;
  assert.ok(visibleBefore.length > 1, "商品が2つ以上必要");

  const target = visibleBefore[0];

  // 非公開にする
  const { status: patched } = await api(
    "/api/admin/inventory",
    asAdmin({
      method: "PATCH",
      body: JSON.stringify({
        items: [
          {
            id: target.id,
            production_quantity: target.production_quantity,
            is_sold_out: target.is_sold_out,
            is_hidden: true,
          },
        ],
      }),
    })
  );
  assert.equal(patched, 200);

  try {
    const { body: after } = await api(`/api/reserve/${date.id}`);
    const visibleAfter = (after as { inventory: InventoryRow[] }).inventory;
    assert.ok(
      !visibleAfter.some((i) => i.id === target.id),
      "非公開にした商品がお客様側に残っている"
    );

    // URL を直接叩いても買えないこと
    const { event, slot } = await bookableDate();
    const { status } = await api("/api/orders", {
      method: "POST",
      body: order(event.id, date.id, [{ product_id: target.product_id, quantity: 1 }], {
        pickup_time_slot: slot,
      }),
    });
    assert.equal(status, 400, "非公開の商品が買えてしまう");
  } finally {
    await api(
      "/api/admin/inventory",
      asAdmin({
        method: "PATCH",
        body: JSON.stringify({
          items: [
            {
              id: target.id,
              production_quantity: target.production_quantity,
              is_sold_out: target.is_sold_out,
              is_hidden: false,
            },
          ],
        }),
      })
    );
  }
});

/* ==================================================== 受取管理・CSV */

test("受取管理に出るのは当日の確定分だけ", async () => {
  await login();
  const { status, body } = await api("/api/admin/pickup", asAdmin());
  assert.equal(status, 200);

  const data = body as {
    today: string;
    event_date: { pickup_date: string } | null;
    orders: Array<{ order_status: string; event_date_id?: string }>;
  };

  if (data.event_date) {
    assert.equal(data.event_date.pickup_date, data.today, "当日以外の受取日が選ばれている");
  } else {
    assert.equal(data.orders.length, 0, "受取日が無いのに注文が返っている");
  }

  for (const o of data.orders) {
    assert.equal(o.order_status, "confirmed", "確定していない注文が受取管理に出ている");
  }
});

test("CSVの行数と中身が、注文一覧と食い違わない", async () => {
  await login();
  const { body: listBody } = await api("/api/admin/orders", asAdmin());
  const orders = (listBody as { orders: Array<{ order_number: string }> }).orders;

  const res = await fetch(`${BASE}/api/admin/orders/csv`, { headers: { Cookie: adminCookie } });
  assert.equal(res.status, 200);

  // BOM は fetch().text() が食べてしまうので、生のバイト列で見る
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual(
    [...bytes.slice(0, 3)],
    [0xef, 0xbb, 0xbf],
    "BOM が無い（Excel で開くと文字化けする）"
  );

  const csv = new TextDecoder().decode(bytes);
  for (const o of orders.slice(0, 20)) {
    assert.ok(csv.includes(o.order_number), `CSV に ${o.order_number} が無い`);
  }
});

/* ================================================== 同時実行・取り合い */

test("在庫の保存と注文が同時に来ても、どちらかが壊れた形で終わらない", async () => {
  await login();
  const { event, date, rows, slot } = await bookableDate();
  const row = rows[0];
  const before = await reserved(date.id, row.product_id);

  // 受付上限を1つ上げる保存と、1つ買う注文を同時に投げる
  const [saved, bought] = await Promise.all([
    api(
      "/api/admin/inventory",
      asAdmin({
        method: "PATCH",
        body: JSON.stringify({
          items: [
            {
              id: row.id,
              production_quantity: row.production_quantity + 1,
              is_sold_out: false,
              is_hidden: false,
            },
          ],
        }),
      })
    ),
    api("/api/orders", {
      method: "POST",
      body: order(event.id, date.id, [{ product_id: row.product_id, quantity: 1 }], {
        pickup_time_slot: slot,
      }),
    }),
  ]);

  // どちらも 500（デッドロックや制約違反の素通し）で終わっていないこと
  assert.notEqual(saved.status, 500, "在庫保存が 500 で落ちた");
  assert.notEqual(bought.status, 500, "注文が 500 で落ちた");
  assert.ok([200, 409].includes(saved.status), `在庫保存が ${saved.status}`);
  assert.ok([201, 400].includes(bought.status), `注文が ${bought.status}`);

  const after = await reserved(date.id, row.product_id);
  assert.equal(
    after,
    bought.status === 201 ? before + 1 : before,
    "注文の結果と引当数が食い違っている"
  );
});

/* ============================================ 二重送信まわりの境界 */

test("取り消された注文の送信IDは解放され、同じIDでもう一度注文できる", async () => {
  await login();
  const { event, date, rows, slot } = await bookableDate();
  const requestId = `test-release-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const first = await api("/api/orders", {
    method: "POST",
    body: order(event.id, date.id, [{ product_id: rows[0].product_id, quantity: 1 }], {
      pickup_time_slot: slot,
      client_request_id: requestId,
    }),
  });
  assert.equal(first.status, 201);
  const orderId = (first.body as { id: string }).id;

  const { status: cancelled } = await api(
    `/api/admin/orders/${orderId}/cancel`,
    asAdmin({ method: "PATCH" })
  );
  assert.equal(cancelled, 200);

  const retry = await api("/api/orders", {
    method: "POST",
    body: order(event.id, date.id, [{ product_id: rows[0].product_id, quantity: 1 }], {
      pickup_time_slot: slot,
      client_request_id: requestId,
    }),
  });
  assert.equal(retry.status, 201, "取り消し後に同じIDで注文し直せない");
  assert.notEqual(
    (retry.body as { order_number: string }).order_number,
    (first.body as { order_number: string }).order_number,
    "取り消した注文がそのまま返っている"
  );
});

test("送信IDが無くても普通に注文できる（古いブラウザ・直接呼び出し）", async () => {
  const { event, date, rows, slot } = await bookableDate();

  const a = await api("/api/orders", {
    method: "POST",
    body: order(event.id, date.id, [{ product_id: rows[0].product_id, quantity: 1 }], {
      pickup_time_slot: slot,
    }),
  });
  const b = await api("/api/orders", {
    method: "POST",
    body: order(event.id, date.id, [{ product_id: rows[0].product_id, quantity: 1 }], {
      pickup_time_slot: slot,
    }),
  });

  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.notEqual(
    (a.body as { order_number: string }).order_number,
    (b.body as { order_number: string }).order_number,
    "別々の注文が同じものとして扱われている"
  );
});

/* ========================================================= 壊れた入力 */

test("おかしなIDを渡しても 500 にならない", async () => {
  const cases = [
    "/api/reserve/not-a-uuid",
    "/api/reserve/00000000-0000-4000-8000-000000000000",
    "/api/images/not-a-uuid",
    "/api/images/00000000-0000-4000-8000-000000000000",
  ];

  for (const path of cases) {
    const { status } = await api(path);
    assert.ok(status < 500, `${path} が ${status} を返した`);
  }
});

test("管理APIにおかしなIDを渡しても 500 にならない", async () => {
  await login();
  for (const path of [
    "/api/admin/orders/not-a-uuid/cancel",
    "/api/admin/orders/00000000-0000-4000-8000-000000000000/cancel",
    "/api/admin/orders/not-a-uuid/pickup",
  ]) {
    const { status } = await api(
      path,
      asAdmin({ method: "PATCH", body: JSON.stringify({ pickup_status: "picked_up" }) })
    );
    assert.ok(status < 500, `${path} が ${status} を返した`);
  }
});

test("注文の本文が配列やnullでも 400 で止まる", async () => {
  for (const body of ["[]", "null", '"文字列"', "123"]) {
    const res = await fetch(`${BASE}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    assert.ok(res.status === 400, `${body} で ${res.status}`);
  }
});

/* ================================================== 画像の取り回し */

test("商品画像は長期キャッシュされ、型が正しく返る", async () => {
  await login();

  // 1x1 の PNG
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    ),
    (c) => c.charCodeAt(0)
  );
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "dot.png");

  const upload = await fetch(`${BASE}/api/admin/images`, {
    method: "POST",
    headers: { Cookie: adminCookie },
    body: form,
  });
  assert.equal(upload.status, 201);
  const { url } = (await upload.json()) as { url: string };

  const got = await fetch(`${BASE}${url}`);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("content-type"), "image/png");
  assert.match(
    got.headers.get("cache-control") ?? "",
    /max-age=\d{6,}/,
    "画像が長期キャッシュされていない"
  );
});
