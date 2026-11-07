/**
 * 結合テスト — 実際に動いているサーバーとデータベースに対して叩く。
 *
 * 使い捨てのデータベースに向けたサーバーを用意してから実行すること。
 * テストは予約を作り、在庫を動かし、注文を消す。本番には向けない。
 *
 *   BASE_URL=http://localhost:3981 ADMIN_PASSWORD=... \
 *     npx tsx --test tests/api.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://localhost:3981";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "qa-password";

let adminCookie = "";

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* HTML などはそのまま */
  }
  return { status: res.status, body: body as never, res };
}

const asAdmin = (init: RequestInit = {}) => ({
  ...init,
  headers: { ...(init.headers ?? {}), Cookie: adminCookie },
});

/** 予約が通る受取日と、その日の在庫のある商品を1つ返す。 */
async function pickBookableDate() {
  const { body } = await api("/api/events");
  const event = body as {
    id: string;
    event_dates: Array<{ id: string; pickup_date: string; reservation_status: string }>;
  };
  const date = event.event_dates.find((d) => d.reservation_status !== "closed");
  assert.ok(date, "予約できる受取日が1つもない");

  const { body: detail } = await api(`/api/reserve/${date.id}`);
  const inventory = (detail as { inventory: Array<Record<string, never>> }).inventory;
  const row = (inventory as unknown as Array<{
    product_id: string;
    production_quantity: number;
    reserved_quantity: number;
    is_sold_out: boolean;
  }>).find((i) => !i.is_sold_out && i.production_quantity > i.reserved_quantity);
  assert.ok(row, "在庫のある商品が1つもない");

  return { event, date, row };
}

function orderBody(
  event_id: string,
  event_date_id: string,
  product_id: string,
  quantity: number,
  diningStyle: "eat_in" | "takeout" = "takeout"
) {
  return JSON.stringify({
    event_id,
    event_date_id,
    customer_name: "テスト 太郎",
    customer_email: "qa@example.com",
    customer_phone: "090-0000-0000",
    payment_method: "cash",
    dining_style: diningStyle,
    items: [{ product_id, quantity }],
  });
}

/* ================================================================= 認証 */

test("管理APIは未ログインだと401", async () => {
  for (const path of [
    "/api/admin/dashboard",
    "/api/admin/orders",
    "/api/admin/inventory",
    "/api/admin/production",
    "/api/admin/event",
    "/api/admin/products",
    "/api/admin/pickup",
    "/api/admin/apple-pay",
    "/api/admin/orders/csv",
  ]) {
    const { status } = await api(path);
    assert.equal(status, 401, `${path} が 401 を返していない`);
  }
});

test("管理画面はURL直打ちでもログインへ飛ばされる", async () => {
  const res = await fetch(`${BASE}/admin/orders`, { redirect: "manual" });
  assert.equal(res.status, 307);
  assert.match(res.headers.get("location") ?? "", /\/admin\/login/);
});

test("間違ったパスワードではログインできない", async () => {
  const { status } = await api("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ password: "wrong-password" }),
  });
  assert.equal(status, 401);
});

test("正しいパスワードでログインでき、Cookieは JS から読めない", async () => {
  const { status, res } = await api("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(status, 200);

  const setCookie = res.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /HttpOnly/i, "HttpOnly が付いていない");
  assert.match(setCookie, /SameSite/i, "SameSite が付いていない");

  adminCookie = setCookie.split(";")[0];
  const { status: after } = await api("/api/admin/dashboard", asAdmin());
  assert.equal(after, 200);
});

test("細工したセッションCookieは通らない", async () => {
  const [name, value] = adminCookie.split("=");
  const tampered = `${name}=${value.slice(0, -4)}AAAA`;
  const { status } = await api("/api/admin/dashboard", { headers: { Cookie: tampered } });
  assert.equal(status, 401);
});

/* ================================================================= 予約 */

