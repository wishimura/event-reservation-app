-- ============================================================
-- 0013: トップページに出す商品を選べるようにする
--
-- 何のため:
--   トップの丸い写真は、これまで「商品マスタの並び順の先頭から7件」でした。
--   そのため、テスト商品や似たセット商品が枠を占めてしまいます。
--
--   並び順で調整することもできますが、それをすると**商品選択ページの
--   並びまで一緒に動きます**。見せたい順と、選んでもらう順は別物なので、
--   トップに出すかどうかを別の列で持ちます。
--
--   足した直後は全部 false です。1つも選ばれていないあいだは、これまで
--   どおり並び順の先頭から出るので、画面が空になることはありません。
--   商品マスタで選び始めた時点で、選ばれたものだけに切り替わります。
--
-- 実行:
--   Neon のコンソール（SQL Editor）にこのまま貼り付けて実行。数秒で終わります。
--
--   ★ これは新しいコードを出す「前」に実行してください。
-- ============================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS show_on_top boolean NOT NULL DEFAULT false;

-- drizzle の適用履歴にも記録しておく。履歴テーブルが無い環境では飛ばす。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
  ) THEN
    EXECUTE $sql$
      INSERT INTO drizzle."__drizzle_migrations" (hash, created_at)
      SELECT '8f819c24040d21b802e6b80b297514c1c4bd53c2279413137f25cbc357ac13fe', 1793170816211
      WHERE NOT EXISTS (
        SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = '8f819c24040d21b802e6b80b297514c1c4bd53c2279413137f25cbc357ac13fe'
      )
    $sql$;
  END IF;
END $$;

-- 確認（1 と出ればOK）
SELECT count(*) AS トップ表示の列
FROM information_schema.columns
WHERE table_name = 'products' AND column_name = 'show_on_top';
