import { expect, test } from "@playwright/test";
import {
  closeE2eDb,
  expectNoHorizontalOverflow,
  FIXTURE,
  productCard,
  reserve,
  resetFixture,
  type Fixture,
} from "./_helpers";

let data: Fixture;

test.beforeEach(async () => {
  data = await resetFixture();
});

test.afterAll(async () => {
  await closeE2eDb();
});

test.describe("S-01 お客様の予約", () => {
  test("トップから完了画面まで、途中で止まらずに通る", async ({ page }) => {
    const placed = await reserve(page, {
      product: FIXTURE.plenty.name,
      name: "予約 太郎",
      diningStyle: "takeout",
    });

    expect(placed.orderNumber).toMatch(/^ORD-\d{6}-[A-Z0-9]{6}$/);
    await expect(page.getByText(placed.orderNumber)).toBeVisible();
  });

  test("受取時間の枠を選ばせる操作がどこにも残っていない", async ({ page }) => {
    /*
      時間枠はやめた仕様です。消し残すと、選べない欄をお客様に見せることになります。

      ここで見るのは**選ばせる操作が無いこと**であって、「受取時間」という語が
      無いことではありません。本番のご案内文には「受取時間は各日 11:00〜16:00 です」
      と書かれていて、これはお店の文章なので消す理由がないからです。
    */
    const slotPicker = /受取時間|時間帯|時間枠/;

    await page.goto("/");
    await expect(page.getByRole("combobox", { name: slotPicker })).toHaveCount(0);
    await expect(page.getByRole("radio", { name: slotPicker })).toHaveCount(0);
    await expect(page.getByRole("button", { name: slotPicker })).toHaveCount(0);

    await page.goto(`/reserve/${data.today.id}`);
    await productCard(page, FIXTURE.plenty.name)
      .getByRole("button", { name: "1つ増やす" })
      .click();
    await page.getByRole("button", { name: /確認へ進む/ }).click();
    await page.waitForURL(/\/reserve\/confirm/);

    // 選ばせるとしたらこの画面。お召し上がり方法だけが並んでいること。
    await expect(page.getByRole("combobox", { name: slotPicker })).toHaveCount(0);
    await expect(page.getByRole("radio", { name: slotPicker })).toHaveCount(0);
    await expect(page.getByRole("button", { name: slotPicker })).toHaveCount(0);
    await expect(page.locator("select")).toHaveCount(0);
    await expect(page.getByText("お召し上がり方法")).toBeVisible();
  });

  test("受付を止めた日は押せず、直接叩いても注文が通らない", async ({ page }) => {
    await page.goto("/");

    // 日付そのものは出てよい（やっていないことが伝わる）。押せないことが大事。
    await expect(
      page.locator(`a[href="/reserve/${data.closed.id}"]`)
    ).toHaveCount(0);
    await expect(
      page.locator(`a[href="/reserve/${data.today.id}"]`)
    ).toHaveCount(1);

    // 画面を飛ばして直接送っても断られること。
    const res = await page.request.post("/api/orders", {
      data: {
        event_id: data.eventId,
        event_date_id: data.closed.id,
        customer_name: "直打ち 太郎",
        customer_email: "closed@example.com",
        customer_phone: "090-0000-0000",
        payment_method: "cash",
        dining_style: "takeout",
        items: [{ product_id: data.products.plenty, quantity: 1 }],
      },
    });
    expect(res.status()).toBe(400);
  });

  test("存在しない受取日の URL でもエラー画面にならない", async ({ page }) => {
    const res = await page.goto("/reserve/00000000-0000-4000-8000-000000000000");
    expect(res?.status() ?? 500).toBeLessThan(500);

    // UUID ですらない文字列でも同じ。
    const bad = await page.goto("/reserve/not-a-uuid");
    expect(bad?.status() ?? 500).toBeLessThan(500);
  });

  test("売り切れの商品は、売り切れと分かり、数量を増やせない", async ({ page }) => {
    await page.goto(`/reserve/${data.today.id}`);

    const card = productCard(page, FIXTURE.soldOut.name);
    await expect(card).toBeVisible();
    await expect(card).toContainText("SOLD OUT");
    // 売り切れの商品には、そもそも数量の欄を出さない。
    await expect(card.getByRole("button", { name: "1つ増やす" })).toHaveCount(0);
  });

  test("確認画面から戻って商品を足せる。選んでいたものは消えない", async ({ page }) => {
    /*
      「やっぱりこれも」で戻る方はいます。以前は戻るとカゴが空になっていて、
      選び直しからやることになっていました。戻れないのと同じです。
    */
    await page.goto(`/reserve/${data.today.id}`);
    await productCard(page, FIXTURE.plenty.name)
      .getByRole("button", { name: "1つ増やす" })
      .click();
    await page.getByRole("button", { name: /確認へ進む/ }).click();
    await page.waitForURL(/\/reserve\/confirm/);
    await expect(page.locator("main")).toContainText(FIXTURE.plenty.name);

    await page.getByRole("button", { name: "商品を追加・変更する" }).click();
    await page.waitForURL(new RegExp(`/reserve/${data.today.id}$`));

    // 選んでいた1つが残っていること。
    const kept = productCard(page, FIXTURE.plenty.name);
    await expect(kept.locator("span.tabular-nums")).toHaveText("1");

    // もう1品足して、確認画面に両方出ること。
    await productCard(page, FIXTURE.scarce.name)
      .getByRole("button", { name: "1つ増やす" })
      .click();
    await page.getByRole("button", { name: /確認へ進む/ }).click();
    await page.waitForURL(/\/reserve\/confirm/);

    await expect(page.locator("main")).toContainText(FIXTURE.plenty.name);
    await expect(page.locator("main")).toContainText(FIXTURE.scarce.name);
  });

  test("入力が足りないまま押すと、足りない場所まで画面が動く", async ({ page }) => {
    /*
      「注文を確定する」は画面のいちばん下、足りない項目はずっと上にあります。
      押しても画面が動かないと**何も起きなかったように見えます**。
      押した場所に要約を出し、最初の不足まで連れていきます。
    */
    await page.goto(`/reserve/${data.today.id}`);
    await productCard(page, FIXTURE.plenty.name)
      .getByRole("button", { name: "1つ増やす" })
      .click();
    await page.getByRole("button", { name: /確認へ進む/ }).click();
    await page.waitForURL(/\/reserve\/confirm/);

    // 何も入れずに押す。
    const submit = page.getByRole("button", { name: "注文を確定する" });
    await submit.scrollIntoViewIfNeeded();
    await submit.click();

    // 押した場所で反応が返ること。
    await expect(
      page.getByText(/入力が\d+つ足りません|入力が1つ足りません/)
    ).toBeVisible();

    // 最初の不足（お召し上がり方法）が画面の中に入っていること。
    const picker = page.locator("#field-dining_style");
    await expect(picker).toBeInViewport({ timeout: 10_000 });

    // 直せば、要約は消えて先へ進める。
    await page.getByRole("button", { name: /店内で食べる/ }).click();
    await page.getByPlaceholder("山田 太郎").fill("足りない 太郎");
    await page.getByPlaceholder("taro@example.com").fill("enough@example.com");
    await page.getByPlaceholder("090-1234-5678").fill("090-1111-2222");
    await submit.click();
    await page.waitForURL(/\/reserve\/complete/);
  });

  test("横にはみ出さない（お客様が触る画面）", async ({ page }) => {
    for (const path of ["/", `/reserve/${data.today.id}`, "/legal/tokushoho"]) {
      await page.goto(path);
      await expectNoHorizontalOverflow(page, path);
    }
  });
});
