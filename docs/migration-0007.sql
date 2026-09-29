-- ============================================================
-- 0007: 注文に「二重送信を見分けるID」を追加する
--
-- 何のため:
--   スマホの電波が切れるなどで、決済が通ったのに画面がエラーになると、
--   お客様はもう一度「注文を確定する」を押します。そのままだと2回
--   請求されてしまうため、ブラウザが付けたIDで「同じ注文」と分かる
--   ようにします。
--
-- 実行:
--   Neon のコンソール（SQL Editor）にこのまま貼り付けて実行。
--   既存のデータは変わりません。数秒で終わります。
-- ============================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_request_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_client_request_id_key'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_client_request_id_key UNIQUE (client_request_id);
  END IF;
END $$;

-- drizzle の適用履歴にも記録しておく（次回 migrate で二重適用されないように）。
-- 履歴テーブルが無い環境ではそのまま飛ばす。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
  ) THEN
    EXECUTE $sql$
      INSERT INTO drizzle."__drizzle_migrations" (hash, created_at)
      SELECT 'dd4652da78e262e031214722d1ed78992bf8cdeca8602a0975fdfed7e6a02607',
             1790689294108
      WHERE NOT EXISTS (
        SELECT 1 FROM drizzle."__drizzle_migrations"
        WHERE hash = 'dd4652da78e262e031214722d1ed78992bf8cdeca8602a0975fdfed7e6a02607'
      )
    $sql$;
  END IF;
END $$;

-- 確認
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'client_request_id') AS 列,
  (SELECT count(*) FROM pg_constraint
    WHERE conname = 'orders_client_request_id_key') AS 制約;
