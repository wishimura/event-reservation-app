/**
 * シナリオテスト — 実際のブラウザで、お客様と店舗の導線を通しで確認する。
 *
 * Playwright が要る（依存には入れていない）:
 *   npm i --no-save playwright
 *   BASE_URL=http://localhost:3981 ADMIN_PASSWORD=... \
 *     npx tsx tests/scenario.e2e.ts
 *
 * 使い捨てのデータベースに向けたサーバーに対して実行すること。予約を作る。
 *
 * playwright を依存に入れていないので、このファイルは tsconfig.json の exclude に
 * 入れてある。入れないと `next build` の型チェックが import を解決できずに落ちる。
 */
import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://localhost:3981";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "qa-password";
const CHROME =
  process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok    ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, ok: false, detail });
    console.log(`  FAIL  ${name}\n        ${detail.split("\n")[0]}`);
  }
}

/** 予約を1件通し、注文番号を返す。 */
async function reserve(page: Page, label: string) {
  await page.goto(BASE, { waitUntil: "networkidle" });

  const firstDate = page.locator('a[href^="/reserve/"]').first();
  await firstDate.waitFor({ timeout: 15000 });
  const dateLabel = (await firstDate.innerText()).split("\n")[1] ?? "";
  await firstDate.click();

  await page.waitForURL(/\/reserve\//, { timeout: 15000 });
  await page.getByRole("button", { name: "1つ増やす" }).first().click();

  const proceed = page.getByRole("button", { name: /確認へ進む/ });
  await proceed.click();
  await page.waitForURL(/\/reserve\/confirm/, { timeout: 15000 });

  // 受取時間を選ばずに確定しようとすると止まること
  await page.getByPlaceholder("山田 太郎").fill(`シナリオ ${label}`);
  await page.getByPlaceholder("taro@example.com").fill("scenario@example.com");
  await page.getByPlaceholder("090-1234-5678").fill("090-2222-3333");
  await page.getByRole("button", { name: "注文を確定する" }).click();
  // 最初の1回はサーバーが温まっておらず、固定待ちだと描画が間に合わない
  await page
    .getByText("受取時間を選んでください")
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => {
      throw new Error("受取時間が未選択でも先へ進めてしまう");
    });

  const slot = page.locator("button", { hasText: /^\d{2}:\d{2}〜\d{2}:\d{2}$/ }).first();
  const slotText = await slot.innerText();
  await slot.click();

  await page.getByRole("button", { name: "注文を確定する" }).click();
  await page.waitForURL(/\/reserve\/complete/, { timeout: 20000 });

  // 完了画面は localStorage を読んでから描くので、番号が出るまで待つ
  await page
    .getByText(/ORD-\d{6}-[A-Z0-9]{6}/)
    .first()
    .waitFor({ timeout: 15000 });

  const body = await page.locator("body").innerText();
  const orderNumber = body.match(/ORD-\d{6}-[A-Z0-9]{6}/)?.[0];
  assert.ok(orderNumber, "完了画面に注文番号が出ていない");
  assert.ok(body.includes(slotText), "完了画面に受取時間が出ていない");

  return { orderNumber, slotText, dateLabel };
}

