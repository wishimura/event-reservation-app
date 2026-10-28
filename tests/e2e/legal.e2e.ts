import { expect, test } from "@playwright/test";
import { closeE2eDb, resetFixture } from "./_helpers";

test.beforeEach(async () => {
  await resetFixture();
});

test.afterAll(async () => {
  await closeE2eDb();
});

test.describe("S-08 特定商取引法に基づく表記", () => {
  test("予約の画面からたどり着ける", async ({ page }) => {
    // カード決済を載せる以上、この表記が読めないと法律上そもそも売れない。
    await page.goto("/");
    await page.getByRole("link", { name: /特定商取引/ }).click();
    await page.waitForURL(/\/legal\/tokushoho/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "特定商取引法"
    );
  });

  test("埋まっていない項目が残っていない", async ({ page }) => {
    await page.goto("/legal/tokushoho");

    // 載せなければならない項目。空欄のまま公開すると表記として成立しない。
    for (const item of [
      "販売事業者名",
      "運営統括責任者",
      "所在地",
      "電話番号",
      "販売価格",
      "商品代金以外",
      "引渡時期",
      "お支払い方法",
      "返品",
    ]) {
      await expect(page.locator("body"), `「${item}」が無い`).toContainText(item);
    }

    // 空の項目は「準備中」と出る。1つでも残っていれば表記として成立しない。
    await expect(page.locator("body")).not.toContainText("準備中");
    await expect(page.locator("body")).not.toContainText("TODO");
  });
});
