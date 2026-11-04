import type { MetadataRoute } from "next";

/**
 * robots.txt。
 *
 * 公開前でも**蹴りません**。蹴るとクローラはページを読みに来ず、ページに
 * 書いた「載せないで」（noindex）も読まれないからです。読まれなければ、
 * どこかから貼られたリンク経由で URL だけが検索結果に出ることがあります。
 *
 * 載せる・載せないを決めているのは各ページの noindex のほうで、ここは
 * それを読んでもらうために開けてあります（`src/lib/indexing.ts`）。
 *
 * 管理画面だけは、公開後も拾わせる理由がないので常に外します。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api"] }],
  };
}
