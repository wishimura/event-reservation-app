/**
 * 単体テスト — 計算とルールだけを対象にした、DBもサーバーも要らないテスト。
 *
 *   npx tsx --test tests/unit.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultReservationCloseAt,
  effectiveReservationStatus,
  formatDate,
  formatPrice,
  generateOrderNumber,
  getRemainingQuantity,
  getStatusLabel,
  isPastReservationDeadline,
  parsePickupTimeSlots,
  todayInJST,
} from "../src/lib/utils";
import { resolveSoldOut } from "../src/lib/inventory";

/* ------------------------------------------------------------------ 受取時間 */

test("受取時間：空白行・前後の空白・重複を落とす", () => {
  assert.deepEqual(
    parsePickupTimeSlots("11:00〜12:00\n\n  12:00〜13:00  \n11:00〜12:00\n"),
    ["11:00〜12:00", "12:00〜13:00"]
  );
});

test("受取時間：未設定は空配列（選択欄を出さない）", () => {
  assert.deepEqual(parsePickupTimeSlots(""), []);
  assert.deepEqual(parsePickupTimeSlots(null), []);
  assert.deepEqual(parsePickupTimeSlots(undefined), []);
  assert.deepEqual(parsePickupTimeSlots("   \n  \n"), []);
});

/* ------------------------------------------------------------------ 締切 */

test("締切：前日23:59:59（日本時間）になる", () => {
  const d = defaultReservationCloseAt("2026-11-18");
  assert.equal(d.toISOString(), "2026-11-17T14:59:59.000Z");
});

test("締切：月初・年初でも前日にまたがる", () => {
  assert.equal(
    defaultReservationCloseAt("2026-11-01").toISOString(),
    "2026-10-31T14:59:59.000Z"
  );
  assert.equal(
    defaultReservationCloseAt("2026-01-01").toISOString(),
    "2025-12-31T14:59:59.000Z"
  );
});

test("締切：うるう年の2/29も正しく前日を指す", () => {
  // 2028年はうるう年。3/1 の前日は 2/29。
  assert.equal(
    defaultReservationCloseAt("2028-03-01").toISOString(),
    "2028-02-29T14:59:59.000Z"
  );
  assert.equal(
    defaultReservationCloseAt("2028-03-01").toLocaleDateString("ja-JP", {
      timeZone: "Asia/Tokyo",
    }),
    "2028/2/29"
  );
});

test("締切判定：境界の前後", () => {
  const deadline = defaultReservationCloseAt("2026-11-18");
  const at = (s: string) => new Date(s);

  assert.equal(isPastReservationDeadline(deadline, at("2026-11-17T23:59:59+09:00")), false);
  assert.equal(isPastReservationDeadline(deadline, at("2026-11-18T00:00:00+09:00")), true);
  assert.equal(isPastReservationDeadline(deadline, at("2026-11-18T12:00:00+09:00")), true);
});

test("締切なしの受取日は締切済みにならない", () => {
  assert.equal(isPastReservationDeadline(null), false);
  assert.equal(isPastReservationDeadline(undefined), false);
  // 壊れた値で全日程を閉じてしまわないこと
  assert.equal(isPastReservationDeadline("not-a-date"), false);
});

test("締切を過ぎた受取日は受付終了として見える", () => {
  const close = defaultReservationCloseAt("2026-11-18");
  const open = { reservation_status: "open" as const, reservation_close_at: close };

  assert.equal(effectiveReservationStatus(open, new Date("2026-11-17T20:00:00+09:00")), "open");
  assert.equal(effectiveReservationStatus(open, new Date("2026-11-18T09:00:00+09:00")), "closed");
});

test("締切前でも売切なら受付終了のまま", () => {
  const closed = {
    reservation_status: "closed" as const,
    reservation_close_at: defaultReservationCloseAt("2026-11-18"),
  };
  assert.equal(effectiveReservationStatus(closed, new Date("2026-11-17T10:00:00+09:00")), "closed");
});

/* ------------------------------------------------------------------ 売切判定 */

const inv = (production: number, reserved: number, soldOut: boolean) => ({
  production_quantity: production,
  reserved_quantity: reserved,
  is_sold_out: soldOut,
});

