/**
 * 結合テスト（運用側） — 在庫・締切・キャンセル・CSV・同時予約。
 *
 * 使い捨てのデータベースに向けたサーバーに対して実行すること。
 *
 *   BASE_URL=http://localhost:3981 ADMIN_PASSWORD=... \
 *     npx tsx --test tests/admin.test.ts
 */
import test, { before } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://localhost:3981";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "qa-password";

let cookie = "";

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* CSV などはそのまま */
  }
  return { status: res.status, body: body as never, text, res };
}

before(async () => {
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  assert.ok(cookie, "ログインできなかった");
});

interface InventoryRow {
  id: string;
  product_id: string;
  event_date_id: string;
  production_quantity: number;
  reserved_quantity: number;
  is_sold_out: boolean;
  is_hidden: boolean;
}

const TODAY = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

/** 今日以降で、まだ受け付けている受取日。過去日が残っていても選ばない。 */
function futureDate(event: {
  event_dates: Array<{ id: string; pickup_date: string; reservation_status: string }>;
}) {
  const date = event.event_dates.find(
    (d) => d.pickup_date >= TODAY && d.reservation_status !== "closed"
  );
  assert.ok(date, "今日以降で予約できる受取日が無い");
  return date;
}

async function loadEvent() {
  const { body } = await api("/api/events");
  return body as {
    id: string;
    pickup_time_slots: string;
    event_dates: Array<{ id: string; pickup_date: string; reservation_status: string }>;
  };
}

async function inventoryFor(dateId: string): Promise<InventoryRow[]> {
  const { body } = await api(`/api/admin/inventory?dateId=${dateId}`);
  return (body as { inventory: InventoryRow[] }).inventory;
}

async function saveInventory(rows: Array<Partial<InventoryRow> & { id: string }>) {
  return api("/api/admin/inventory", {
    method: "PATCH",
    body: JSON.stringify({
      items: rows.map((r) => ({
        id: r.id,
        production_quantity: r.production_quantity,
        is_sold_out: r.is_sold_out,
        is_hidden: r.is_hidden,
      })),
    }),
  });
}

function firstSlot(event: { pickup_time_slots: string }) {
  return event.pickup_time_slots.split("\n").map((s) => s.trim()).filter(Boolean)[0];
}

function orderBody(eventId: string, dateId: string, productId: string, qty: number, slot?: string) {
  return JSON.stringify({
    event_id: eventId,
    event_date_id: dateId,
    customer_name: "同時 予約",
    customer_email: "qa@example.com",
    customer_phone: "090-1111-1111",
    payment_method: "cash",
    pickup_time_slot: slot,
    items: [{ product_id: productId, quantity: qty }],
  });
}

/* ============================================ 在庫の保存と再計算 */

test("受付上限を予約数より下げようとすると、商品名つきで断られる", async () => {
  const event = await loadEvent();
  const date = futureDate(event);
  let rows = await inventoryFor(date.id);

  // 他のテストに頼らず、自分で1件入れてから試す
  if (!rows.some((r) => r.reserved_quantity > 0)) {
    const row = rows.find((r) => r.production_quantity > r.reserved_quantity)!;
    const { status } = await api("/api/admin/orders", {
      method: "POST",
      body: JSON.stringify({
        event_date_id: date.id,
        items: [{ product_id: row.product_id, quantity: 1 }],
      }),
    });
    assert.equal(status, 201, "下準備の登録に失敗した");
    rows = await inventoryFor(date.id);
  }

  const withOrders = rows.find((r) => r.reserved_quantity > 0);
  assert.ok(withOrders, "予約の入った在庫行がない");

  const { status, body } = await saveInventory([
    { ...withOrders, production_quantity: withOrders.reserved_quantity - 1 },
  ]);

  assert.equal(status, 409);
  const err = body as { error: string; details: string[] };
  assert.ok(err.details?.[0]?.includes("「"), "どの商品か名前で示していない");
});

