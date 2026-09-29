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
    pickup_time_slots: string;
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

  const slots = event.pickup_time_slots
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  return { event, date, row, slot: slots[0] };
}

function orderBody(
  event_id: string,
  event_date_id: string,
  product_id: string,
  quantity: number,
  slot?: string
) {
  return JSON.stringify({
    event_id,
    event_date_id,
    customer_name: "テスト 太郎",
    customer_email: "qa@example.com",
    customer_phone: "090-0000-0000",
    payment_method: "cash",
    pickup_time_slot: slot,
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
  const { event, date, row, slot } = await pickBookableDate();
  const before = row.reserved_quantity;

  const { status, body } = await api("/api/orders", {
    method: "POST",
    body: orderBody(event.id, date.id, row.product_id, 2, slot),
  });

  assert.equal(status, 201);
  const order = body as { order_number: string; pickup_time_slot: string | null; order_status: string; total_amount: number };
  assert.match(order.order_number, /^ORD-\d{6}-[A-Z0-9]{6}$/);
  assert.equal(order.order_status, "confirmed");
  assert.equal(order.pickup_time_slot, slot);
  assert.ok(order.total_amount > 0, "合計金額が0になっている");

  const { body: detail } = await api(`/api/reserve/${date.id}`);
  const after = (detail as { inventory: Array<{ product_id: string; reserved_quantity: number }> })
    .inventory.find((i) => i.product_id === row.product_id);
  assert.equal(after?.reserved_quantity, before + 2);
});

test("受取時間が未選択だと断られる", async () => {
  const { event, date, row } = await pickBookableDate();
  const { status, body } = await api("/api/orders", {
    method: "POST",
    body: orderBody(event.id, date.id, row.product_id, 1),
  });
  assert.equal(status, 400);
  assert.match((body as { error: string }).error, /受取時間/);
});

test("用意されていない受取時間は断られる", async () => {
  const { event, date, row } = await pickBookableDate();
  const { status, body } = await api("/api/orders", {
    method: "POST",
    body: orderBody(event.id, date.id, row.product_id, 1, "26:00〜27:00"),
  });
  assert.equal(status, 400);
  assert.match((body as { error: string }).error, /受取時間/);
});

test("必須項目が欠けていると断られる", async () => {
  const { event, date, row, slot } = await pickBookableDate();
  const full = JSON.parse(orderBody(event.id, date.id, row.product_id, 1, slot));

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
  const { event, date, row, slot } = await pickBookableDate();
  for (const quantity of [0, -1, 1.5]) {
    const { status } = await api("/api/orders", {
      method: "POST",
      body: orderBody(event.id, date.id, row.product_id, quantity as number, slot),
    });
    assert.equal(status, 400, `数量 ${quantity} が通ってしまう`);
  }
});

test("在庫を超える数量は断られ、残数が知らされる", async () => {
  const { event, date, row, slot } = await pickBookableDate();
  const { status, body } = await api("/api/orders", {
    method: "POST",
    body: orderBody(event.id, date.id, row.product_id, row.production_quantity + 50, slot),
  });
  assert.equal(status, 400);
  const err = body as { error: string; details?: string[] };
  assert.ok(err.details?.length, "どの商品が足りないのか返していない");
  assert.match(err.details[0], /残り/);
});

test("他人のイベントIDを混ぜても通らない", async () => {
  const { date, row, slot } = await pickBookableDate();
  const { status } = await api("/api/orders", {
    method: "POST",
    body: orderBody("11111111-1111-4111-8111-111111111111", date.id, row.product_id, 1, slot),
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
  const { event, date, row, slot } = await pickBookableDate();

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
    pickup_time_slot: slot,
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
  const { event, date, row, slot } = await pickBookableDate();

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
    pickup_time_slot: slot,
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
  const { event, date, row, slot } = await pickBookableDate();

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
          pickup_time_slot: slot,
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
