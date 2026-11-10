import { expect, test } from "@playwright/test";
import { closeE2eDb, loginAsAdmin, resetFixture, type Fixture } from "./_helpers";

let data: Fixture;

test.beforeEach(async () => {
  data = await resetFixture();
});

test.afterAll(async () => {
  await closeE2eDb();
});

/**
 * 公開したので、お客様向けの画面は検索エンジンに載せます。
 *
 * 見落としやすいところです。Vercel はデプロイ用の URL
 * （`...-bh6ss0ty4-...vercel.app`）には noindex を自動で付けますが、
 * **本番の URL には付けません**。ヘッダーだけ見て判断はできないので、
 * 本番と同じ作りのページを開いて中身を見ます。
 */
test.describe("S-10 検索エンジンへの掲載", () => {
  test("お客様向けの画面が、検索エンジンに載るようになっている", async ({ page }) => {
    /*
      公開前は全ページに noindex を付けていました。外し忘れると、
      **誰にも見つけてもらえないまま会期が終わります**。消し忘れても
      画面は何も変わらないので、ここで見ておきます。
    */
    const paths = ["/", `/reserve/${data.today.id}`, "/legal/tokushoho"];

    for (const path of paths) {
      await page.goto(path);
      const robots = page.locator('meta[name="robots"]');
      const content = (await robots.count())
        ? await robots.getAttribute("content")
        : null;
      expect(content ?? "", `${path} に noindex が残っている`).not.toMatch(
        /noindex/
      );
    }
  });

  test("管理画面は、いつでも載らない", async ({ page }) => {
    /*
      お客様向けの画面は載るようになりましたが、管理画面はそれとは関係なく、
      ずっと載りません。入られれば予約全部の氏名・メール・電話が見える
      ところです。**この1本だけは、公開しても緩めません。**
    */
    await page.goto("/admin/login");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/
    );

    await loginAsAdmin(page);
    await page.goto("/admin/orders");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/
    );
  });

  test("robots.txt はクローラを締め出さない（締め出すと noindex が読まれない）", async ({
    page,
  }) => {
    /*
      robots.txt で蹴ると、クローラはページを読みに来ません。読みに来ない
      ということは、ページに書いた noindex も読まれません。どこかから
      貼られたリンク経由で、URL だけが検索結果に出ることがあります。

      載せないでほしいときは、読ませたうえで noindex を伝えるのが正しい
      やり方です。だからここは開けておきます。
    */
    const res = await page.request.get("/robots.txt");
    expect(res.status()).toBe(200);

    const body = await res.text();
    expect(body, "robots.txt がお客様向けの画面ごと締め出している").not.toMatch(
      /^\s*Disallow:\s*\/\s*$/m
    );
    // 管理画面と API は、読みに来てもらう必要がない。
    expect(body).toMatch(/Disallow:\s*\/admin/);
    expect(body).toMatch(/Disallow:\s*\/api/);
  });
});
