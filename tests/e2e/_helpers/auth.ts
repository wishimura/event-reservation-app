/**
 * 管理画面へのログイン。
 */
import { expect, type Page } from "@playwright/test";

export function adminPassword(): string {
  return process.env.ADMIN_PASSWORD ?? "qa-password";
}

/**
 * 管理画面に入る。
 *
 * 先に Cookie を捨てます。`/admin/login` はログイン済みなら管理画面へ飛ばすので
 * （正しい挙動です）、入ったまま2回目を呼ぶと「パスワード欄が無い」で落ちます。
 * エラーがログインと関係ない場所を指すので、原因に辿り着くのに時間がかかります。
 */
export async function loginAsAdmin(page: Page, password = adminPassword()) {
  await page.context().clearCookies();
  await page.goto("/admin/login");
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /ログイン/ }).click();
  await page.waitForURL(/\/admin(?!\/login)/);
  // URL が変わった時点では描画が続いている。中身が出るまで待ってから次へ。
  await expect(page.locator("body")).not.toContainText("ログイン");
}
