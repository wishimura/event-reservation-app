-- ============================================================
-- 0014: 予約は受けず、当日の店頭だけで売る商品を置けるようにする
--
-- 何のため:
--   目玉のおやじおにぎりのように、予約は受けないけれど
--   「こういうものがあります」とは見せたい商品があります。
--
--   これまでは生産数を0にするしかなく、お客様の画面では売り切れと同じ
--   「SOLD OUT」になっていました。作ったのに出せなかったのか、はじめから
--   予約を受けていないのかが区別できません。生産数が0だと店頭販売登録でも
--   打てないので、何個売れたかも残りません。
--
--   そこで、売り方を表す列を1つ足します。true にすると商品選択の画面には
--   並びますが数量は選べず、「当日店頭販売のみ」と出ます。
--   **生産数はふつうに入れてください。** 店頭販売登録から売れば、
--   そのぶん在庫が減って記録に残ります。
--
--   他の商品の「SOLD OUT」は今までどおりです。
--
--   足した直後は全部 false なので、何も変わりません。商品マスタで
--   チェックを入れた商品だけが切り替わります。
--
-- 実行:
--   Neon のコンソール（SQL Editor）にこのまま貼り付けて実行。数秒で終わります。
--
--   ★ これは新しいコードを出す「前」に実行してください。
-- ============================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS walk_in_only boolean NOT NULL DEFAULT false;

-- drizzle の適用履歴にも記録しておく。履歴テーブルが無い環境では飛ばす。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
  ) THEN
    EXECUTE $sql$
      INSERT INTO drizzle."__drizzle_migrations" (hash, created_at)
      SELECT 'f8bf2fd61e3ece90d150ab66a65c2241b35617f6155aa31a5b4955f1646e9018', 1793170816212
      WHERE NOT EXISTS (
        SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = 'f8bf2fd61e3ece90d150ab66a65c2241b35617f6155aa31a5b4955f1646e9018'
      )
    $sql$;
  END IF;
END $$;

-- 確認（1 と出ればOK）
SELECT count(*) AS 当日店頭のみの列
FROM information_schema.columns
WHERE table_name = 'products' AND column_name = 'walk_in_only';
