-- =====================================================================
-- 受取日の修正
--
--  1. 11/24(火) は店休日。予約を受け付けない日にします。
--  2. 「休日あつかい」＝キャロットケーキとバックベアードを 20 個にする日
--     は、11/21・11/22・11/23・11/28・11/29 の 5 日。それ以外は 12 個。
--
-- UPDATE のみです。予約も商品も消しません。
-- 受付枠を予約数より下げることになる場合は、中断して何も変更しません。
-- =====================================================================
BEGIN;

-- 受付枠を予約済みの数より下げてしまう行がないか、先に確かめる。
DO $$
DECLARE conflict_count integer;
BEGIN
  SELECT count(*) INTO conflict_count
  FROM daily_product_inventory i
  JOIN products p ON p.id = i.product_id
  JOIN event_dates d ON d.id = i.event_date_id
  WHERE p.name IN ('キャロットケーキ', 'バックベアード')
    AND i.reserved_quantity >
        CASE WHEN d.pickup_date IN
               ('2026-11-21','2026-11-22','2026-11-23','2026-11-28','2026-11-29')
             THEN 20 ELSE 12 END;

  IF conflict_count > 0 THEN
    RAISE EXCEPTION '既に予約が入っていて受付枠を下げられない行が % 件あります。', conflict_count;
  END IF;
END $$;

-- 1. 店休日は受付対象から外す（お客様の日付一覧に出なくなります）
UPDATE event_dates
   SET is_active = false
 WHERE pickup_date = '2026-11-24';

-- 2. 曜日で数量が変わる 2 商品の受付枠を引き直す
UPDATE daily_product_inventory i
   SET production_quantity =
         CASE WHEN d.pickup_date IN
                ('2026-11-21','2026-11-22','2026-11-23','2026-11-28','2026-11-29')
              THEN 20 ELSE 12 END
  FROM products p, event_dates d
 WHERE p.id = i.product_id
   AND d.id = i.event_date_id
   AND p.name IN ('キャロットケーキ', 'バックベアード');

-- 3. 売切表示を実態に合わせ直す
UPDATE daily_product_inventory
   SET is_sold_out = (reserved_quantity >= production_quantity);

-- 4. 開催期間は 11/18〜11/30 と出るので、抜けている日の理由を書いておく。
--    （この文言が不要なら、この UPDATE ごと削除してください）
UPDATE events
   SET reservation_note = E'受取時間は各日 11:00〜16:00 です。\n11/24（火）は店休日のため、ご予約を承っておりません。\nお支払いはご予約時にクレジットカードでお願いいたします。\nご予約は受取日の前日23:59までです。\nご予約の変更・キャンセルはお電話でご連絡ください。'
 WHERE is_active;

-- 5. 受取日の受付状態を引き直す
UPDATE event_dates d
   SET reservation_status = sub.status
  FROM (
    SELECT i.event_date_id,
           CASE
             WHEN bool_and(i.is_sold_out) THEN 'closed'
             WHEN bool_or(i.production_quantity - i.reserved_quantity > 0
                      AND i.production_quantity - i.reserved_quantity
                          <= i.warning_threshold) THEN 'few_left'
             ELSE 'open'
           END::reservation_status AS status
      FROM daily_product_inventory i
     WHERE i.is_hidden = false
     GROUP BY i.event_date_id
  ) AS sub
 WHERE d.id = sub.event_date_id;

COMMIT;
