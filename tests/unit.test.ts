/**
 * 単体テスト — 計算とルールだけを対象にした、DBもサーバーも要らないテスト。
 *
 *   npx tsx --test tests/unit.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  addDaysToDateString,
  defaultReservationCloseAt,
  effectiveReservationStatus,
  formatDate,
  formatPrice,
  generateOrderNumber,
  getRemainingQuantity,
  getStatusLabel,
  isPastReservationDeadline,
  todayInJST,
} from "../src/lib/utils";
import { resolveSoldOut } from "../src/lib/inventory";



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

import { isUniqueViolation, isUniqueViolationOn } from "../src/lib/db-errors";
import { diningStyleLabel, pickupDateLabel, taxBreakdown } from "../src/lib/tax";
import {
  groupByCustomer,
  matchedByLabel,
  normalizeEmail,
  normalizePhone,
} from "../src/lib/customer-grouping";

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

/* ================================================ 追加：境界と環境依存 */

test("注文番号：サーバーのタイムゾーンが変わっても日付部分がずれない", () => {
  // 過去に、サーバーのローカル時刻（UTC）で日付を作っていたため、
  // 日本時間の朝9時より前に入った注文が前日の番号になっていた。
  const original = process.env.TZ;
  const seen = new Set<string>();

  for (const tz of ["UTC", "Asia/Tokyo", "America/New_York", "Pacific/Kiritimati"]) {
    process.env.TZ = tz;
    seen.add(generateOrderNumber().slice(4, 10));
  }

  process.env.TZ = original;
  assert.equal(seen.size, 1, `タイムゾーンで日付が変わっている: ${[...seen].join(", ")}`);
});

test("締切：サーバーのタイムゾーンが変わっても同じ瞬間を指す", () => {
  const original = process.env.TZ;
  const seen = new Set<number>();

  for (const tz of ["UTC", "Asia/Tokyo", "America/New_York", "Pacific/Kiritimati"]) {
    process.env.TZ = tz;
    seen.add(defaultReservationCloseAt("2026-11-18").getTime());
  }

  process.env.TZ = original;
  assert.equal(seen.size, 1, "タイムゾーンで締切の瞬間がずれている");
});



