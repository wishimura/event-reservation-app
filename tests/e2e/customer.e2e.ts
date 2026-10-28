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

  test("横にはみ出さない（お客様が触る画面）", async ({ page }) => {
    for (const path of ["/", `/reserve/${data.today.id}`, "/legal/tokushoho"]) {
      await page.goto(path);
      await expectNoHorizontalOverflow(page, path);
    }
  });
});
