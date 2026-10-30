import { expect, test } from "@playwright/test";
import { closeE2eDb, loginAsAdmin, resetFixture } from "./_helpers";

test.beforeEach(async () => {
  await resetFixture();
});

test.afterAll(async () => {
  await closeE2eDb();
});

const CONSOLE_PAGES = [
  "/admin",
  "/admin/orders",
  "/admin/pickup",
  "/admin/inventory",
  "/admin/production",
  "/admin/products",
  "/admin/settings",
  "/admin/incident-logs",
];

test.describe("S-07 管理画面のログイン", () => {
  test("ログインしていないと、どの画面もログイン画面に戻される", async ({ page }) => {
    // 管理画面にはお客様全員の氏名・メール・電話が入っている。
    // 1枚でも素通りすれば、そこから全部見えてしまう。
    await page.context().clearCookies();
    for (const path of CONSOLE_PAGES) {
      await page.goto(path);
      await expect(page, `${path} が素通りしている`).toHaveURL(/\/admin\/login/);
    }
  });

  test("間違ったパスワードでは入れない", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/admin/login");
    await page.locator('input[type="password"]').fill("not-the-password");
    await page.getByRole("button", { name: /ログイン/ }).click();

    await expect(page.getByText(/失敗|正しくありません|違います/)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("ログアウトすると、戻るボタンでも管理画面に入れない", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/orders");

    await page.getByRole("button", { name: "ログアウト" }).click();
    await page.waitForURL(/\/admin\/login/);

    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("ログイン画面にパスワードが書かれていない", async ({ page }) => {
    // SHOW_LOGIN_HINT を本番に残すと、誰でも開ける画面にパスワードが出る。
    await page.context().clearCookies();
    await page.goto("/admin/login");
    await expect(page.locator("body")).not.toContainText("テスト用の表示");
  });
});