test("日付の加算：月末・年末・うるう年をまたいでも正しい", () => {
  assert.equal(addDaysToDateString("2026-01-31", 1), "2026-02-01");
  assert.equal(addDaysToDateString("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysToDateString("2028-02-28", 1), "2028-02-29"); // うるう年
  assert.equal(addDaysToDateString("2027-02-28", 1), "2027-03-01"); // 平年
  assert.equal(addDaysToDateString("2026-11-18", -1), "2026-11-17");
  assert.equal(addDaysToDateString("2026-03-01", -1), "2026-02-28");
});

test("金額：0円と大きな額も崩れない", () => {
  assert.equal(formatPrice(0), "¥0");
  assert.equal(formatPrice(1234567), "¥1,234,567");
});

test("残数：上限より予約が多い異常値でも負を返さない", () => {
  assert.equal(getRemainingQuantity({ production_quantity: 5, reserved_quantity: 9 }), 0);
  assert.equal(getRemainingQuantity({ production_quantity: 0, reserved_quantity: 0 }), 0);
});

test("一意制約エラー：どの制約で落ちたかを見分けられる", () => {
  // 注文番号の衝突は「番号を作り直して再試行」、
  // 二重送信の判定用IDの衝突は「同じ注文として扱う」で、意味が正反対。
  const orderNumberClash = Object.assign(new Error("duplicate key"), {
    code: "23505",
    constraint: "orders_order_number_unique",
  });
  const repeatedAttempt = Object.assign(new Error("duplicate key"), {
    code: "23505",
    constraint: "orders_client_request_id_key",
  });

  assert.equal(isUniqueViolationOn(repeatedAttempt, "orders_client_request_id_key"), true);
  assert.equal(isUniqueViolationOn(orderNumberClash, "orders_client_request_id_key"), false);
  assert.equal(isUniqueViolationOn(orderNumberClash, "orders_order_number_unique"), true);
});

test("一意制約エラー：Drizzle が包んでいても制約名まで届く", () => {
  const inner = Object.assign(new Error("duplicate key"), {
    code: "23505",
    constraint: "orders_client_request_id_key",
  });
  const wrapped = Object.assign(new Error("Failed query"), { cause: inner });

  assert.equal(isUniqueViolationOn(wrapped, "orders_client_request_id_key"), true);
  assert.equal(isUniqueViolationOn(wrapped, "orders_order_number_unique"), false);
});

test("一意制約エラー：制約名が無いドライバでも誤判定しない", () => {
  const noConstraint = Object.assign(new Error("duplicate key"), { code: "23505" });
  assert.equal(isUniqueViolation(noConstraint), true);
  assert.equal(isUniqueViolationOn(noConstraint, "orders_client_request_id_key"), false);
});

/* ====================================================== 消費税 */

test("消費税：売値は同じでも、税率と税額が提供区分で変わる", () => {
  const takeout = taxBreakdown(840, "takeout");
  const eatIn = taxBreakdown(840, "eat_in");

  // お客様が払う額は1円も変わらない
  assert.equal(takeout.total, 840);
  assert.equal(eatIn.total, 840);

  assert.equal(takeout.percent, 8);
  assert.equal(eatIn.percent, 10);

  assert.equal(takeout.net, 777);
  assert.equal(takeout.tax, 63);
  assert.equal(eatIn.net, 763);
  assert.equal(eatIn.tax, 77);
});

test("消費税：税抜と税額の合計が、必ず決済額ぴったりになる", () => {
  // ここがずれると Square の明細と帳簿が合わなくなる
  for (const total of [80, 380, 480, 650, 750, 800, 840, 1234, 2160, 9999, 123456]) {
    for (const style of ["takeout", "eat_in"] as const) {
      const t = taxBreakdown(total, style);
      assert.equal(t.net + t.tax, total, `${total}円 / ${style} で合わない`);
    }
  }
});

test("消費税：0円や異常な値でも壊れない", () => {
  assert.deepEqual(
    { net: taxBreakdown(0, "takeout").net, tax: taxBreakdown(0, "takeout").tax },
    { net: 0, tax: 0 }
  );
  assert.equal(taxBreakdown(-100, "eat_in").total, 0);
});

test("表示名：イートインの受取日は「来店日」と呼ぶ", () => {
  assert.equal(diningStyleLabel("eat_in"), "イートイン");
  assert.equal(diningStyleLabel("takeout"), "テイクアウト");
  assert.equal(pickupDateLabel("eat_in"), "来店日");
  assert.equal(pickupDateLabel("takeout"), "受取日");
  assert.equal(pickupDateLabel(null), "受取日");
});

/* ============================================== 同じ方の名寄せ */

const order = (
  id: string,
  customer_name: string,
  customer_email: string,
  customer_phone: string
) => ({ id, customer_name, customer_email, customer_phone });

test("名寄せ：電話番号の書き方が違っても同じ番号とみなす", () => {
  assert.equal(normalizePhone("090-1234-5678"), "09012345678");
  assert.equal(normalizePhone("09012345678"), "09012345678");
  assert.equal(normalizePhone("090 1234 5678"), "09012345678");
  assert.equal(normalizePhone("(090) 1234-5678"), "09012345678");
  assert.equal(normalizePhone("+81 90 1234 5678"), "09012345678");
  assert.equal(normalizePhone(""), "");
});

test("名寄せ：メールの大文字小文字と前後の空白は無視する", () => {
  assert.equal(normalizeEmail("  Taro@Example.COM "), "taro@example.com");
  assert.equal(normalizeEmail(null), "");
});

test("名寄せ：メールアドレスが同じならまとまる", () => {
  const groups = groupByCustomer([
    order("1", "山田 太郎", "taro@example.com", "090-1111-1111"),
    order("2", "山田 太郎", "taro@example.com", "090-2222-2222"),
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].orders.length, 2);
  assert.equal(groups[0].matchedBy, "email");
});

test("名寄せ：電話番号が同じならまとまる（メールが違っても）", () => {
  const groups = groupByCustomer([
    order("1", "山田 太郎", "taro@example.com", "090-1234-5678"),
    order("2", "山田 花子", "hanako@example.com", "09012345678"),
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].matchedBy, "phone");
});

test("名寄せ：メールも電話も同じなら、その旨が分かる", () => {
  const groups = groupByCustomer([
    order("1", "山田 太郎", "taro@example.com", "090-1234-5678"),
    order("2", "山田 太郎", "TARO@example.com", "090-1234-5678"),
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].matchedBy, "both");
});

test("名寄せ：同姓同名でも連絡先が違えば別人として扱う", () => {
  // ここが崩れると、別の方のぶんを一緒にお渡ししてしまう
  const groups = groupByCustomer([
    order("1", "山田 太郎", "taro1@example.com", "090-1111-1111"),
    order("2", "山田 太郎", "taro2@example.com", "090-2222-2222"),
  ]);

  assert.equal(groups.length, 2, "氏名だけでまとめてしまっている");
  assert.ok(groups[0].hasNameCollision, "同姓同名の警告が出ていない");
  assert.ok(groups[1].hasNameCollision, "同姓同名の警告が出ていない");
});

test("名寄せ：別人どうしには同姓同名の警告を出さない", () => {
  const groups = groupByCustomer([
    order("1", "山田 太郎", "taro@example.com", "090-1111-1111"),
    order("2", "鈴木 花子", "hanako@example.com", "090-2222-2222"),
  ]);

  assert.equal(groups.length, 2);
  assert.ok(!groups[0].hasNameCollision);
  assert.ok(!groups[1].hasNameCollision);
});

test("名寄せ：連絡先が連鎖してつながる場合もひとまとまりになる", () => {
  // 1と2はメールが同じ、2と3は電話が同じ → 3件で1組
  const groups = groupByCustomer([
    order("1", "山田 太郎", "taro@example.com", "090-1111-1111"),
    order("2", "山田 太郎", "taro@example.com", "090-9999-9999"),
    order("3", "山田 太郎", "other@example.com", "090-9999-9999"),
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].orders.length, 3);
});

test("名寄せ：1件だけなら、まとめた理由は出さない", () => {
  const groups = groupByCustomer([
    order("1", "山田 太郎", "taro@example.com", "090-1111-1111"),
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].matchedBy, null);
  assert.equal(matchedByLabel(null), "");
});

test("名寄せ：短すぎる電話番号では他人とまとめない", () => {
  // 店頭販売は電話番号が空のことがある
  const groups = groupByCustomer([
    order("1", "店頭のお客様", "", ""),
    order("2", "店頭のお客様", "", ""),
    order("3", "誰か", "", "123"),
  ]);

  assert.equal(groups.length, 3, "連絡先の無い注文がまとまってしまっている");
});

test("名寄せ：渡した順番が保たれる", () => {
  const groups = groupByCustomer([
    order("1", "A", "a@example.com", "090-1111-1111"),
    order("2", "B", "b@example.com", "090-2222-2222"),
    order("3", "A", "a@example.com", "090-1111-1111"),
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].orders.map((o) => o.id), ["1", "3"]);
  assert.deepEqual(groups[1].orders.map((o) => o.id), ["2"]);
});
