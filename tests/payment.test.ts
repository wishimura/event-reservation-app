/**
 * 結合テスト（カード決済が有効なとき）
 *
 * お客様がお金を払えない／払ったのに予約が残らない、が最悪の事故なので、
 * 決済が「失敗する側」に倒れたときの後始末だけを集めて確かめる。
 *
 * Square の認証情報を入れた状態のサーバーに対して実行すること。値は本物で
 * なくてよい（本物でないほうが、確実に決済が失敗してくれて都合がよい）。
 *
 *   SQUARE_ACCESS_TOKEN=qa-fake SQUARE_APPLICATION_ID=sandbox-sq0idb-qafake \
 *   SQUARE_LOCATION_ID=QAFAKELOC npm run start -- --port 3982
 *
 *   BASE_URL=http://localhost:3982 ADMIN_PASSWORD=... \
 *     npx tsx --test --test-concurrency=1 tests/payment.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://localhost:3982";

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
    /* そのまま */
  }
  return { status: res.status, body: body as never };
}

interface InventoryRow {
  product_id: string;
  production_quantity: number;
  reserved_quantity: number;
  is_sold_out: boolean;
}

async function bookable() {
  const { body } = await api("/api/events");
  const event = body as {
    id: string;
    pickup_time_slots: string;
    event_dates: Array<{ id: string; reservation_status: string }>;
  };
  const date = event.event_dates.find((d) => d.reservation_status !== "closed");
  assert.ok(date, "予約できる受取日が無い");

  const { body: detail } = await api(`/api/reserve/${date.id}`);
  const row = (detail as { inventory: InventoryRow[] }).inventory.find(
    (i) => !i.is_sold_out && i.production_quantity > i.reserved_quantity
  );
  assert.ok(row, "在庫のある商品が無い");

  const slot = event.pickup_time_slots
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)[0];

  return { event, date, row, slot };
}

async function reserved(dateId: string, productId: string) {
  const { body } = await api(`/api/reserve/${dateId}`);
  return (
    (body as { inventory: InventoryRow[] }).inventory.find(
      (i) => i.product_id === productId
    )?.reserved_quantity ?? -1
  );
}

function order(
  event_id: string,
  event_date_id: string,
  product_id: string,
  quantity: number,
  extra: Record<string, unknown> = {}
) {
  return JSON.stringify({
    event_id,
    event_date_id,
    customer_name: "決済 テスト",
    customer_email: "pay@example.com",
    customer_phone: "090-0000-0000",
    payment_method: "credit_card",
    items: [{ product_id, quantity }],
    ...extra,
  });
}

/* ==================================================================== */

test("カード決済が有効になっていること（このファイルの前提）", async () => {
  const { status, body } = await api("/api/payments/config");
  assert.equal(status, 200);
  const config = body as { enabled: boolean; applicationId: string | null; locationId: string | null };
  assert.equal(config.enabled, true, "カード決済が有効なサーバーに向けて実行すること");
  assert.ok(config.applicationId, "applicationId が無いとカード入力欄を描けない");
  assert.ok(config.locationId, "locationId が無いと決済できない");
});

test("カード情報が無い注文は断られ、受付枠も押さえられない", async () => {
  const { event, date, row, slot } = await bookable();
  const before = await reserved(date.id, row.product_id);

  const { status, body } = await api("/api/orders", {
    method: "POST",
    body: order(event.id, date.id, row.product_id, 1, { pickup_time_slot: slot }),
  });

  assert.equal(status, 400);
  assert.match(
    (body as { error: string }).error,
    /カード/,
    "理由がお客様に伝わる文言になっていない"
  );
  assert.equal(
    await reserved(date.id, row.product_id),
    before,
    "決済していないのに受付枠が減っている"
  );
});

test("決済に失敗したら、受付枠は戻り、注文は取り消され、やり直せる", async () => {
  const { event, date, row, slot } = await bookable();
  const before = await reserved(date.id, row.product_id);
  const requestId = `pay-fail-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const { status, body } = await api("/api/orders", {
    method: "POST",
    body: order(event.id, date.id, row.product_id, 2, {
      pickup_time_slot: slot,
      payment_source_id: "cnon:this-is-not-a-real-card-token",
      client_request_id: requestId,
    }),
  });

  assert.equal(status, 402, "決済失敗は 402 で返るべき");
  assert.ok(
    (body as { error: string }).error.length > 0,
    "お客様に出すメッセージが空"
  );

  assert.equal(
    await reserved(date.id, row.product_id),
    before,
    "決済が通っていないのに受付枠が押さえられたまま"
  );

  // 同じ送信IDで、もう一度試せること（カードを変えて再挑戦する流れ）
  const retry = await api("/api/orders", {
    method: "POST",
    body: order(event.id, date.id, row.product_id, 1, {
      pickup_time_slot: slot,
      payment_source_id: "cnon:another-not-real-token",
      client_request_id: requestId,
    }),
  });
  assert.equal(
    retry.status,
    402,
    "再挑戦が「すでに注文済み」として弾かれている（送信IDが解放されていない）"
  );
  assert.equal(
    await reserved(date.id, row.product_id),
    before,
    "やり直しで受付枠が減ったまま残っている"
  );
});

test("決済が何度失敗しても、受付枠が少しずつ溶けていかない", async () => {
  // 決済業者が落ちている状況を想定。失敗のたびに枠が戻らないと、
  // 誰も買っていないのにその日が売り切れる。
  const { event, date, row, slot } = await bookable();
  const before = await reserved(date.id, row.product_id);

  for (let i = 0; i < 5; i++) {
    const { status } = await api("/api/orders", {
      method: "POST",
      body: order(event.id, date.id, row.product_id, 1, {
        pickup_time_slot: slot,
        payment_source_id: `cnon:fake-${i}`,
      }),
    });
    assert.equal(status, 402);
  }

  assert.equal(
    await reserved(date.id, row.product_id),
    before,
    "決済失敗のたびに受付枠が減っている"
  );
});

test("決済が有効でも、締切を過ぎた受取日はカードを切る前に断られる", async () => {
  const { body } = await api("/api/events");
  const event = body as {
    id: string;
    pickup_time_slots: string;
    event_dates: Array<{ id: string; reservation_status: string; reservation_close_at: string | null }>;
  };

  const closed = event.event_dates.find(
    (d) =>
      d.reservation_status === "closed" ||
      (d.reservation_close_at && new Date(d.reservation_close_at) < new Date())
  );

  if (!closed) return; // 締切済みの日が無い状態なら、この観点は確かめられない

  const { body: detail } = await api(`/api/reserve/${closed.id}`);
  const row = (detail as { inventory: InventoryRow[] }).inventory[0];
  if (!row) return;

  const { status } = await api("/api/orders", {
    method: "POST",
    body: order(event.id, closed.id, row.product_id, 1, {
      pickup_time_slot: event.pickup_time_slots.split("\n")[0]?.trim(),
      payment_source_id: "cnon:fake",
    }),
  });

  assert.equal(status, 400, "締切後なのに決済まで進んでいる");
});
