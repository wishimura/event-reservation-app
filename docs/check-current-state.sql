-- =====================================================================
-- 現状確認（SELECT のみ。何も変更しません）
-- 3つの結果が順に出ます。
-- =====================================================================

-- ① 既存の予約。1件でもあると入れ替えSQLは中断します。
--    決済IDがある行は、実際にカードで課金されています。
--    データを消す前に Square 側で返金を済ませてください。
SELECT
  o.order_number                      AS 注文番号,
  d.pickup_date                       AS 受取日,
  o.customer_name                     AS お名前,
  o.total_amount                      AS 金額,
  o.payment_method                    AS 支払方法,
  o.order_status                      AS 状態,
  COALESCE(o.square_payment_id, '(カード決済なし)') AS Square決済ID
FROM orders o
JOIN event_dates d ON d.id = o.event_date_id
ORDER BY o.created_at;

-- ② 受取時間の列があるか（STEP 1 が通っているかの確認）
SELECT
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'events' AND column_name = 'pickup_time_slots'
  ) THEN 'STEP 1 は適用済み'
    ELSE 'STEP 1 が未適用です'
  END AS スキーマ状態;

-- ③ いま登録されているイベントと商品。
--    ここに「ゲゲゲ忌メニュー」と8商品が出ていなければ、
--    STEP 2 は適用されていません。
SELECT e.name AS イベント名, count(p.id) AS 商品数,
       (SELECT count(*) FROM event_dates WHERE event_id = e.id) AS 受取日数
  FROM events e
  LEFT JOIN products p ON p.event_id = e.id
 GROUP BY e.id, e.name;
