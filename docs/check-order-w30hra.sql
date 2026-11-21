-- ORD-261108-W30HRA が「キャンセル未処理」になっている理由を切り分ける。
--
-- 写真のメモは店舗の手書きで、アプリには「未処理」という状態はありません。
-- なので、止まっているのが (1) アプリ上のキャンセル操作なのか
-- (2) Square での返金なのか を、まずデータで確定させます。
--
-- 個人情報はこのファイルに書きません。注文番号から引いて、同じお客様の
-- 他の注文は自己結合で探します。

-- ① この注文の今の状態
--    order_status   = cancelled なら、アプリ側のキャンセルは完了している
--    payment_status = paid のままなら、Square の返金がまだ
SELECT
  o.order_number,
  o.order_status,
  o.payment_status,
  o.payment_method,
  o.total_amount,
  o.dining_style,
  o.source,
  o.created_at AT TIME ZONE 'Asia/Tokyo' AS 注文日時_JST,
  o.paid_at    AT TIME ZONE 'Asia/Tokyo' AS 決済日時_JST,
  d.pickup_date AS 受取日,
  o.square_payment_id
FROM orders o
JOIN event_dates d ON d.id = o.event_date_id
WHERE o.order_number = 'ORD-261108-W30HRA';

-- ② 同じお客様の他の注文（確認メールが届かず二重に注文した、を疑う）
--    2行以上出たら、どちらを残すかの判断が要る
SELECT
  o.order_number,
  o.order_status,
  o.payment_status,
  o.total_amount,
  o.created_at AT TIME ZONE 'Asia/Tokyo' AS 注文日時_JST,
  d.pickup_date AS 受取日
FROM orders o
JOIN event_dates d ON d.id = o.event_date_id
WHERE o.customer_email = (
        SELECT customer_email FROM orders WHERE order_number = 'ORD-261108-W30HRA'
      )
ORDER BY o.created_at;

-- ③ この注文にまつわる記録（確認メールが出せていたかどうか）
--    customer_mail の最後の行が error なら、お客様は注文確認を受け取れていない
SELECT
  created_at AT TIME ZONE 'Asia/Tokyo' AS 時刻_JST,
  area, source, stage, outcome, message
FROM incident_logs
WHERE order_number = 'ORD-261108-W30HRA'
ORDER BY created_at;
