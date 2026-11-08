-- ============================================================
-- 「メール未送信」の調査
--
-- 読むだけです。何も変えません。Neon の SQL Editor に貼って実行してください。
-- 1つずつ上から実行すると、原因が絞れます。
-- ============================================================


-- ------------------------------------------------------------
-- (1) そもそもメールの記録がどれだけあるか
--
--   stage の意味:
--     customer_mail … お客様あての確認メール
--     shop_mail     … お店あての通知メール
--     mail_config   … 設定そのものが無い（この場合、一通も出ていません）
--
--   mail_config が並んでいたら、原因は個別の失敗ではなく設定です。(4) へ。
-- ------------------------------------------------------------
SELECT stage, outcome, count(*) AS 件数,
       min(created_at) AS 最初, max(created_at) AS 最後
FROM incident_logs
WHERE area = 'email'
GROUP BY stage, outcome
ORDER BY 最後 DESC;


-- ------------------------------------------------------------
-- (2) 注文一覧に「メール未送信」が出ている注文（これが一覧のバッジの正体）
--
--   reason に配信事業者が返した理由が入っています。よくあるもの:
--     - ドメイン未認証（MAIL_FROM のドメインが Resend で未検証）
--     - アドレスの形式不正（お客様の打ち間違い）
--     - 送信上限超過
-- ------------------------------------------------------------
SELECT created_at, order_number, customer_email, message,
       detail->>'reason' AS reason,
       detail
FROM incident_logs
WHERE area = 'email' AND stage = 'customer_mail' AND outcome = 'error'
ORDER BY created_at DESC
LIMIT 50;


-- ------------------------------------------------------------
-- (3) その注文が今どうなっているか（お客様に連絡する先を出す）
--
--   予約そのものは生きています。メールが届いていないだけなので、
--   電話番号にご連絡して注文番号をお伝えすれば済みます。
-- ------------------------------------------------------------
SELECT o.order_number, o.customer_name, o.customer_phone, o.customer_email,
       o.order_status, o.payment_status, o.pickup_status,
       d.pickup_date, o.created_at
FROM orders o
JOIN event_dates d ON d.id = o.event_date_id
WHERE o.order_number IN (
  SELECT DISTINCT order_number
  FROM incident_logs
  WHERE area = 'email' AND stage = 'customer_mail' AND outcome = 'error'
    AND order_number IS NOT NULL
)
ORDER BY d.pickup_date, o.created_at;


-- ------------------------------------------------------------
-- (4) 「一件も送れていない」状態になっていないかの確認
--
--   ネット予約の件数と、メールを送れた形跡のある件数を比べます。
--   成功の記録は残していないので、ここで見るのは
--   **失敗も設定エラーも無いまま注文だけがある** かどうかです。
--
--   注文はあるのに email のログが一件も無い → 正常に送れています。
--   注文があって mail_config のログが並ぶ   → 設定が無く、一通も出ていません。
-- ------------------------------------------------------------
SELECT
  (SELECT count(*) FROM orders WHERE source = 'online') AS ネット予約,
  (SELECT count(*) FROM incident_logs
    WHERE area = 'email' AND stage = 'mail_config') AS 設定エラー,
  (SELECT count(DISTINCT order_number) FROM incident_logs
    WHERE area = 'email' AND stage = 'customer_mail' AND outcome = 'error')
    AS お客様メール失敗,
  (SELECT count(DISTINCT order_number) FROM incident_logs
    WHERE area = 'email' AND stage = 'shop_mail' AND outcome = 'error')
    AS お店メール失敗;
