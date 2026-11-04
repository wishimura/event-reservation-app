-- ============================================================
-- 0012: 商品の写真を複数にする／この端末に覚えたカード
--
-- 何のため:
--   1) 商品に2枚目以降の写真を持たせます（products.extra_image_urls）。
--      一覧の見た目は変わりません。詳細を開いたときにだけ並びます。
--
--   2) 「2回目以降、カードを入れ直さなくていい」ための表を作ります。
--
--      ★ この表にカード番号は入りません。 預かるのは Square で、
--        こちらが持つのは Square の中を指す id と、お客様に
--        「どのカードか」を示す下4桁・ブランドだけです。
--
--      鍵になるのは、端末に置いた無記名の長い乱数（Cookie）です。
--      メールアドレスを鍵にすると、他人のメールアドレスを打った人に
--      その人のカードが出てしまうため、そうはしていません。
--
-- 実行:
--   Neon のコンソール（SQL Editor）にこのまま貼り付けて実行。数秒で終わります。
--
--   ★ これは新しいコードを出す「前」に実行してください。
-- ============================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS extra_image_urls text[] NOT NULL DEFAULT '{}'::text[];

CREATE TABLE IF NOT EXISTS saved_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_token_hash text NOT NULL,
  square_customer_id text NOT NULL,
  square_card_id text NOT NULL,
  card_brand text NOT NULL DEFAULT '',
  last4 text NOT NULL DEFAULT '',
  exp_month integer,
  exp_year integer,
  customer_name text NOT NULL DEFAULT '',
  customer_email text NOT NULL DEFAULT '',
  customer_phone text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  CONSTRAINT saved_cards_device_token_hash_key UNIQUE (device_token_hash)
);

-- drizzle の適用履歴にも記録しておく。履歴テーブルが無い環境では飛ばす。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
  ) THEN
    EXECUTE $sql$
      INSERT INTO drizzle."__drizzle_migrations" (hash, created_at)
      SELECT 'b5eeb2d0601577e16103485bbef4de204b608b6a7b6f68e8da42d0ba402f9401', 1793170816210
      WHERE NOT EXISTS (
        SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = 'b5eeb2d0601577e16103485bbef4de204b608b6a7b6f68e8da42d0ba402f9401'
      )
    $sql$;
  END IF;
END $$;

-- 確認（写真の列が 1、カードの表が 1 ならOK）
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'extra_image_urls') AS 写真の列,
  (SELECT count(*) FROM information_schema.tables
    WHERE table_name = 'saved_cards') AS カードの表;
