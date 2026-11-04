/**
 * 検索エンジンに載せるかどうか。
 *
 * ## 既定は「載せない」
 *
 * 公開前に載ってしまうのは取り返しがつきません。一度拾われると、消しても
 * しばらくは検索結果に残ります。逆に、公開後に載せ忘れても、後から直せば
 * 済みます。取り返しのつかないほうを既定にしてあります。
 *
 * 公開するときに、Vercel の環境変数へ
 *
 *     ALLOW_SEARCH_INDEXING = "true"
 *
 * を足して再デプロイしてください。それ以外の値、あるいは未設定なら
 * 載りません。
 *
 * ## robots.txt では止めません
 *
 * robots.txt で蹴ると、クローラはページを**読みに来ません**。読みに来ない
 * ということは、ページに書いた「載せないで」という指示も読まれません。
 * その結果、どこかから貼られたリンク経由で URL だけが検索結果に出る、
 * ということが起こりえます。
 *
 * 載せないでほしいときは、**読ませたうえで noindex を伝える**のが正しい
 * やり方です。だから robots.txt は通しておきます。
 */
export function allowSearchIndexing(): boolean {
  return process.env.ALLOW_SEARCH_INDEXING === "true";
}

/** 公開前のあいだ、全ページに付ける指示。 */
export const NOINDEX = {
  index: false,
  follow: false,
  nocache: true,
  googleBot: { index: false, follow: false },
} as const;
