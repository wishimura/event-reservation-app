-- ============================================================
-- 0008: イートイン／テイクアウトの区分を足す
--
-- 何のため:
--   売値はどちらも同じで、お客様が払う額は1円も変わりません。変わるのは
--   消費税率だけです（持ち帰り8% / 店内10%）。お店が納める税額が違うので、
--   どちらだったかを必ず残します。
--
--   dining_style_changed_at は、当日カウンターで切り替えたときの時刻です。
--   入っていれば「ご予約時の選択から変わった」ということで、税額の根拠を
--   あとから説明するときに使えます。
--
-- 実行:
--   Neon のコンソール（SQL Editor）にこのまま貼り付けて実行。
--   既存の注文は「テイクアウト」として入ります。数秒で終わります。
--
--   ★ これは新しいコードを出す「前」に実行してください。
--     先に実行しておけば、新旧どちらのコードでも動きます。
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dining_style') THEN
    CREATE TYPE dining_style AS ENUM ('eat_in', 'takeout');
  END IF;
END $$;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS dining_style dining_style NOT NULL DEFAULT 'takeout';

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS dining_style_changed_at timestamptz;

-- drizzle の適用履歴にも記録しておく。履歴テーブルが無い環境では飛ばす。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
  ) THEN
    EXECUTE $sql$
      INSERT INTO drizzle."__drizzle_migrations" (hash, created_at)
      SELECT 'a4deb86a4ce206107f5bb97417acbde99c9d8bdd025feaa19f83ec1b03d76b04',
             1793170816206
      WHERE NOT EXISTS (
        SELECT 1 FROM drizzle."__drizzle_migrations"
        WHERE hash = 'a4deb86a4ce206107f5bb97417acbde99c9d8bdd025feaa19f83ec1b03d76b04'
      )
    $sql$;
  END IF;
END $$;

-- 確認（両方 1 になっていればOK）
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'dining_style') AS 区分の列,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'dining_style_changed_at') AS 変更時刻の列;