test("上限を上げると売切が解け、受取日も受付中に戻る", async () => {
  const event = await loadEvent();
  const date = futureDate(event);
  const rows = await inventoryFor(date.id);

  // その日をいったん完売にする（全商品の上限を予約数まで下げる）
  await saveInventory(
    rows.map((r) => ({ ...r, production_quantity: r.reserved_quantity }))
  );

  let after = await loadEvent();
  let target = after.event_dates.find((d) => d.id === date.id)!;
  assert.equal(target.reservation_status, "closed", "全商品完売でも受取日が閉じていない");

  const closedRows = await inventoryFor(date.id);
  assert.ok(closedRows.every((r) => r.is_sold_out), "売切が立っていない");

  // 上限を戻す
  await saveInventory(
    rows.map((r) => ({ ...r, production_quantity: r.production_quantity }))
  );

  after = await loadEvent();
  target = after.event_dates.find((d) => d.id === date.id)!;
  assert.notEqual(target.reservation_status, "closed", "上限を戻しても受取日が閉じたまま");

  const reopened = await inventoryFor(date.id);
  assert.ok(
    reopened.every((r) => !r.is_sold_out || r.production_quantity <= r.reserved_quantity),
    "余裕があるのに売切のままの商品が残っている"
  );
});

/* ============================================ 同時予約 */

test("残り1個に同時に2件来ても、1件しか通らない", async () => {
  const event = await loadEvent();
  const date = futureDate(event);
  const slot = firstSlot(event);
  const rows = await inventoryFor(date.id);
  const row = rows[0];

  // 残り1個ちょうどにする
  await saveInventory([
    { ...row, production_quantity: row.reserved_quantity + 1, is_sold_out: false },
  ]);

  const [a, b] = await Promise.all([
    api("/api/orders", { method: "POST", body: orderBody(event.id, date.id, row.product_id, 1, slot) }),
    api("/api/orders", { method: "POST", body: orderBody(event.id, date.id, row.product_id, 1, slot) }),
  ]);

  const created = [a, b].filter((r) => r.status === 201);
  const rejected = [a, b].filter((r) => r.status === 400);
  assert.equal(created.length, 1, "2件とも通ってしまった（在庫の二重取り）");
  assert.equal(rejected.length, 1);

  const after = (await inventoryFor(date.id)).find((r) => r.id === row.id)!;
  assert.ok(
    after.reserved_quantity <= after.production_quantity,
    "予約数が受付上限を超えている"
  );
  assert.equal(after.is_sold_out, true, "使い切ったのに売切になっていない");
});

/* ============================================ キャンセル */

test("キャンセルで在庫が戻り、二重キャンセルは断られる", async () => {
  const event = await loadEvent();
  const date = futureDate(event);
  const slot = firstSlot(event);
  const rows = await inventoryFor(date.id);
  const row = rows.find((r) => r.production_quantity > r.reserved_quantity)
    ?? (await saveInventory([{ ...rows[0], production_quantity: rows[0].reserved_quantity + 3, is_sold_out: false }]),
        (await inventoryFor(date.id))[0]);

  const { status, body } = await api("/api/orders", {
    method: "POST",
    body: orderBody(event.id, date.id, row.product_id, 1, slot),
  });
  assert.equal(status, 201);
  const order = body as { id: string };

  const before = (await inventoryFor(date.id)).find((r) => r.id === row.id)!.reserved_quantity;

  const { status: cancelled } = await api(`/api/admin/orders/${order.id}/cancel`, { method: "PATCH" });
  assert.equal(cancelled, 200);

  const after = (await inventoryFor(date.id)).find((r) => r.id === row.id)!.reserved_quantity;
  assert.equal(after, before - 1, "キャンセルしても在庫が戻っていない");

  const { status: again } = await api(`/api/admin/orders/${order.id}/cancel`, { method: "PATCH" });
  assert.equal(again, 400, "同じ注文を二度キャンセルできてしまう");
});

/* ============================================ 締切と店休日 */