async function main() {
  const browser: Browser = await chromium.launch({ executablePath: CHROME });

  /* ---------------------------------------------- お客様（PC） */
  console.log("\nお客様の予約（PC）");
  const pc = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pcPage = await pc.newPage();
  let placed: Awaited<ReturnType<typeof reserve>> | undefined;

  await step("トップ→受取日→商品→確認→完了まで通る", async () => {
    placed = await reserve(pcPage, "PC");
  });

  await step("店休日 11/24 は受取日の一覧に出ない", async () => {
    await pcPage.goto(BASE, { waitUntil: "networkidle" });
    // 「11/24 は店休日」と注意書きにも出るので、日付の一覧だけを見る
    const dates = await pcPage.locator('a[href^="/reserve/"]').allInnerTexts();
    const joined = dates.join(" ");
    assert.ok(joined.includes("11/18"), "受取日が表示されていない");
    assert.ok(!joined.includes("11/24"), "店休日が受取日の一覧に出ている");
    assert.equal(dates.length, 12, `受取日が ${dates.length} 件（12件のはず）`);
  });

  await step("特定商取引法のページが開ける", async () => {
    await pcPage.goto(`${BASE}/legal/tokushoho`, { waitUntil: "networkidle" });
    assert.match(await pcPage.title(), /特定商取引|ご案内|予約/);
    const text = await pcPage.locator("body").innerText();
    assert.ok(text.includes("特定商取引法"), "見出しが無い");
  });

  await step("存在しない受取日のURLでも落ちない", async () => {
    const res = await pcPage.goto(`${BASE}/reserve/00000000-0000-4000-8000-000000000000`);
    assert.ok((res?.status() ?? 500) < 500, `${res?.status()} が返った`);
  });

  /* ---------------------------------------------- お客様（スマホ） */
  console.log("\nお客様の予約（スマホ 390px）");
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobile.newPage();

  await step("スマホでも同じ導線が最後まで完結する", async () => {
    await reserve(mobilePage, "スマホ");
  });

  await step("スマホで横スクロールが発生しない（お客様側）", async () => {
    for (const path of ["/", "/legal/tokushoho"]) {
      await mobilePage.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      const overflow = await mobilePage.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      assert.ok(overflow <= 1, `${path} が横に ${overflow}px はみ出している`);
    }
  });

  /* ---------------------------------------------- 店舗 */
  console.log("\n店舗の運用");
  const admin = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const adminPage = await admin.newPage();

  await step("ログインして注文一覧に予約が出る", async () => {
    await adminPage.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
    await adminPage.waitForURL(/\/admin\/login/, { timeout: 15000 });
    await adminPage.locator('input[type="password"]').fill(PASSWORD);
    await adminPage.getByRole("button", { name: /ログイン/ }).click();
    await adminPage.waitForURL(/\/admin(?!\/login)/, { timeout: 15000 });

    await adminPage.goto(`${BASE}/admin/orders`, { waitUntil: "networkidle" });
    await adminPage.waitForTimeout(800);
    const text = await adminPage.locator("body").innerText();
    assert.ok(placed?.orderNumber, "先の予約が取れていない");
    assert.ok(text.includes(placed.orderNumber), "注文一覧に予約が出ていない");
    assert.ok(text.includes(placed.slotText), "注文一覧に受取時間が出ていない");
  });

  await step("製造計画に予約数が反映されている", async () => {
    await adminPage.goto(`${BASE}/admin/production`, { waitUntil: "networkidle" });
    await adminPage.waitForSelector("table", { timeout: 15000 });
    const text = await adminPage.locator("table").innerText();
    assert.ok(!text.includes("NaN"), "NaN が表示されている");
    assert.ok(!/undefined/.test(text), "undefined が表示されている");
  });

  await step("管理画面の各ページが 500 を出さない", async () => {
    for (const path of [
      "/admin",
      "/admin/inventory",
      "/admin/production",
      "/admin/orders",
      "/admin/pickup",
      "/admin/products",
      "/admin/settings",
    ]) {
      const res = await adminPage.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      assert.ok((res?.status() ?? 500) < 400, `${path} が ${res?.status()}`);
      const text = await adminPage.locator("body").innerText();
      assert.ok(
        !text.includes("読み込みに失敗"),
        `${path} が「読み込みに失敗しました」を表示している`
      );
    }
  });

  await step("スマホ幅の管理画面で横スクロールが発生しない", async () => {
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const mp = await m.newPage();
    await mp.context().addCookies(await admin.cookies());
    for (const path of ["/admin", "/admin/production", "/admin/pickup", "/admin/settings"]) {
      await mp.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await mp.waitForTimeout(500);
      const overflow = await mp.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      assert.ok(overflow <= 1, `${path} が横に ${overflow}px はみ出している`);
    }
    await m.close();
  });

  await step("受取管理で当日の受け渡しをチェックできる", async () => {
    await adminPage.goto(`${BASE}/admin/pickup`, { waitUntil: "networkidle" });
    await adminPage.waitForTimeout(800);
    const text = await adminPage.locator("body").innerText();
    assert.ok(!text.includes("読み込みに失敗"), "受取管理が読み込めていない");
  });

  /* ---------------------------------------- 在庫と画面のつながり */
  console.log("\n在庫と画面のつながり");

  await step("売り切れの商品は数量を増やせない", async () => {
    // 管理画面でひとつ売り切れにして、お客様側がどう見えるか確かめる
    await adminPage.goto(`${BASE}/admin/inventory`, { waitUntil: "networkidle" });
    await adminPage.waitForTimeout(1200);

    // 「販売中 / 売切」はチェックボックスではなく、押すたびに切り替わるボタン
    const toggle = adminPage.getByRole("button", { name: /^(販売中|売切)$/ }).first();
    await toggle.waitFor({ timeout: 15000 });
    const wasOnSale = (await toggle.innerText()).trim() === "販売中";
    if (wasOnSale) await toggle.click();
    await adminPage.getByRole("button", { name: /保存/ }).first().click();
    await adminPage.waitForTimeout(2000);

    try {
      await pcPage.goto(BASE, { waitUntil: "networkidle" });
      const firstDate = pcPage.locator('a[href^="/reserve/"]').first();
      await firstDate.waitFor({ timeout: 15000 });
      await firstDate.click();
      await pcPage.waitForURL(/\/reserve\//, { timeout: 15000 });
      await pcPage.waitForTimeout(1200);

      const body = await pcPage.locator("body").innerText();
      assert.ok(
        body.includes("SOLD OUT") || body.includes("売り切れ") || body.includes("完売"),
        "売り切れの表示がどこにも出ていない"
      );
    } finally {
      if (wasOnSale) {
        await adminPage.goto(`${BASE}/admin/inventory`, { waitUntil: "networkidle" });
        await adminPage.waitForTimeout(1500);
        const back = adminPage.getByRole("button", { name: /^(販売中|売切)$/ }).first();
        if ((await back.innerText()).trim() === "売切") await back.click();
        await adminPage.getByRole("button", { name: /保存/ }).first().click();
        await adminPage.waitForTimeout(2000);
      }
    }
  });

  await step("残数を超えて数量を増やそうとすると理由が出る", async () => {
    await pcPage.goto(BASE, { waitUntil: "networkidle" });
    const firstDate = pcPage.locator('a[href^="/reserve/"]').first();
    await firstDate.waitFor({ timeout: 15000 });
    await firstDate.click();
    await pcPage.waitForURL(/\/reserve\//, { timeout: 15000 });
    await pcPage.waitForTimeout(1200);

    // 1つの商品カードの中だけを見る。ページ全体から拾うと、別の商品の
    // 数量を読んでしまって話が噛み合わなくなる。
    const card = pcPage
      .locator("[data-product-card]")
      .filter({ has: pcPage.getByRole("button", { name: "1つ増やす" }) })
      .first();
    await card.waitFor({ timeout: 15000 });
    await card.scrollIntoViewIfNeeded();

    const plus = card.getByRole("button", { name: "1つ増やす" });
    const shown = card.locator("span.tabular-nums").first();

    let last = -1;
    for (let i = 0; i < 60; i++) {
      await card.scrollIntoViewIfNeeded();
      await plus.click({ timeout: 8000 });
      const now = Number((await shown.innerText()).trim());
      if (now === last) break;
      last = now;
    }

    assert.ok(last > 0, `数量が増えていない（${last}）`);

    // 上限で止まった理由が、その商品のところに出ること
    const notice = card.getByText(/これ以上は追加できません/);
    await notice.waitFor({ timeout: 5000 });

    const cap = (await notice.innerText()).match(/在庫が残り(\d+)個のため/);
    assert.ok(cap, "上限の案内に残数が入っていない");
    assert.equal(last, Number(cap[1]), "止まった数量と案内の残数が食い違う");
  });

  await step("管理画面でキャンセルすると、お客様側の残数が戻る", async () => {
    assert.ok(placed?.orderNumber, "先の予約が取れていない");

    await adminPage.goto(`${BASE}/admin/orders`, { waitUntil: "networkidle" });
    await adminPage.waitForTimeout(1500);

    const text = await adminPage.locator("body").innerText();
    assert.ok(text.includes(placed.orderNumber), "注文一覧に予約が出ていない");

    // キャンセルは確認ダイアログを伴う
    adminPage.once("dialog", (d) => d.accept());
    const row = adminPage.locator("tr", { hasText: placed.orderNumber }).first();
    const cancel = row.getByRole("button", { name: /キャンセル/ }).first();
    if ((await cancel.count()) > 0) {
      await cancel.click();
      await adminPage.waitForTimeout(2000);
      const after = await adminPage.locator("body").innerText();
      assert.ok(
        after.includes("キャンセル"),
        "キャンセルした結果が画面に出ていない"
      );
    }
  });

  await step("注文一覧のCSVが実際に落ちてくる", async () => {
    await adminPage.goto(`${BASE}/admin/orders`, { waitUntil: "networkidle" });
    await adminPage.waitForTimeout(1200);

    const [download] = await Promise.all([
      adminPage.waitForEvent("download", { timeout: 20000 }),
      adminPage.getByRole("button", { name: /CSV/ }).first().click(),
    ]);
    const name = download.suggestedFilename();
    assert.match(name, /\.csv$/, `CSVでないファイルが落ちてきた: ${name}`);
  });

  await step("店頭販売を登録すると製造計画の数が増える", async () => {
    await adminPage.goto(`${BASE}/admin/production`, { waitUntil: "networkidle" });
    await adminPage.waitForSelector("table", { timeout: 15000 });
    const before = await adminPage.locator("table").innerText();

    await adminPage.goto(`${BASE}/admin/orders`, { waitUntil: "networkidle" });
    await adminPage.waitForTimeout(1200);
    await adminPage.getByRole("button", { name: /店頭販売を登録/ }).first().click();
    await adminPage.waitForTimeout(2000);

    // 最初の商品を1つ足して登録
    const plus = adminPage.locator('button[aria-label$="を1つ増やす"]').first();
    await plus.waitFor({ timeout: 10000 });
    await plus.click();
    await adminPage.waitForTimeout(300);
    await adminPage.getByRole("button", { name: "この内容で登録" }).click();
    await adminPage.waitForTimeout(2500);

    const toast = await adminPage.locator("body").innerText();
    assert.ok(
      toast.includes("店頭販売を登録しました") || toast.includes("ORD-"),
      "店頭販売の登録結果が画面に出ていない"
    );

    await adminPage.goto(`${BASE}/admin/production`, { waitUntil: "networkidle" });
    await adminPage.waitForSelector("table", { timeout: 15000 });
    const after = await adminPage.locator("table").innerText();
    assert.notEqual(after, before, "店頭販売が製造計画に反映されていない");
  });

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n通過 ${results.length - failed.length} / ${results.length}`);
  if (failed.length) {
    console.log("\n失敗:");
    for (const f of failed) console.log(`  - ${f.name}\n    ${f.detail}`);
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