test("売切：完売後に上限を上げると販売中に戻る", () => {
  assert.equal(
    resolveSoldOut({ production_quantity: 5, is_sold_out: true }, inv(3, 3, true)),
    false
  );
});

test("売切：手動で売切にしたものは上限を上げても維持される", () => {
  assert.equal(
    resolveSoldOut({ production_quantity: 20, is_sold_out: true }, inv(10, 2, true)),
    true
  );
});

test("売切：上限を予約数まで下げると自動で売切", () => {
  assert.equal(
    resolveSoldOut({ production_quantity: 3, is_sold_out: false }, inv(10, 3, false)),
    true
  );
});

test("売切：余裕があるのに操作者が売切にしたら尊重する", () => {
  assert.equal(
    resolveSoldOut({ production_quantity: 10, is_sold_out: true }, inv(10, 2, false)),
    true
  );
});

test("売切：上限0は常に売切", () => {
  assert.equal(
    resolveSoldOut({ production_quantity: 0, is_sold_out: false }, inv(0, 0, false)),
    true
  );
});

/* ------------------------------------------------------------------ 残数 */

test("残数：0未満にならない", () => {
  assert.equal(getRemainingQuantity({ production_quantity: 10, reserved_quantity: 3 }), 7);
  assert.equal(getRemainingQuantity({ production_quantity: 3, reserved_quantity: 10 }), 0);
  assert.equal(getRemainingQuantity({ production_quantity: 0, reserved_quantity: 0 }), 0);
});

/* ------------------------------------------------------------------ 表示 */

test("金額：3桁区切りで円記号つき", () => {
  assert.equal(formatPrice(840), "¥840");
  assert.equal(formatPrice(1800), "¥1,800");
  assert.equal(formatPrice(0), "¥0");
});

test("日付：曜日つきで表示される", () => {
  assert.equal(formatDate("2026-11-18"), "11/18(水)");
  assert.equal(formatDate("2026-11-21"), "11/21(土)");
});

test("日付：タイムゾーンに関わらず日付がずれない", () => {
  // 月初・月末は UTC 基準で組み立てると前日にずれやすい
  assert.equal(formatDate("2026-11-01"), "11/1(日)");
  assert.equal(formatDate("2026-12-31"), "12/31(木)");
});

test("受付状態のラベル", () => {
  assert.equal(getStatusLabel("open").label, "受付中");
  assert.equal(getStatusLabel("few_left").label, "残りわずか");
  assert.equal(getStatusLabel("closed").label, "受付終了");
});

test("本日（JST）はYYYY-MM-DD形式", () => {
  assert.match(todayInJST(), /^\d{4}-\d{2}-\d{2}$/);
});

/* ------------------------------------------------------------------ 注文番号 */

test("注文番号：形式が一定で、連続生成しても衝突しにくい", () => {
  const numbers = new Set<string>();
  for (let i = 0; i < 2000; i++) numbers.add(generateOrderNumber());

  assert.equal(numbers.size, 2000, "2000件すべて異なること");
  for (const n of numbers) assert.match(n, /^[A-Z0-9-]+$/);
});

/* ------------------------------------------------------- DBエラーの判定 */

import { isUniqueViolation } from "../src/lib/db-errors";

test("一意制約エラー：Drizzle が包んだ内側のコードまで見る", () => {
  // Drizzle は実エラーを cause にぶら下げる。表層だけ見ると常に false になる。
  const wrapped = Object.assign(new Error("Failed query: insert into ..."), {
    cause: Object.assign(new Error("duplicate key value"), { code: "23505" }),
  });
  assert.equal(isUniqueViolation(wrapped), true);
});

test("一意制約エラー：素のドライバエラーも判定できる", () => {
  assert.equal(isUniqueViolation(Object.assign(new Error("dup"), { code: "23505" })), true);
});

test("一意制約エラー：別のコードや通常のエラーは false", () => {
  assert.equal(isUniqueViolation(Object.assign(new Error("fk"), { code: "23503" })), false);
  assert.equal(isUniqueViolation(new Error("ただのエラー")), false);
  assert.equal(isUniqueViolation(null), false);
  assert.equal(isUniqueViolation(undefined), false);
});

test("一意制約エラー：cause が循環していても止まる", () => {
  const a: { cause?: unknown } = {};
  a.cause = a;
  assert.equal(isUniqueViolation(a), false);
});