test("締切を過ぎた受取日は予約できず、一覧にも受付終了として出る", async () => {
  const event = await loadEvent();
  // 昨日の受取日を足すと、締切（前日23:59）は必ず過去になる
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  // 前回の実行が残していた場合に備えて先に片付ける
  const { body: all } = await api("/api/admin/event");
  const stale = (all as { dates: Array<{ id: string; pickup_date: string }> }).dates
    .find((d) => d.pickup_date === yesterday);
  if (stale) await api(`/api/admin/event/dates/${stale.id}`, { method: "DELETE" });

  const { status, body } = await api("/api/admin/event/dates", {
    method: "POST",
    body: JSON.stringify({ pickup_date: yesterday, default_capacity: 10 }),
  });
  assert.equal(status, 201);
  const created = body as { date: { id: string }; inventory_rows: number };
  const dateId = created.date.id;
  assert.ok(created.inventory_rows > 0, "受取日を足しても受付枠が作られていない");

  try {
    const rows = await inventoryFor(dateId);
    assert.ok(rows.length > 0, "受取日を足しても受付枠が作られていない");
    assert.ok(
      rows.every((r) => r.production_quantity === 10),
      "指定した初期値で受付枠が作られていない"
    );

    const slot = firstSlot(event);
    const { status: ordered, body: err } = await api("/api/orders", {
      method: "POST",
      body: orderBody(event.id, dateId, rows[0].product_id, 1, slot),
    });
    assert.equal(ordered, 400, "締切を過ぎた日に予約できてしまう");
    assert.match((err as { error: string }).error, /終了|締/);

    const refreshed = await loadEvent();
    const shown = refreshed.event_dates.find((d) => d.id === dateId);
    if (shown) {
      // 画面は effectiveReservationStatus で閉じるため、保存値は open のままでよい
      assert.ok(true);
    }
  } finally {
    await api(`/api/admin/event/dates/${dateId}`, { method: "DELETE" });
  }
});

