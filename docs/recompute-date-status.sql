-- ============================================================
-- 受取日の札（受付中 / 残りわずか / 受付終了）を、全日ぶん計算し直す
--
-- 何のため:
--   札はこれまで「1商品でも残り3個以下なら残りわずか」で決めていました。
--   **売り切れた商品（残り0）はその数え上げから外れる**ので、売れるほど
--   「残りわずか」の条件から外れ、全部売り切れて初めて閉じる作りでした。
--
--   2026-11-16 の実データでは、11/21 と 11/23 が10商品中8つ売り切れ・
--   残り1割強なのに「受付中」。逆に 11/19 は46%残っているのに
--   「残りわずか」。6日のうち4日が実体と逆でした。
--
--   新しいルールは **その日の残り合計 ÷ 生産数合計**:
--     0%        → 受付終了
--     20%以下   → 残りわずか
--     それ以上  → 受付中
--
--   札は注文や在庫の保存が起きたときにだけ計算し直されるので、コードを
--   出しただけでは今ある日付は古いままです。これを1度だけ流してください。
--
-- 実行:
--   Neon のコンソール（SQL Editor）にこのまま貼り付けて実行。
--
--   ★ 新しいコードを本番に出した「あと」に実行してください。
--     先に流しても、次の注文が入った時点で古いルールに戻されます。
-- ============================================================


-- ------------------------------------------------------------
-- (1) 実行する前に、何がどう変わるかを見る（読むだけ）
-- ------------------------------------------------------------
WITH stock AS (
  SELECT d.id, d.pickup_date, d.reservation_status,
         CASE WHEN i.is_sold_out OR i.reserved_quantity >= i.production_quantity
              THEN 0 ELSE i.production_quantity - i.reserved_quantity END AS remaining,
         i.production_quantity AS capacity
  FROM event_dates d
  JOIN daily_product_inventory i ON i.event_date_id = d.id
  JOIN products p ON p.id = i.product_id
  WHERE i.is_hidden = false AND p.walk_in_only = false
),
rolled AS (
  SELECT id, pickup_date, reservation_status,
         sum(remaining) AS remaining, sum(capacity) AS capacity
  FROM stock
  GROUP BY id, pickup_date, reservation_status
)
SELECT pickup_date AS 受取日,
       reservation_status AS いまの札,
       CASE
         WHEN remaining <= 0 THEN 'closed'
         WHEN remaining::numeric <= capacity::numeric * 0.2 THEN 'few_left'
         ELSE 'open'
       END AS これからの札,
       remaining AS 残り, capacity AS 生産数,
       round(remaining::numeric * 100 / nullif(capacity, 0), 1) AS 残り割合
FROM rolled
ORDER BY pickup_date;


-- ------------------------------------------------------------
-- (2) 実際に書き換える
-- ------------------------------------------------------------
WITH stock AS (
  SELECT d.id,
         CASE WHEN i.is_sold_out OR i.reserved_quantity >= i.production_quantity
              THEN 0 ELSE i.production_quantity - i.reserved_quantity END AS remaining,
         i.production_quantity AS capacity
  FROM event_dates d
  JOIN daily_product_inventory i ON i.event_date_id = d.id
  JOIN products p ON p.id = i.product_id
  WHERE i.is_hidden = false AND p.walk_in_only = false
),
rolled AS (
  SELECT id, sum(remaining) AS remaining, sum(capacity) AS capacity
  FROM stock GROUP BY id
)
UPDATE event_dates d
SET reservation_status = (
  CASE
    WHEN r.remaining <= 0 THEN 'closed'
    WHEN r.remaining::numeric <= r.capacity::numeric * 0.2 THEN 'few_left'
    ELSE 'open'
  END
)::reservation_status
FROM rolled r
WHERE d.id = r.id;


-- ------------------------------------------------------------
-- (3) 結果の確認
-- ------------------------------------------------------------
SELECT pickup_date AS 受取日, reservation_status AS 札
FROM event_dates
ORDER BY pickup_date;
