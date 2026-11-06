-- トップページの丸い写真に出す商品を決めるSQL。
-- 2段階で実行します。STEP 1 で名前を確認してから STEP 2 を打ってください。

-- ================================================================
-- STEP 1：いまの商品名を確認する（これは読むだけ。何も変わりません）
-- ================================================================
SELECT id, name, sort_order, show_on_top, is_active,
       (image_url IS NOT NULL) AS 写真あり
FROM products
ORDER BY sort_order, name;


-- ================================================================
-- STEP 2：トップに出す6品をチェックする
--   STEP 1 の名前が下のコメントと食い違っていたら、
--   LIKE の中身をその名前に合わせて直してから打ってください。
-- ================================================================
BEGIN;

-- いったん全部外す（前に付けたチェックが残っていても混ざらないように）
UPDATE products SET show_on_top = false;

-- 出す6品
UPDATE products SET show_on_top = true
WHERE is_active = true
  AND (
       name LIKE '%一反もめん%カレー%'   -- 一反もめん＆カレー2種セット
    OR name LIKE '%一反もめんナン%'       -- 一反もめんナン（単品）
    OR name LIKE '%ぬりかべ%ナン%'        -- ぬりかべチーズナン（単品）
    OR name LIKE '%タヌキなん%'           -- タヌキなん！？（単品）
    OR name LIKE '%ミネストローネ%'       -- 野菜たっぷりミネストローネスープ
    OR name LIKE '%油すまし%'             -- 油すましふぉんマロン
  );

-- 確認：ここに6行、狙った商品だけが並ぶこと。
-- 「写真あり」が false の行はトップに出ません（写真が条件）。
-- 行数が違う／知らない商品が混じっていたら COMMIT せずに ROLLBACK; を打ってください。
SELECT name, sort_order, show_on_top,
       (image_url IS NOT NULL) AS 写真あり
FROM products
WHERE show_on_top
ORDER BY sort_order, name;

COMMIT;