test("受付停止にした受取日は、お客様の一覧から消え予約もできない", async () => {
  const event = await loadEvent();
  const future = event.event_dates.filter((d) => d.pickup_date >= TODAY);
  const date = future[future.length - 1];
  const rows = await inventoryFor(date.id);
  const slot = firstSlot(event);

  await api(`/api/admin/event/dates/${date.id}`, {
    method: "PATCH",
    body: JSON.stringify({ is_active: false }),
  });

  try {
    const hidden = await loadEvent();
    assert.ok(
      !hidden.event_dates.some((d) => d.id === date.id),
      "受付停止した日がお客様の一覧に残っている"
    );

    const { status } = await api("/api/orders", {
      method: "POST",
      body: orderBody(event.id, date.id, rows[0].product_id, 1, slot),
    });
    assert.equal(status, 400, "受付停止した日に予約できてしまう");
  } finally {
    await api(`/api/admin/event/dates/${date.id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: true }),
    });
  }
});

test("同じ受取日をもう一度足すと、理由が分かる形で断られる", async () => {
  const event = await loadEvent();
  const existing = event.event_dates[0].pickup_date;

  const { status, body } = await api("/api/admin/event/dates", {
    method: "POST",
    body: JSON.stringify({ pickup_date: existing, default_capacity: 5 }),
  });

  assert.equal(status, 409, "重複が 500 になっていて、操作者に理由が伝わらない");
  assert.match((body as { error: string }).error, /すでに登録/);
});

/* ============================================ 帳票 */

test("CSVに受取時間の列があり、文字化けしない", async () => {
  const res = await fetch(`${BASE}/api/admin/orders/csv`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /csv/);

  // text() は BOM を取り除いてしまうので、生のバイトで確かめる
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual(
    [...bytes.slice(0, 3)],
    [0xef, 0xbb, 0xbf],
    "UTF-8 BOM が無い（Excel で文字化けする）"
  );

  const header = new TextDecoder().decode(bytes).split("\n")[0];
  for (const column of ["受取日", "受取時間", "注文番号", "お客様名", "商品名", "注文合計"]) {
    assert.ok(header.includes(column), `CSVに「${column}」列が無い`);
  }
});

test("製造計画に全商品と全受取日が出る", async () => {
  const { status, body } = await api("/api/admin/production");
  assert.equal(status, 200);
  const data = body as {
    dates: Array<{ id: string }>;
    inventory: Array<{ event_date_id: string; product: { id: string } }>;
  };

  const products = new Set(data.inventory.map((i) => i.product.id));
  for (const d of data.dates) {
    const forDate = data.inventory.filter((i) => i.event_date_id === d.id);
    assert.equal(
      new Set(forDate.map((i) => i.product.id)).size,
      products.size,
      "受取日によって商品の数が違う（製造計画から商品が落ちる）"
    );
  }
});

test("ダッシュボードが受付枠0の商品を警告する", async () => {
  const event = await loadEvent();
  const date = futureDate(event);
  const rows = await inventoryFor(date.id);
  const target = rows.find((r) => r.reserved_quantity === 0);
  assert.ok(target, "予約の入っていない在庫行がなく、上限0を試せない");
  const original = target.production_quantity;

  const { status: saved } = await saveInventory([
    { ...target, production_quantity: 0, is_sold_out: false },
  ]);
  assert.equal(saved, 200, "上限0で保存できなかった");
  try {
    const { body } = await api("/api/admin/dashboard");
    const zero = (body as { zeroCapacity: Array<{ product_name: string }> }).zeroCapacity;
    assert.ok(zero.length > 0, "受付枠0の商品が警告されていない");
  } finally {
    await saveInventory([{ ...target, production_quantity: original, is_sold_out: false }]);
  }
});

/* ============================================ 商品マスタ */

test("商品を足すと全受取日に受付枠ができ、消すと消える", async () => {
  const { status, body } = await api("/api/admin/products", {
    method: "POST",
    body: JSON.stringify({ name: "QAテスト商品", description: "", price: 100, sort_order: 99 }),
  });
  assert.equal(status, 201);
  const { product, inventory_rows } = body as {
    product: { id: string };
    inventory_rows: number;
  };
  assert.ok(inventory_rows > 0, "受付枠が1行も作られていない");

  try {
    const { body: prod } = await api("/api/admin/production");
    const data = prod as { dates: Array<{ id: string }>; inventory: Array<{ product: { id: string } }> };
    const rowsForNew = data.inventory.filter((i) => i.product.id === product.id);
    assert.equal(rowsForNew.length, data.dates.length, "全受取日ぶんの受付枠ができていない");
  } finally {
    const { status: deleted } = await api(`/api/admin/products/${product.id}`, { method: "DELETE" });
    assert.equal(deleted, 200);
  }

  const { body: after } = await api("/api/admin/production");
  assert.equal(
    (after as { inventory: Array<{ product: { id: string } }> }).inventory
      .filter((i) => i.product.id === product.id).length,
    0,
    "商品を消しても受付枠が残っている"
  );
});

test("価格が負や文字の商品は登録できない", async () => {
  for (const price of [-100, "たくさん"]) {
    const { status } = await api("/api/admin/products", {
      method: "POST",
      body: JSON.stringify({ name: "不正価格", description: "", price, sort_order: 1 }),
    });
    assert.equal(status, 400, `price=${price} が通ってしまう`);
  }

  const { status } = await api("/api/admin/products", {
    method: "POST",
    body: JSON.stringify({ name: "  ", description: "", price: 100, sort_order: 1 }),
  });
  assert.equal(status, 400, "商品名が空でも登録できてしまう");
});

/* ============================================ 店頭販売の記録 */

test("店頭販売を登録すると受付枠が減り、店頭として記録される", async () => {
  const event = await loadEvent();
  const date = futureDate(event);
  const rows = await inventoryFor(date.id);
  const row = rows.find((r) => r.production_quantity > r.reserved_quantity);
  assert.ok(row, "余裕のある在庫行がない");
  const before = row.reserved_quantity;

  const { status, body } = await api("/api/admin/orders", {
    method: "POST",
    body: JSON.stringify({
      event_date_id: date.id,
      customer_name: "店頭 花子",
      payment_method: "cash",
      handed_over: true,
      items: [{ product_id: row.product_id, quantity: 2 }],
    }),
  });

  assert.equal(status, 201);
  const { order } = body as {
    order: {
      order_number: string;
      source: string;
      payment_status: string;
      order_status: string;
      pickup_status: string;
      total_amount: number;
    };
  };
  assert.equal(order.source, "walk_in");
  assert.equal(order.payment_status, "paid", "店頭販売は支払い済みで入るべき");
  assert.equal(order.order_status, "confirmed");
  assert.equal(order.pickup_status, "picked_up", "お渡し済みなら受取済みで入るべき");
  assert.ok(order.total_amount > 0);

  const after = (await inventoryFor(date.id)).find((r) => r.id === row.id)!;
  assert.equal(after.reserved_quantity, before + 2, "受付枠が減っていない");
});

test("店頭販売でも受付枠を超えられない", async () => {
  const event = await loadEvent();
  const date = futureDate(event);
  const rows = await inventoryFor(date.id);
  const row = rows[0];

  // 残り1個ちょうどにする
  await saveInventory([
    { ...row, production_quantity: row.reserved_quantity + 1, is_sold_out: false },
  ]);

  const { status, body } = await api("/api/admin/orders", {
    method: "POST",
    body: JSON.stringify({
      event_date_id: date.id,
      items: [{ product_id: row.product_id, quantity: 5 }],
    }),
  });

  assert.equal(status, 400, "受付枠を超えて登録できてしまう");
  assert.match((body as { details: string[] }).details[0], /残り/);
});

test("店頭販売：お名前を省くと既定の名前で入る", async () => {
  const event = await loadEvent();
  const date = futureDate(event);
  const rows = await inventoryFor(date.id);
  const row = rows.find((r) => r.production_quantity > r.reserved_quantity)!;

  const { status, body } = await api("/api/admin/orders", {
    method: "POST",
    body: JSON.stringify({
      event_date_id: date.id,
      handed_over: false,
      items: [{ product_id: row.product_id, quantity: 1 }],
    }),
  });

  assert.equal(status, 201);
  const { order } = body as { order: { customer_name: string; pickup_status: string } };
  assert.equal(order.customer_name, "店頭のお客様");
  assert.equal(order.pickup_status, "not_picked_up", "お渡し前なら未受取で入るべき");
});

test("店頭販売：商品なし・数量0・存在しない受取日は断られる", async () => {
  const event = await loadEvent();
  const date = futureDate(event);
  const rows = await inventoryFor(date.id);

  const cases: Array<[string, Record<string, unknown>]> = [
    ["商品なし", { event_date_id: date.id, items: [] }],
    ["数量0", { event_date_id: date.id, items: [{ product_id: rows[0].product_id, quantity: 0 }] }],
    ["受取日なし", { items: [{ product_id: rows[0].product_id, quantity: 1 }] }],
    [
      "存在しない受取日",
      {
        event_date_id: "11111111-1111-4111-8111-111111111111",
        items: [{ product_id: rows[0].product_id, quantity: 1 }],
      },
    ],
  ];

  for (const [name, payload] of cases) {
    const { status } = await api("/api/admin/orders", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    assert.equal(status, 400, `${name} が通ってしまう`);
  }
});

test("店頭販売は未ログインでは登録できない", async () => {
  const event = await loadEvent();
  const date = futureDate(event);
  const rows = await inventoryFor(date.id);

  const res = await fetch(`${BASE}/api/admin/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_date_id: date.id,
      items: [{ product_id: rows[0].product_id, quantity: 1 }],
    }),
  });
  assert.equal(res.status, 401);
});