test("予約が作られ、在庫がその分だけ減る", async () => {
  const { event, date, row } = await pickBookableDate();
  const before = row.reserved_quantity;

  const { status, body } = await api("/api/orders", {
    method: "POST",
    body: orderBody(event.id, date.id, row.product_id, 2),
  });

  assert.equal(status, 201);
  const order = body as { order_number: string; dining_style: string; order_status: string; total_amount: number };
  assert.match(order.order_number, /^ORD-\d{6}-[A-Z0-9]{6}$/);
  assert.equal(order.order_status, "confirmed");
  assert.equal(order.dining_style, "takeout");
  assert.ok(order.total_amount > 0, "合計金額が0になっている");

  const { body: detail } = await api(`/api/reserve/${date.id}`);
  const after = (detail as { inventory: Array<{ product_id: string; reserved_quantity: number }> })
    .inventory.find((i) => i.product_id === row.product_id);
  assert.equal(after?.reserved_quantity, before + 2);
});

test("店内かお持ち帰りかを選ばないと断られる", async () => {
  const { event, date, row } = await pickBookableDate();
  const body = JSON.parse(orderBody(event.id, date.id, row.product_id, 1));
  delete body.dining_style;

  const res = await api("/api/orders", { method: "POST", body: JSON.stringify(body) });
  assert.equal(res.status, 400);
  assert.match((res.body as { error: string }).error, /お召し上がり|お持ち帰り/);
});

test("知らない提供区分は断られる", async () => {
  const { event, date, row } = await pickBookableDate();
  const body = JSON.parse(orderBody(event.id, date.id, row.product_id, 1));
  body.dining_style = "delivery";

  const res = await api("/api/orders", { method: "POST", body: JSON.stringify(body) });
  assert.equal(res.status, 400);
});

test("必須項目が欠けていると断られる", async () => {
  const { event, date, row } = await pickBookableDate();
  const full = JSON.parse(orderBody(event.id, date.id, row.product_id, 1));

  for (const field of ["customer_name", "customer_email", "customer_phone", "event_date_id"]) {
    const broken = { ...full, [field]: "" };
    const { status } = await api("/api/orders", { method: "POST", body: JSON.stringify(broken) });
    assert.equal(status, 400, `${field} が空でも通ってしまう`);
  }

  const { status: noItems } = await api("/api/orders", {
    method: "POST",
    body: JSON.stringify({ ...full, items: [] }),
  });
  assert.equal(noItems, 400);
});

test("数量が0や負や小数だと断られる", async () => {
  const { event, date, row } = await pickBookableDate();
  for (const quantity of [0, -1, 1.5]) {
    const { status } = await api("/api/orders", {
      method: "POST",
      body: orderBody(event.id, date.id, row.product_id, quantity as number),
    });
    assert.equal(status, 400, `数量 ${quantity} が通ってしまう`);
  }
});

test("在庫を超える数量は断られ、残数が知らされる", async () => {
  const { event, date, row } = await pickBookableDate();
  const { status, body } = await api("/api/orders", {
    method: "POST",
    body: orderBody(event.id, date.id, row.product_id, row.production_quantity + 50),
  });
  assert.equal(status, 400);
  const err = body as { error: string; details?: string[] };
  assert.ok(err.details?.length, "どの商品が足りないのか返していない");
  assert.match(err.details[0], /残り/);
});

test("他人のイベントIDを混ぜても通らない", async () => {
  const { date, row } = await pickBookableDate();
  const { status } = await api("/api/orders", {
    method: "POST",
    body: orderBody("11111111-1111-4111-8111-111111111111", date.id, row.product_id, 1),
  });
  assert.equal(status, 400);
});

