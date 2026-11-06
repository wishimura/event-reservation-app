import { expect, test } from "@playwright/test";
import {
  closeE2eDb,
  FIXTURE,
  loginAsAdmin,
  resetFixture,
  reserve,
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

  test("未払いで登録して、あとから決済済みに直せる", async ({ page }) => {
    /*
      カウンターでは「先に商品だけ渡して、お会計はあとで」が起きます。
      これまでは必ず「頂いた」で記録していたので、未払いがそのまま売上に
      混ざっていました。
    */
    await loginAsAdmin(page);
    await page.goto("/admin/orders");
    await page.getByRole("button", { name: "店頭販売を登録" }).click();

    const form = page.locator("div").filter({ hasText: "ご予約なしで店頭で買われた分" }).last();

    await form
      .locator("select")
      .filter({ hasText: "イートイン（店内" })
      .selectOption("takeout");
    await form
      .getByRole("button", { name: `${FIXTURE.plenty.name} を1つ増やす` })
      .click();

    // 「お支払い済み」を外して、未払いで登録する。
    await form.getByText("お支払い済み").click();
    await page.getByRole("button", { name: "この内容で登録" }).click();
    await expect(page.getByText(/店頭販売を登録しました/)).toBeVisible();

    const row = rowContaining(page, "店頭のお客様");
    await expect(row).toContainText("未決済");

    // あとから直せること。
    await row.click();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "「決済済み」にする" }).click();

    await expect(rowContaining(page, "店頭のお客様")).toContainText("決済済み");
  });

  test("ネット予約のお支払い状況は、この画面から変えられない", async ({ page }) => {
    /*
      あちらのお金は Square が持っています。こちらの表示だけ書き換えると、
      二度と突き合わせられなくなるので、ボタン自体を出しません。
    */
    const placed = await reserve(page, {
      product: FIXTURE.plenty.name,
      name: "ネット 太郎",
      diningStyle: "takeout",
      eventDateId: data.today.id,
      email: "online@example.com",
    });

    await loginAsAdmin(page);
    await page.goto("/admin/orders");
    await rowContaining(page, placed.orderNumber).click();

    await expect(
      page.getByRole("button", { name: /「決済済み」にする|「未決済」に戻す/ })
    ).toHaveCount(0);
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