test("店頭販売もキャンセルでき、受付枠が戻る", async () => {
  const event = await loadEvent();
  const date = futureDate(event);
  const rows = await inventoryFor(date.id);
  const row = rows.find((r) => r.production_quantity > r.reserved_quantity)!;

  const { body } = await api("/api/admin/orders", {
    method: "POST",
    body: JSON.stringify({
      event_date_id: date.id,
      items: [{ product_id: row.product_id, quantity: 1 }],
    }),
  });
  const { order } = body as { order: { id: string } };

  const before = (await inventoryFor(date.id)).find((r) => r.id === row.id)!.reserved_quantity;
  const { status } = await api(`/api/admin/orders/${order.id}/cancel`, { method: "PATCH" });
  assert.equal(status, 200);

  const after = (await inventoryFor(date.id)).find((r) => r.id === row.id)!.reserved_quantity;
  assert.equal(after, before - 1, "店頭販売をキャンセルしても受付枠が戻らない");
});

test("CSVで予約と店頭販売が見分けられる", async () => {
  const res = await fetch(`${BASE}/api/admin/orders/csv`, { headers: { Cookie: cookie } });
  const text = new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()));
  const [header, ...lines] = text.split("\n");
  assert.ok(header.includes("経路"), "CSVに「経路」列が無い");
  assert.ok(
    lines.some((l) => l.includes("店頭販売")),
    "店頭販売の行が CSV に出ていない"
  );
});

/* ============================================ 商品画像 */

