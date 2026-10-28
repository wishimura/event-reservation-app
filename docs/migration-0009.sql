-- ============================================================
-- 0009: 時間枠の列を片付ける
--
-- 何のため:
--   受取時間の枠を選ぶ仕組みをやめたので、使われなくなった列を消します。
--
-- ★ 実行するタイミングに注意
--
--   これは新しいコードが本番で動いているのを確かめた「あと」に実行して
--   ください。先に消してしまうと、ひとつ前のデプロイに戻したくなったとき、
--   古いコードがこの列を読もうとしてサイトが落ちます。
--
--   手順:
--     1. 0008 を実行
--     2. 新しいコードをデプロイ
--     3. 予約が1件通ることを確認
--     4. ここで 0009 を実行
--
--   急ぐものではありません。残っていても動作に影響はないので、
--   イベントが終わってからでも構いません。
--
--   消すと、過去の注文に入っていた受取時間は失われます。
-- ============================================================

ALTER TABLE orders DROP COLUMN IF EXISTS pickup_time_slot;
ALTER TABLE events DROP COLUMN IF EXISTS pickup_time_slots;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
  ) THEN
    EXECUTE $sql$
      INSERT INTO drizzle."__drizzle_migrations" (hash, created_at)
      SELECT '1aeb493362c35daa23cc30d748249844ea8986ac0a65cbaff03061e45d8b5611',
             1793170816207
      WHERE NOT EXISTS (
        SELECT 1 FROM drizzle."__drizzle_migrations"
        WHERE hash = '1aeb493362c35daa23cc30d748249844ea8986ac0a65cbaff03061e45d8b5611'
      )
    $sql$;
  END IF;
END $$;

-- 確認（両方 0 になっていればOK）
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'pickup_time_slot') AS 注文の受取時間,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'pickup_time_slots') AS 時間枠の設定;
