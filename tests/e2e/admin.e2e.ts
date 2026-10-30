import { expect, test } from "@playwright/test";
import {
  closeE2eDb,
  expectNoHorizontalOverflow,
  FIXTURE,
  loginAsAdmin,
  reserve,
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

const CONSOLE_PAGES = [
  "/admin",
  "/admin/orders",
  "/admin/pickup",
  "/admin/inventory",
  "/admin/production",
  "/admin/products",
  "/admin/settings",
  "/admin/payment-logs",
];

test.describe("S-04 管理画面", () => {
  test("どの画面も、エラーではなく中身を表示する", async ({ page }) => {
    await loginAsAdmin(page);
    for (const path of CONSOLE_PAGES) {
      const res = await page.goto(path);
      expect(res?.status() ?? 500, `${path} が ${res?.status()}`).toBeLessThan(400);
      // 「読み込みに失敗しました」は 200 で返ってくるので、本文も見る。
      await expect(page.locator("body"), path).not.toContainText("読み込みに失敗");
      await expect(page.locator("body"), path).not.toContainText("NaN");
      await expect(page.locator("body"), path).not.toContainText("undefined");
    }
  });

  test("横にはみ出さない（店舗が触る画面）", async ({ page }) => {
    await loginAsAdmin(page);
    for (const path of CONSOLE_PAGES) {
      await page.goto(path);
      await expectNoHorizontalOverflow(page, path);
    }
  });

  test("予約が注文一覧に、提供区分つきで出る", async ({ page }) => {
    const placed = await reserve(page, {
      product: FIXTURE.plenty.name,
      name: "一覧 太郎",
      diningStyle: "eat_in",
      eventDateId: data.today.id,
      email: "list@example.com",
    });

    await loginAsAdmin(page);
    await page.goto("/admin/orders");

    const row = rowContaining(page, placed.orderNumber);
    await expect(row).toBeVisible();
    await expect(row).toContainText("一覧 太郎");
    await expect(row).toContainText("イートイン");
    await expect(row).toContainText(FIXTURE.plenty.name);
  });

  test("予約した数が製造計画に出る", async ({ page }) => {
    await reserve(page, {
      product: FIXTURE.plenty.name,
      name: "製造 太郎",
      diningStyle: "takeout",
      eventDateId: data.today.id,
      quantity: 3,
      email: "production@example.com",
    });

    await loginAsAdmin(page);
    await page.goto("/admin/production");

    /*
      この画面は広いときは表、狭いときはカードで描き分けます。文言が変わるので、
      どちらでも読める形で見ます（「3 / 10」と「予約 3 / 上限 10」）。
    */
    await expect(page.locator("main")).toContainText(FIXTURE.plenty.name);
    await expect(page.locator("main")).toContainText(
      new RegExp(`3\\s*/\\s*(上限\\s*)?${FIXTURE.plenty.capacity}`)
    );
  });

  test("決済までたどり着けなかった失敗が、決済ログに残る", async ({ page }) => {
    /*
      拾いたいのは**サーバーに注文が届かなかった失敗**です。注文もキャンセルも
      残らないので、これが無いとお申し出があっても何も分かりません
      （2026-10-30 に実際にそうなりました）。

      ここではブラウザからの申告を直接送って、管理画面に出るところまでを見ます。
      カード入力欄そのものは Square の鍵が無いと描かれないためです。
    */
    const marker = `e2e-${Date.now()}`;
    const res = await page.request.post("/api/payment-log", {
      data: {
        stage: "card_form",
        outcome: "error",
        message: `決済フォームの読み込みに失敗しました ${marker}`,
        amount: 3950,
        customer_email: "trouble@example.com",
      },
    });
    expect(res.status()).toBe(200);

    await loginAsAdmin(page);
    await page.goto("/admin/payment-logs");

    const row = rowContaining(page, marker);
    await expect(row).toBeVisible();
    await expect(row).toContainText("カード入力欄");
    await expect(row).toContainText("お客様の端末");
    await expect(row).toContainText("エラー");

    // うまくいかなかったものだけに絞っても残る。
    await page.getByText("うまくいかなかったものだけ").click();
    await expect(rowContaining(page, marker)).toBeVisible();
  });

  test("CSV に、納める消費税の根拠が入っている", async ({ page }) => {
    await reserve(page, {
      product: FIXTURE.plenty.name,
      name: "CSV 太郎",
      diningStyle: "eat_in",
      eventDateId: data.today.id,
      email: "csv@example.com",
    });

    await loginAsAdmin(page);
    await page.goto("/admin/orders");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /CSV/ }).first().click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const csv = Buffer.concat(chunks).toString("utf8");

    for (const column of [
      "提供区分",
      "税率",
      "税抜額",
      "消費税額",
      "当日変更",
      "Square決済ID",
    ]) {
      expect(csv, `CSV に「${column}」の列が無い`).toContain(column);
    }
    expect(csv).toContain("イートイン");
    expect(csv).toContain("10%");
  });
});
