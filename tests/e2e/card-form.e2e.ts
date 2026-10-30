import { expect, test } from "@playwright/test";
import {
  closeE2eDb,
  e2eDb,
  FIXTURE,
  productCard,
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

/**
 * カード払いが有効なときの確認画面。
 *
 * E2E のサーバーには Square の鍵を渡していません（渡すと本物のカードを
 * 叩きに行きます）。そのままではカード欄まわりが一度も描かれず、
 * **本番で2回も壊れたのに、テストからは丸ごと見えない**状態でした。
 *
 * そこで `/api/payments/config` の返事だけを差し替えて、カード払いが有効な
 * 画面を作ります。Square 本体には届かないので最後は失敗しますが、
 * 確かめたいのは「欄の置き場所が用意されるか」と「転んだことが記録に
 * 残るか」なので、それで足ります。
 */
async function pretendCardPaymentIsOn(page: import("@playwright/test").Page) {
  await page.route("**/api/payments/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabled: true,
        applicationId: "sandbox-sq0idb-e2e",
        locationId: "E2ELOCATION",
      }),
    });
  });
}

async function goToConfirm(page: import("@playwright/test").Page) {
  await page.goto(`/reserve/${data.today.id}`);
  await productCard(page, FIXTURE.plenty.name)
    .getByRole("button", { name: "1つ増やす" })
    .click();
  await page.getByRole("button", { name: /確認へ進む/ }).click();
  await page.waitForURL(/\/reserve\/confirm/);
}

test.describe("S-09 カード払いの画面", () => {
  test("カード欄の置き場所が、必ず画面に用意される", async ({ page }) => {
    /*
      ここが無いまま Square を差し込もうとして、本番で2件目の注文だけが
      「決済フォームの読み込みに失敗しました」になりました。買い物かごを
      読み終わるまで画面は「読み込み中...」だけを描くので、立ち上げを急ぐと
      置き場所がまだ存在しません。
    */
    await pretendCardPaymentIsOn(page);
    await goToConfirm(page);

    await expect(page.locator("#square-card")).toBeAttached();
    await expect(page.getByText("クレジットカード", { exact: true })).toBeVisible();
    /*
      「またはカード番号を入力」の区切り線は、Apple Pay / Google Pay が
      使えるときにだけ出ます。ここでは Square に届かないので出ません。
    */
  });

  test("立ち上げに失敗したら、そのことが記録に残る", async ({ page }) => {
    /*
      お客様の端末で起きる失敗はサーバーに何も残しません。注文も、取り消された
      注文も作られないので、記録が無ければ後から何も分かりません
      （2026-10-30 のお申し出がこれでした）。
    */
    await pretendCardPaymentIsOn(page);
    await goToConfirm(page);

    // Square には届かないので、必ずどこかで転ぶ。それが残っていること。
    await expect
      .poll(
        async () => {
          const { rows } = await e2eDb().query<{ count: string }>(
            `select count(*) as count from payment_logs
              where source = 'browser' and stage = 'card_form'`
          );
          return Number(rows[0].count);
        },
        {
          message: "カード欄の立ち上げに失敗したのに、記録が残っていない",
          timeout: 30_000,
        }
      )
      .toBeGreaterThan(0);

    const { rows } = await e2eDb().query<{ message: string; detail: unknown }>(
      `select message, detail from payment_logs
        where source = 'browser' and stage = 'card_form'
        order by created_at desc limit 1`
    );
    expect(rows[0].message.length).toBeGreaterThan(0);
    // 何が起きたのかが分かること。空の記録では調べられない。
    expect(JSON.stringify(rows[0].detail)).toMatch(/reason/);
  });
});
