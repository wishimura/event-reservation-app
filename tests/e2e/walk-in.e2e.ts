import { expect, test } from "@playwright/test";
import {
  closeE2eDb,
  FIXTURE,
  loginAsAdmin,
  resetFixture,
  rowContaining,
  type Fixture,
} from "./_helpers";

let data: Fixture;

test.beforeEach(async () => {
  data = await resetFixture();
});

test.afterAll(async () => {
  await closeE2eDb();
});

test.describe("S-06 店頭販売", () => {
  test("登録すると受付枠が減り、店頭として記録され、区分も残る", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/orders");
    await page.getByRole("button", { name: "店頭販売を登録" }).click();

    const form = page.locator("div").filter({ hasText: "ご予約なしで店頭で買われた分" }).last();

    // ラベルが入力欄と紐付いていないので、中身で選び分ける。
    await form
      .locator("select")
      .filter({ hasText: "イートイン（店内" })
      .selectOption("eat_in");

    await form
      .getByRole("button", { name: `${FIXTURE.plenty.name} を1つ増やす` })
      .click();
    await page.getByRole("button", { name: "この内容で登録" }).click();

    await expect(page.getByText(/店頭販売を登録しました/)).toBeVisible();

    const row = rowContaining(page, "店頭のお客様");
    await expect(row).toBeVisible();
    await expect(row).toContainText("店頭");
    await expect(row).toContainText("イートイン");
    await expect(row).toContainText(FIXTURE.plenty.name);

    // 受付枠が1つ減っていること（製造計画は予約数＝製造数）。
    await page.goto("/admin/production");
    await expect(page.locator("main")).toContainText(
      new RegExp(`1\\s*/\\s*(上限\\s*)?${FIXTURE.plenty.capacity}`)
    );
  });

  test("受付枠より多くは登録できない", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/orders");
    await page.getByRole("button", { name: "店頭販売を登録" }).click();

    const form = page.locator("div").filter({ hasText: "ご予約なしで店頭で買われた分" }).last();
    const plus = form.getByRole("button", {
      name: `${FIXTURE.scarce.name} を1つ増やす`,
    });

    // 前提データでこの商品は1個しか作らない。
    await plus.click();
    await expect(plus).toBeDisabled();
    await expect(plus).toHaveAttribute("title", "受付枠がありません");
  });
});