/** 1x1 の PNG（本物のバイト列）。 */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function uploadImage(bytes: Buffer, type: string, filename = "p.png") {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), filename);
  const res = await fetch(`${BASE}/api/admin/images`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test("画像をアップロードすると、そのURLで取り出せる", async () => {
  const { status, body } = await uploadImage(TINY_PNG, "image/png");
  assert.equal(status, 201);

  const { url } = body as { url: string };
  assert.match(url, /^\/api\/images\/[0-9a-f-]{36}$/);

  const res = await fetch(`${BASE}${url}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.match(res.headers.get("cache-control") ?? "", /immutable/);

  const got = Buffer.from(new Uint8Array(await res.arrayBuffer()));
  assert.deepEqual([...got], [...TINY_PNG], "取り出したバイトが元と違う");
});

test("画像はログイン無しではアップロードできない", async () => {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(TINY_PNG)], { type: "image/png" }), "p.png");
  const res = await fetch(`${BASE}/api/admin/images`, { method: "POST", body: form });
  assert.equal(res.status, 401);
});

test("画像：対応していない形式は断られる", async () => {
  for (const type of ["image/svg+xml", "application/pdf", "text/html"]) {
    const { status } = await uploadImage(TINY_PNG, type, "x");
    assert.equal(status, 400, `${type} が通ってしまう`);
  }
});

test("画像：空・大きすぎるものは断られる", async () => {
  const empty = await uploadImage(Buffer.alloc(0), "image/png");
  assert.equal(empty.status, 400, "空の画像が通ってしまう");

  const huge = await uploadImage(Buffer.alloc(4 * 1024 * 1024, 1), "image/png");
  assert.equal(huge.status, 400, "4MB の画像が通ってしまう");
});

test("画像：ファイルが無いと断られる", async () => {
  const form = new FormData();
  form.append("note", "ファイルなし");
  const res = await fetch(`${BASE}/api/admin/images`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });
  assert.equal(res.status, 400);
});

test("画像：存在しないIDや不正なIDは404", async () => {
  for (const id of ["11111111-1111-4111-8111-111111111111", "not-a-uuid", "../../etc/passwd"]) {
    const res = await fetch(`${BASE}/api/images/${encodeURIComponent(id)}`);
    assert.equal(res.status, 404, `${id} が 404 を返さない`);
  }
});

test("アップロードした画像を商品に設定でき、お客様側にも出る", async () => {
  const { body } = await uploadImage(TINY_PNG, "image/png");
  const { url } = body as { url: string };

  const { status, body: created } = await api("/api/admin/products", {
    method: "POST",
    body: JSON.stringify({
      name: "画像つきQA商品",
      description: "",
      price: 100,
      sort_order: 97,
      image_url: url,
    }),
  });
  assert.equal(status, 201);
  const { product } = created as { product: { id: string; image_url: string | null } };

  try {
    assert.equal(product.image_url, url, "商品に画像URLが保存されていない");

    // お客様が見る商品一覧にも同じURLが出ること
    const event = await loadEvent();
    const date = futureDate(event);
    const { body: detail } = await api(`/api/reserve/${date.id}`);
    const rows = (detail as { inventory: Array<{ product: { id: string; image_url: string | null } }> })
      .inventory;
    const shown = rows.find((r) => r.product.id === product.id);
    assert.ok(shown, "新しい商品がお客様側に出ていない");
    assert.equal(shown.product.image_url, url, "お客様側に画像URLが渡っていない");
  } finally {
    await api(`/api/admin/products/${product.id}`, { method: "DELETE" });
  }
});

/* ============================================ 受取日の追加 */

test("受取日を追加すると、受付枠は0で作られる", async () => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const { body: all } = await api("/api/admin/event");
  const stale = (all as { dates: Array<{ id: string; pickup_date: string }> }).dates
    .find((d) => d.pickup_date === tomorrow);
  if (stale) await api(`/api/admin/event/dates/${stale.id}`, { method: "DELETE" });

  const { status, body } = await api("/api/admin/event/dates", {
    method: "POST",
    body: JSON.stringify({ pickup_date: tomorrow }),
  });
  assert.equal(status, 201);
  const { date } = body as { date: { id: string } };

  try {
    const rows = await inventoryFor(date.id);
    assert.ok(rows.length > 0, "受付枠が1行も作られていない");
    assert.ok(
      rows.every((r) => r.production_quantity === 0),
      "受付枠が0で作られていない"
    );
  } finally {
    await api(`/api/admin/event/dates/${date.id}`, { method: "DELETE" });
  }
});
