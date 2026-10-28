import { expect, test } from "@playwright/test";
import {
  closeE2eDb,
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

test.describe("S-02 お召し上がり方法", () => {
  test("どちらも最初から選ばれてはいない", async ({ page }) => {
    await page.goto(`/reserve/${data.today.id}`);
    await productCard(page, FIXTURE.plenty.name)
      .getByRole("button", { name: "1つ増やす" })
      .click();
    await page.getByRole("button", { name: /確認へ進む/ }).click();
    await page.waitForURL(/\/reserve\/confirm/);

    await expect(page.getByText("お召し上がり方法")).toBeVisible();
    // どちらかが既定で選ばれていると、お客様が選ばないまま通ってしまう。
    await expect(
      page.locator('[aria-pressed="true"], [data-selected="true"]')
    ).toHaveCount(0);
  });

  test("選ばずに送ると止まり、注文も作られない", async ({ page }) => {
    await reserve(page, {
      product: FIXTURE.plenty.name,
      name: "未選択 太郎",
      diningStyle: "takeout",
      // reserve の中で、選ばずに送ると止まることを確かめている
      checkUnselected: true,
    });
  });

  test("店内なら「来店日」、持ち帰りなら「受取日」と呼ぶ", async ({ page }) => {
    await reserve(page, {
      product: FIXTURE.plenty.name,
      name: "店内 太郎",
      diningStyle: "eat_in",
      email: "eatin@example.com",
    });
    await expect(page.getByText("来店日", { exact: true })).toBeVisible();
    await expect(page.getByText("イートイン", { exact: true })).toBeVisible();
    // 店内のお客様に「お受け取り」とは申し上げない。
    await expect(page.locator("main")).not.toContainText("受取時にこの番号");

    await reserve(page, {
      product: FIXTURE.plenty.name,
      name: "持ち帰り 太郎",
      diningStyle: "takeout",
      email: "takeout@example.com",
    });
    await expect(page.getByText("受取日", { exact: true })).toBeVisible();
    await expect(page.getByText("テイクアウト", { exact: true })).toBeVisible();
  });

  test("売値は区分で1円も変わらない", async ({ page }) => {
    // 変わるのはお店が納める消費税だけ。お客様の支払額は同じ。
    const eatIn = await reserve(page, {
      product: FIXTURE.plenty.name,
      name: "同額 太郎",
      diningStyle: "eat_in",
      email: "same-eatin@example.com",
    });
    const eatInTotal = await page.getByText(/^¥[\d,]+$/).last().innerText();

    const takeout = await reserve(page, {
      product: FIXTURE.plenty.name,
      name: "同額 次郎",
      diningStyle: "takeout",
      email: "same-takeout@example.com",
    });
    const takeoutTotal = await page.getByText(/^¥[\d,]+$/).last().innerText();

    expect(eatIn.orderNumber).not.toBe(takeout.orderNumber);
    expect(takeoutTotal).toBe(eatInTotal);
    expect(eatInTotal).toContain(FIXTURE.plenty.price.toLocaleString("ja-JP"));
  });
});