test("壊れたJSONでも500にならない", async () => {
  const res = await fetch(`${BASE}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ not json",
  });
  assert.equal(res.status, 400);
});

/* =========================================== 二重送信・二重決済を防ぐ */

/** 同じ注文を2回送っても1件にしかならないこと。 */
test("同じ client_request_id を送り直しても注文は増えない", async () => {
  const { event, date, row } = await pickBookableDate();

  const before = await api(`/api/reserve/${date.id}`);
  const stockBefore = (
    before.body as { inventory: Array<{ product_id: string; reserved_quantity: number }> }
  ).inventory.find((i) => i.product_id === row.product_id)!.reserved_quantity;

  const requestId = `test-repeat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const body = JSON.stringify({
    client_request_id: requestId,
    event_id: event.id,
    event_date_id: date.id,
    customer_name: "二重 太郎",
    customer_email: "qa-repeat@example.com",
    customer_phone: "090-0000-0000",
    payment_method: "cash",
    dining_style: "takeout",
    items: [{ product_id: row.product_id, quantity: 1 }],
  });

  const first = await api("/api/orders", { method: "POST", body });
  assert.equal(first.status, 201);

  const again = await api("/api/orders", { method: "POST", body });
  assert.equal(again.status, 200, "2回目は既存の注文が返るはず");
  assert.equal(
    (again.body as { order_number: string }).order_number,
    (first.body as { order_number: string }).order_number,
    "同じ注文番号が返らなければ二重注文になっている"
  );

  const after = await api(`/api/reserve/${date.id}`);
  const stockAfter = (
    after.body as { inventory: Array<{ product_id: string; reserved_quantity: number }> }
  ).inventory.find((i) => i.product_id === row.product_id)!.reserved_quantity;

  assert.equal(stockAfter, stockBefore + 1, "在庫が二重に引き当てられている");
});

/** 通信が切れて同時に送り直した場合も、注文は1件だけ。 */
test("同じ client_request_id を同時に5回送っても注文は1件", async () => {
  const { event, date, row } = await pickBookableDate();

  const before = await api(`/api/reserve/${date.id}`);
  const stockBefore = (
    before.body as { inventory: Array<{ product_id: string; reserved_quantity: number }> }
  ).inventory.find((i) => i.product_id === row.product_id)!.reserved_quantity;

  const requestId = `test-race-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const body = JSON.stringify({
    client_request_id: requestId,
    event_id: event.id,
    event_date_id: date.id,
    customer_name: "同時 二重",
    customer_email: "qa-race@example.com",
    customer_phone: "090-0000-0000",
    payment_method: "cash",
    dining_style: "takeout",
    items: [{ product_id: row.product_id, quantity: 1 }],
  });

  const results = await Promise.all(
    Array.from({ length: 5 }, () => api("/api/orders", { method: "POST", body }))
  );

  const created = results.filter((r) => r.status === 201);
  assert.equal(created.length, 1, "同時送信で複数の注文が作られている");
  for (const r of results) {
    assert.ok(r.status === 200 || r.status === 201, `想定外の ${r.status}`);
    assert.equal(
      (r.body as { order_number: string }).order_number,
      (created[0].body as { order_number: string }).order_number
    );
  }

  const after = await api(`/api/reserve/${date.id}`);
  const stockAfter = (
    after.body as { inventory: Array<{ product_id: string; reserved_quantity: number }> }
  ).inventory.find((i) => i.product_id === row.product_id)!.reserved_quantity;

  assert.equal(stockAfter, stockBefore + 1, "在庫が重複して引き当てられている");
});

/** 同時に殺到しても、受付上限を超えて売れないこと。 */
test("在庫の最後の1個に同時に殺到しても1件しか通らない", async () => {
  const { event, date, row } = await pickBookableDate();

  const detail = await api(`/api/reserve/${date.id}`);
  const current = (
    detail.body as {
      inventory: Array<{
        product_id: string;
        production_quantity: number;
        reserved_quantity: number;
      }>;
    }
  ).inventory.find((i) => i.product_id === row.product_id)!;
  const remaining = current.production_quantity - current.reserved_quantity;
  assert.ok(remaining > 0, "在庫のある商品が必要");

  // 残りぴったりの数を、同時に人数分ぶつける
  const attempts = 6;
  const results = await Promise.all(
    Array.from({ length: attempts }, (_, i) =>
      api("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          event_id: event.id,
          event_date_id: date.id,
          customer_name: `殺到 ${i}`,
          customer_email: "qa-rush@example.com",
          customer_phone: "090-0000-0000",
          payment_method: "cash",
          dining_style: "takeout",
          items: [{ product_id: row.product_id, quantity: remaining }],
        }),
      })
    )
  );

  const ok = results.filter((r) => r.status === 201);
  assert.equal(ok.length, 1, `${ok.length} 件通っている（1件のはず）`);

  const after = await api(`/api/reserve/${date.id}`);
  const row2 = (
    after.body as {
      inventory: Array<{
        product_id: string;
        production_quantity: number;
        reserved_quantity: number;
      }>;
    }
  ).inventory.find((i) => i.product_id === row.product_id)!;
  assert.ok(
    row2.reserved_quantity <= row2.production_quantity,
    "受付上限を超えて引き当てられている"
  );
});

/* ==================================================================== *
 *  この端末に覚えたカード
 *
 *  ここで守りたいのは一点だけ。**本文に書かれたカードは決して使わない**
 *  こと。使えば、id を当てた人が他人のカードで決済できてしまいます。
 *  鍵になるのは Cookie だけです。
 * ==================================================================== */

test("覚えたカードは、Cookie を持っていない人には出てこない", async () => {
  const res = await api("/api/saved-card");
  assert.equal(res.status, 200);
  assert.equal(
    (res.body as { card: unknown }).card,
    null,
    "Cookie が無いのにカードが返っている"
  );
});

test("Cookie が無いのに「保存カードで払う」と言われても、カードは切られない", async () => {
  /*
    ここが通ってしまうと、カード id を当てた人が他人のカードで決済できます。
    鍵は Cookie だけで、本文に書かれた id は見ません。

    カード払いが入っているかどうかで、正しい断り方が変わります。
      - 入っている  → 400 で断る（保存カードが無いので切るものが無い）
      - 入っていない → そもそもカードは切らず、店頭払いとして受ける
    どちらでも守られるのは**本文のカードが使われないこと**なので、
    そこを見ます。
  */
  const { event, date, row } = await pickBookableDate();

  const config = await api("/api/payments/config");
  const cardPaymentIsOn = (config.body as { enabled: boolean }).enabled;

  const res = await api("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      event_id: event.id,
      event_date_id: date.id,
      customer_name: "なりすまし 太郎",
      customer_email: "spoof@example.com",
      customer_phone: "090-0000-0000",
      payment_method: "credit_card",
      dining_style: "takeout",
      use_saved_card: true,
      // 当てずっぽうのカード id。見てはいけないもの。
      payment_source_id: "ccof:someone-elses-card",
      items: [{ product_id: row.product_id, quantity: 1 }],
    }),
  });

  if (cardPaymentIsOn) {
    assert.ok(
      res.status >= 400,
      `保存カードが無いのに ${res.status} で通っている`
    );
    return;
  }

  assert.equal(res.status, 201);
  const order = res.body as { payment_method: string; payment_status: string };
  assert.equal(
    order.payment_method,
    "cash",
    "カードの設定が無いのに、カード払いとして記録されている"
  );
  assert.notEqual(
    order.payment_status,
    "paid_by_card",
    "切れないはずのカードが切られている"
  );

  await releaseOrder((res.body as { id: string }).id);
});

test("カードを覚えさせる窓口は、外に開いていない", async () => {
  /*
    覚えるのはご注文の処理の中だけです（決済が済んだ決済 id から）。
    外から叩ける書き込み口があると、そこが的になります。
  */
  const res = await api("/api/saved-card", {
    method: "POST",
    body: JSON.stringify({ source_id: "cnon:fake-token" }),
  });

  assert.ok(
    res.status === 404 || res.status === 405,
    `保存の窓口が外から叩ける（${res.status}）`
  );
});

test("忘れさせる操作は、何も覚えていなくても転ばない", async () => {
  const res = await api("/api/saved-card", { method: "DELETE" });
  assert.equal(res.status, 200);
  assert.equal((res.body as { ok: boolean }).ok, true);
});

test("かけられない電話番号は、サーバーも受け取らない", async () => {
  /*
    画面でも見ていますが、そこだけに任せると、画面側の取りこぼしが
    そのまま注文になります。実際なりました——`09000000000A` が1件通って
    います（数字以外をすべて落としてから桁を数えていたため、A が消えて
    正しい番号に化けていました）。

    お店は変更・キャンセルを電話でのみ受けているので、連絡の取れない
    予約はそれだけで困ります。
  */
  const { event, date, row } = await pickBookableDate();

  const bad = ["09000000000A", "----------", "9012345678", "1234", "でんわ"];

  for (const phone of bad) {
    const res = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        event_id: event.id,
        event_date_id: date.id,
        customer_name: "電話 太郎",
        customer_email: "phone@example.com",
        customer_phone: phone,
        payment_method: "cash",
        dining_style: "takeout",
        items: [{ product_id: row.product_id, quantity: 1 }],
      }),
    });

    assert.equal(res.status, 400, `「${phone}」が通っている`);
  }
});

test("まともな電話番号は、書き方が違っても受け取る", async () => {
  // 区切りの入れ方は人それぞれ。そこで断るのは行き過ぎ。
  const { event, date, row } = await pickBookableDate();

  for (const phone of ["090-1234-5678", "09012345678", "(090) 1234-5678", "+819012345678", "03-1234-5678"]) {
    const res = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        event_id: event.id,
        event_date_id: date.id,
        customer_name: "電話 花子",
        customer_email: "phone-ok@example.com",
        customer_phone: phone,
        payment_method: "cash",
        dining_style: "takeout",
        items: [{ product_id: row.product_id, quantity: 1 }],
      }),
    });

    assert.equal(res.status, 201, `「${phone}」が断られている`);
    await releaseOrder((res.body as { id: string }).id);
  }
});

/* ==================================================================== *
 *  キャンセルの取り消し
 *
 *  押し間違い——隣の方の注文を消してしまった——のための口です。
 *  在庫を取り直すので、二重に数えないことがいちばん大事です。
 * ==================================================================== */

async function placeOrder(quantity = 1) {
  const { event, date, row } = await pickBookableDate();
  const res = await api("/api/orders", {
    method: "POST",
    body: orderBody(event.id, date.id, row.product_id, quantity),
  });
  assert.equal(res.status, 201, "前提の注文が作れない");
  return {
    order: res.body as { id: string; order_number: string },
    dateId: date.id,
    productId: row.product_id,
  };
}

/**
 * 取った枠を返す。
 *
 * この結合テストは、1回の実行のあいだデータベースを作り直しません。確かめ
 * 終わった注文を残したままにすると、その日の枠を握り続け、**あとに走る
 * テストが在庫切れで落ちます**。実際に落としました。
 *
 * 自分の後始末をしないテストは、自分より後ろのテストを壊します。
 */
async function releaseOrder(id: string) {
  await api(`/api/admin/orders/${id}/cancel`, asAdmin({ method: "PATCH" }));
}

async function remainingFor(dateId: string, productId: string) {
  const { body } = await api(`/api/reserve/${dateId}`);
  const row = (
    body as {
      inventory: Array<{
        product_id: string;
        production_quantity: number;
        reserved_quantity: number;
      }>;
    }
  ).inventory.find((i) => i.product_id === productId)!;
  return row.production_quantity - row.reserved_quantity;
}

test("キャンセルを取り消すと、在庫も元に戻る", async () => {

  const { order, dateId, productId } = await placeOrder(2);

  const afterOrder = await remainingFor(dateId, productId);

  const cancelled = await api(
    `/api/admin/orders/${order.id}/cancel`,
    asAdmin({ method: "PATCH" })
  );
  assert.equal(cancelled.status, 200);
  assert.equal(
    await remainingFor(dateId, productId),
    afterOrder + 2,
    "キャンセルで在庫が戻っていない"
  );

  const restored = await api(
    `/api/admin/orders/${order.id}/restore`,
    asAdmin({ method: "PATCH" })
  );
  assert.equal(restored.status, 200);
  assert.equal(
    await remainingFor(dateId, productId),
    afterOrder,
    "取り消しで在庫が元に戻っていない"
  );

  await releaseOrder(order.id);
});

test("二度取り消しても、在庫は二重に減らない", async () => {
  /*
    ここが、キャンセルを一方通行にしていた理由そのものです。行き来できる
    状態は数え間違いを呼びます。2回目は断られ、在庫は1つも動かないこと。
  */

  const { order, dateId, productId } = await placeOrder(1);

  await api(`/api/admin/orders/${order.id}/cancel`, asAdmin({ method: "PATCH" }));
  await api(`/api/admin/orders/${order.id}/restore`, asAdmin({ method: "PATCH" }));

  const afterFirst = await remainingFor(dateId, productId);

  const second = await api(
    `/api/admin/orders/${order.id}/restore`,
    asAdmin({ method: "PATCH" })
  );
  assert.equal(second.status, 400, "キャンセルされていない注文が戻せている");
  assert.equal(
    await remainingFor(dateId, productId),
    afterFirst,
    "2回目の取り消しで在庫が動いている"
  );

  await releaseOrder(order.id);
});

test("在庫が無くなっていたら、戻さずに断る", async () => {
  /*
    キャンセルしたあと、その枠を他の方が買ってしまうことがあります。
    そこで無理に戻すと、受付上限を超えた注文ができ、当日お店が足りません。
    何も変えずに断り、どの商品がいくつ足りないかを返すこと。
  */

  const { event, date, row } = await pickBookableDate();

  const remaining = await remainingFor(date.id, row.product_id);
  assert.ok(remaining > 0, "在庫のある商品が必要");

  // 残りぜんぶを1件で押さえる。
  const mine = await api("/api/orders", {
    method: "POST",
    body: orderBody(event.id, date.id, row.product_id, remaining),
  });
  assert.equal(mine.status, 201);
  const mineId = (mine.body as { id: string }).id;

  // キャンセルして枠を空け、すぐ他の方が同じだけ買う。
  await api(`/api/admin/orders/${mineId}/cancel`, asAdmin({ method: "PATCH" }));
  const theirs = await api("/api/orders", {
    method: "POST",
    body: orderBody(event.id, date.id, row.product_id, remaining),
  });
  assert.equal(theirs.status, 201, "空いた枠が買えていない");

  const before = await remainingFor(date.id, row.product_id);

  const restored = await api(
    `/api/admin/orders/${mineId}/restore`,
    asAdmin({ method: "PATCH" })
  );
  assert.equal(restored.status, 400, "在庫が無いのに戻せている");

  const body = restored.body as { error: string; details?: string[] };
  assert.ok(
    Array.isArray(body.details) && body.details.length > 0,
    "どの商品が足りないかが返っていない"
  );

  assert.equal(
    await remainingFor(date.id, row.product_id),
    before,
    "断ったのに在庫が動いている"
  );

  /*
    取った枠を返しておく。

    この確認はその日の残りを**全部**押さえます。返さずに終わると、あとに
    走るテストが在庫切れで落ちます（実際に4件落としました）。自分の後始末を
    しないテストは、自分より後ろのテストを壊します。
  */
  await api(
    `/api/admin/orders/${(theirs.body as { id: string }).id}/cancel`,
    asAdmin({ method: "PATCH" })
  );
});

test("キャンセルの取り消しは、ログインしていないとできない", async () => {
  const { order } = await placeOrder(1);
  const res = await api(`/api/admin/orders/${order.id}/restore`, {
    method: "PATCH",
  });
  assert.equal(res.status, 401);
});

/* ==================================================================== *
 *  店頭販売のお支払い状況
 *
 *  カウンターでは「先に商品だけ渡して、お会計はあとで」が起きます。
 *  未払いのまま売上に混ざらないこと、そしてあとから直せることを見ます。
 * ==================================================================== */

async function walkIn(extra: Record<string, unknown> = {}) {
  const { date, row } = await pickBookableDate();
  const res = await api(
    "/api/admin/orders",
    asAdmin({
      method: "POST",
      body: JSON.stringify({
        event_date_id: date.id,
        customer_name: "店頭 太郎",
        dining_style: "takeout",
        items: [{ product_id: row.product_id, quantity: 1 }],
        ...extra,
      }),
    })
  );
  assert.equal(res.status, 201, `店頭販売が登録できない: ${JSON.stringify(res.body)}`);
  return (res.body as { order: { id: string; order_number: string } }).order;
}

/** 店頭販売をつくって、渡した確認が終わったら必ず返す。 */
async function withWalkIn(
  extra: Record<string, unknown>,
  check: (order: { id: string; order_number: string }) => Promise<void>
) {
  const order = await walkIn(extra);
  try {
    await check(order);
  } finally {
    await releaseOrder(order.id);
  }
}

async function orderById(id: string) {
  const { body } = await api("/api/admin/orders", asAdmin());
  return (
    body as { orders: Array<{ id: string; payment_status: string; paid_at: string | null }> }
  ).orders.find((o) => o.id === id)!;
}

test("店頭販売は、未払いでも登録できる", async () => {
  await withWalkIn({ payment_status: "pending" }, async (order) => {
    const found = await orderById(order.id);
    assert.equal(found.payment_status, "pending");
    assert.equal(found.paid_at, null, "頂いていないお金に支払日時が付いている");
  });
});

test("何も言わなければ、これまでどおり「頂いた」で記録する", async () => {
  await withWalkIn({}, async (order) => {
    const found = await orderById(order.id);
    assert.equal(found.payment_status, "paid");
    assert.ok(found.paid_at, "支払日時が入っていない");
  });
});

test("あとから「決済済み」に直せる。日時も一緒に入る", async () => {
  await withWalkIn({ payment_status: "pending" }, async (order) => {
    const res = await api(
      `/api/admin/orders/${order.id}/payment-status`,
      asAdmin({ method: "PATCH", body: JSON.stringify({ payment_status: "paid" }) })
    );
    assert.equal(res.status, 200);

    const found = await orderById(order.id);
    assert.equal(found.payment_status, "paid");
    assert.ok(found.paid_at, "支払日時が入っていない");
  });
});

test("「未決済」に戻すと、支払日時も消える", async () => {
  // 頂いていないお金に日時が残っているのは、ただの嘘。
  await withWalkIn({}, async (order) => {
    await api(
      `/api/admin/orders/${order.id}/payment-status`,
      asAdmin({ method: "PATCH", body: JSON.stringify({ payment_status: "pending" }) })
    );

    const found = await orderById(order.id);
    assert.equal(found.payment_status, "pending");
    assert.equal(found.paid_at, null, "支払日時が残っている");
  });
});

test("ネット予約のお支払い状況は、この口からは変えられない", async () => {
  /*
    あちらのお金は Square が持っています。こちらの表示だけ書き換えると、
    二度と突き合わせられなくなります。
  */
  const { event, date, row } = await pickBookableDate();
  const placed = await api("/api/orders", {
    method: "POST",
    body: orderBody(event.id, date.id, row.product_id, 1),
  });
  assert.equal(placed.status, 201);

  const res = await api(
    `/api/admin/orders/${(placed.body as { id: string }).id}/payment-status`,
    asAdmin({ method: "PATCH", body: JSON.stringify({ payment_status: "pending" }) })
  );
  assert.equal(res.status, 400, "ネット予約が書き換えられている");
});

test("お支払い状況の変更は、ログインしていないとできない", async () => {
  await withWalkIn({}, async (order) => {
    const res = await api(`/api/admin/orders/${order.id}/payment-status`, {
      method: "PATCH",
      body: JSON.stringify({ payment_status: "pending" }),
    });
    assert.equal(res.status, 401);
  });
});

test("未払いの店頭販売も、キャンセルを取り消せる", async () => {
  /*
    戻せない注文は「ネット予約で、お金が入らなかったもの」だけです。
    店頭の未払いは「あとで頂く」なので、別物として戻せること。
    `payment_status` だけで弾いていた頃は、これも巻き込んでいました。
  */
  await withWalkIn({ payment_status: "pending" }, async (order) => {
    await api(`/api/admin/orders/${order.id}/cancel`, asAdmin({ method: "PATCH" }));
    const restored = await api(
      `/api/admin/orders/${order.id}/restore`,
      asAdmin({ method: "PATCH" })
    );
    assert.equal(
      restored.status,
      200,
      `未払いの店頭販売が戻せない: ${JSON.stringify(restored.body)}`
    );
  });
});

