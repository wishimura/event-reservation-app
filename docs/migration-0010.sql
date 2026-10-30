-- ============================================================
-- 0010: 決済ログの表を足す
--
-- 何のため:
--   「決済できなかった」というお申し出があったときに、何が起きたのかを
--   あとから確かめられるようにします。
--
--   2026-10-30 のお申し出では、注文も、失敗して取り消された注文も1件も
--   残っていませんでした。決済がサーバーまで届いていなかったためです。
--   失敗はお客様のブラウザの中で起きていて、こちらには何も伝わりません。
--   Vercel の実行ログも1時間ほどで消えます。
--
--   この表には、カード入力欄が出なかった、カード情報の確認で止まった、
--   といった**サーバーに注文が届かない失敗**も記録されます。
--
--   カード番号も、Square のトークンも、ここには入りません。
--
-- 実行:
--   Neon のコンソール（SQL Editor）にこのまま貼り付けて実行。
--   既存のデータには触りません。数秒で終わります。
--
--   ★ これは新しいコードを出す「前」に実行してください。
--     先に実行しておけば、新旧どちらのコードでも動きます。
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_log_stage') THEN
    CREATE TYPE payment_log_stage AS ENUM
      ('card_form', 'tokenize', 'verify', 'submit', 'charge', 'record');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_log_outcome') THEN
    CREATE TYPE payment_log_outcome AS ENUM ('ok', 'declined', 'error', 'abandoned');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS payment_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  stage payment_log_stage NOT NULL,
  outcome payment_log_outcome NOT NULL,
  order_number text,
  amount integer,
  customer_email text,
  message text NOT NULL DEFAULT '',
  detail jsonb,
  user_agent text
);

CREATE INDEX IF NOT EXISTS payment_logs_created_at_idx ON payment_logs (created_at);

-- drizzle の適用履歴にも記録しておく。履歴テーブルが無い環境では飛ばす。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
  ) THEN
    EXECUTE $sql$
      INSERT INTO drizzle."__drizzle_migrations" (hash, created_at)
      SELECT '969b243fde5ab906ca199c0a045dbe098da8ec04cee9d9f6a9ec0e773c218df5', 1793170816208
      WHERE NOT EXISTS (
        SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = '969b243fde5ab906ca199c0a045dbe098da8ec04cee9d9f6a9ec0e773c218df5'
      )
    $sql$;
  END IF;
END $$;

-- 確認（1 になっていればOK）
SELECT count(*) AS 決済ログの表
FROM information_schema.tables
WHERE table_name = 'payment_logs';
