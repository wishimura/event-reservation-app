-- ============================================================
-- 0011: 決済ログを「調査ログ」に広げる
--
-- 何のため:
--   0010 で入れた payment_logs を、決済以外にも使えるようにします。
--
--   確認メールが送れなかった、お客様の画面が落ちた、サーバーが想定外に
--   失敗した。どれも**画面を見ているだけでは分からず、Vercel のログは
--   1時間で消えます**。調べる先を1か所にまとめます。
--
--   やること:
--     - payment_logs を incident_logs に改名
--     - stage / outcome を列挙型から文字列に（記録を増やすたびに
--       データベースの型を変えずに済むように）
--     - area（決済・メール・画面・データ・サーバー）と path を追加
--
--   既存の行はそのまま残り、area は 'payment' になります。
--
-- 実行:
--   Neon のコンソール（SQL Editor）にこのまま貼り付けて実行。数秒で終わります。
--
--   ★ これは新しいコードを出す「前」に実行してください。
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payment_logs')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'incident_logs')
  THEN
    ALTER TABLE payment_logs RENAME TO incident_logs;
    ALTER INDEX IF EXISTS payment_logs_created_at_idx RENAME TO incident_logs_created_at_idx;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS incident_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  stage text NOT NULL,
  outcome text NOT NULL,
  order_number text,
  amount integer,
  customer_email text,
  message text NOT NULL DEFAULT '',
  detail jsonb,
  user_agent text
);

ALTER TABLE incident_logs ALTER COLUMN stage TYPE text USING stage::text;
ALTER TABLE incident_logs ALTER COLUMN outcome TYPE text USING outcome::text;
ALTER TABLE incident_logs ADD COLUMN IF NOT EXISTS area text NOT NULL DEFAULT 'payment';
ALTER TABLE incident_logs ADD COLUMN IF NOT EXISTS path text;

CREATE INDEX IF NOT EXISTS incident_logs_created_at_idx ON incident_logs (created_at);
CREATE INDEX IF NOT EXISTS incident_logs_area_idx ON incident_logs (area);

-- drizzle の適用履歴にも記録しておく。履歴テーブルが無い環境では飛ばす。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
  ) THEN
    EXECUTE $sql$
      INSERT INTO drizzle."__drizzle_migrations" (hash, created_at)
      SELECT '683ba39075f756909d6471d21983717ccbc1a37ca13f6406821517aaf8d0500f', 1793170816209
      WHERE NOT EXISTS (
        SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = '683ba39075f756909d6471d21983717ccbc1a37ca13f6406821517aaf8d0500f'
      )
    $sql$;
  END IF;
END $$;

-- 確認（area と path が 1 ずつ、payment_logs が 0 ならOK）
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'incident_logs' AND column_name = 'area') AS 種別の列,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'incident_logs' AND column_name = 'path') AS 経路の列,
  (SELECT count(*) FROM information_schema.tables
    WHERE table_name = 'payment_logs') AS 旧い表;
