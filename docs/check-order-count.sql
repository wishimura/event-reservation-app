-- ============================================================
-- 注文の件数が合っているかを確かめる
--
-- 読むだけです。何も変えません。上から順に実行してください。
--
-- 注文一覧の「308 件」は、次の2つを**どちらも**満たすものだけを数えています。
--   ・開いているイベント（is_active = true のうち、作成が最も古いもの）の注文
--   ・受取日（event_dates）の行が今も存在する注文
-- 件数が減って見える経路は、ほぼこのどちらかです。
-- ============================================================


-- ------------------------------------------------------------
-- (1) まずここだけ見れば分かります
--
--   画面に出る件数 = 308 なら、数え落としはありません。
--   総数 と 画面に出る件数 が食い違っていたら、(2)(3) で中身を見ます。
-- ------------------------------------------------------------
WITH active AS (
  SELECT id FROM events WHERE is_active = true ORDER BY created_at LIMIT 1
)
SELECT
  (SELECT count(*) FROM orders) AS 総数,
  (SELECT count(*) FROM orders WHERE event_id = (SELECT id FROM active))
    AS このイベントの注文,
  (SELECT count(*) FROM orders o
     JOIN event_dates d ON d.id = o.event_date_id
    WHERE o.event_id = (SELECT id FROM active))
    AS 画面に出る件数;


-- ------------------------------------------------------------
-- (2) 受取日ごとの件数
--
--   昨日の記憶と突き合わせる用。キャンセルも含めた数と、
--   生きている注文の数を並べています。
-- ------------------------------------------------------------
SELECT d.pickup_date AS 受取日,
       count(*) AS 全部,
       count(*) FILTER (WHERE o.order_status <> 'cancelled') AS キャンセル以外,
       count(*) FILTER (WHERE o.order_status = 'cancelled') AS キャンセル,
       count(*) FILTER (WHERE o.source = 'walk_in') AS 店頭
FROM orders o
JOIN event_dates d ON d.id = o.event_date_id
GROUP BY d.pickup_date
ORDER BY d.pickup_date;


-- ------------------------------------------------------------
-- (3) 画面から消える注文が無いかの確認
--
--   ここが 0 件なら、消えている注文はありません。
--   行が出たら、その注文は**データベースには在るのに一覧に出ていません**。
-- ------------------------------------------------------------
WITH active AS (
  SELECT id FROM events WHERE is_active = true ORDER BY created_at LIMIT 1
)
SELECT o.order_number, o.customer_name, o.created_at, o.order_status,
       CASE
         WHEN d.id IS NULL THEN '受取日の行が無い'
         ELSE '別のイベントの注文'
       END AS 理由
FROM orders o
LEFT JOIN event_dates d ON d.id = o.event_date_id
WHERE d.id IS NULL
   OR o.event_id <> (SELECT id FROM active)
ORDER BY o.created_at DESC;


-- ------------------------------------------------------------
-- (4) いつ何件入ったか（1時間ごと・日本時間）
--
--   「昨日もっとあった気がする」の突き合わせ用。
--   昨日の山が記憶と合っているかを見てください。
-- ------------------------------------------------------------
SELECT date_trunc('hour', o.created_at AT TIME ZONE 'Asia/Tokyo') AS 時刻,
       count(*) AS 件数
FROM orders o
WHERE o.created_at > now() - interval '3 days'
GROUP BY 1
ORDER BY 1;


-- ------------------------------------------------------------
-- (5) イベントが複数ある場合の確認
--
--   is_active = true が2つ以上あると、一覧は**古いほうだけ**を出します。
--   行が2つ以上出たら、それが原因です。
-- ------------------------------------------------------------
SELECT id, name, is_active, created_at,
       (SELECT count(*) FROM orders WHERE event_id = e.id) AS 注文数
FROM events e
ORDER BY created_at;
