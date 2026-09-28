-- =====================================================================
-- ゲゲゲ忌コラボ 本番データ（既存データを全削除して入れ替え）
--
--   受取日   11/18〜11/30。11/24(火) は店休日のため受付なし
--   数量     キャロットケーキとバックベアードは
--            11/21・22・23・28・29 が20個、それ以外は12個
--   締切     各日とも前日 23:59（日本時間）
--   受取時間 11:00〜16:00 を1時間刻み
-- =====================================================================
BEGIN;

DELETE FROM order_items;
DELETE FROM orders;
DELETE FROM daily_product_inventory;
DELETE FROM event_dates;
DELETE FROM products;
DELETE FROM events;

-- ---------------------------------------------------------------- イベント
INSERT INTO events (
  id, name, description, start_date, end_date,
  pickup_location, contact_phone, pickup_time_slots, reservation_note, is_active
) VALUES (
  'e0000000-0000-4000-8000-000000000001',
  'ゲゲゲ忌メニュー',
  '妖怪たちにちなんだ限定メニューをご用意しました。すべて受注生産のため、事前のご予約をお願いしています。',
  '2026-11-18', '2026-11-30',
  'となりのと 本店（1F カウンター）',
  '070-6669-1010',
  E'11:00〜12:00\n12:00〜13:00\n13:00〜14:00\n14:00〜15:00\n15:00〜16:00',
  E'受取時間は各日 11:00〜16:00 です。\n11/24（火）は店休日のため、ご予約を承っておりません。\nお支払いはご予約時にクレジットカードでお願いいたします。\nご予約は受取日の前日23:59までです。\nご予約の変更・キャンセルはお電話でご連絡ください。',
  true
);

-- ---------------------------------------------------------------- 受取日
-- 締切は前日23:59（日本時間）。11/24 だけ is_active = false。
INSERT INTO event_dates
  (event_id, pickup_date, reservation_close_at, reservation_open, reservation_status, is_active)
SELECT
  'e0000000-0000-4000-8000-000000000001',
  d::date,
  ((d::date - 1) + TIME '23:59:59') AT TIME ZONE 'Asia/Tokyo',
  true,
  'open',
  d::date <> DATE '2026-11-24'
FROM generate_series(DATE '2026-11-18', DATE '2026-11-30', INTERVAL '1 day') AS d;

-- ---------------------------------------------------------------- 商品
INSERT INTO products (event_id, name, description, price, sort_order, is_active)
VALUES
  ('e0000000-0000-4000-8000-000000000001', 'チキンカレー（ルーのみ）', '', 840, 1, true),
  ('e0000000-0000-4000-8000-000000000001', '一反もめんナン',           '', 480, 2, true),
  ('e0000000-0000-4000-8000-000000000001', 'ぬりかべナン',             '', 650, 3, true),
  ('e0000000-0000-4000-8000-000000000001', 'キャロットケーキ',         '', 800, 4, true),
  ('e0000000-0000-4000-8000-000000000001', 'バックベアード',           '', 750, 5, true),
  ('e0000000-0000-4000-8000-000000000001', 'おやじおにぎり',           '',  80, 6, true),
  ('e0000000-0000-4000-8000-000000000001', 'メフィスト３世マフィン',   '', 580, 7, true),
  ('e0000000-0000-4000-8000-000000000001', 'タヌキパン',               '', 380, 8, true);

-- ---------------------------------------------------------------- 受付枠
-- 受取日 × 商品。全量を予約で受け付けます（予約で受ける数＝1日の販売数）。
INSERT INTO daily_product_inventory
  (event_date_id, product_id, production_quantity, reserved_quantity,
   is_sold_out, is_hidden, warning_threshold)
SELECT
  d.id,
  p.id,
  CASE
    WHEN d.pickup_date IN (DATE '2026-11-21', DATE '2026-11-22', DATE '2026-11-23',
                           DATE '2026-11-28', DATE '2026-11-29')
    THEN s.hd_qty ELSE s.wd_qty
  END,
  0, false, false, 3
FROM event_dates d
CROSS JOIN products p
JOIN (VALUES
  ('チキンカレー（ルーのみ）', 20, 20),
  ('一反もめんナン',           20, 20),
  ('ぬりかべナン',             10, 10),
  ('キャロットケーキ',         12, 20),
  ('バックベアード',           12, 20),
  ('おやじおにぎり',           35, 35),
  ('メフィスト３世マフィン',   12, 12),
  ('タヌキパン',               20, 20)
) AS s(name, wd_qty, hd_qty) ON s.name = p.name;

COMMIT;
