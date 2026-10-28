import { expect, test, type Page } from "@playwright/test";
import {
  closeE2eDb,
  FIXTURE,
  loginAsAdmin,
  productCard,
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

/**
 * 注文一覧で1件キャンセルする。
 *
 * キャンセルのボタンは行を開いた中にあり、確認のダイアログが2回出ます
 * （取り消せない操作なので、わざとそうしてあります）。
 */
async function cancelOrder(page: Page, orderNumber: string) {
  await page.goto("/admin/orders");
  const row = rowContaining(page, orderNumber);
  await expect(row).toBeVisible();
  await row.click();

  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "この注文をキャンセル" }).click();
  await expect(rowContaining(page, orderNumber)).toContainText("キャンセル");
}

test.describe("S-03 在庫", () => {
  test("残りの数を超えて入れようとすると、理由と残数が出る", async ({ page }) => {
    // 前提データでこの商品は1個しか作らない。
    await page.goto(`/reserve/${data.today.id}`);
    const card = productCard(page, FIXTURE.scarce.name);
    const plus = card.getByRole("button", { name: "1つ増やす" });

    await plus.click();
    await expect(card.locator("span.tabular-nums")).toHaveText("1");

    // 上限でもボタンは押せる。押したときに理由を返すため（無効にはしていない）。
    await plus.click();
    await expect(card).toContainText(
      `在庫が残り${FIXTURE.scarce.capacity}個のため、これ以上は追加できません`
    );
    await expect(card.locator("span.tabular-nums")).toHaveText("1");
  });

  test("1つ売れたら、次のお客様には売り切れて見える", async ({ page }) => {
    await reserve(page, {
      product: FIXTURE.scarce.name,
      name: "先着 太郎",
      diningStyle: "takeout",
      eventDateId: data.today.id,
      email: "first@example.com",
    });

    await page.goto(`/reserve/${data.today.id}`);
    const card = productCard(page, FIXTURE.scarce.name);
    await expect(card).toContainText("SOLD OUT");
    await expect(card.getByRole("button", { name: "1つ増やす" })).toHaveCount(0);
  });

  test("管理画面でキャンセルすると、お客様側の残りが戻る", async ({ page }) => {
    const placed = await reserve(page, {
      product: FIXTURE.scarce.name,
      name: "取消 太郎",
      diningStyle: "takeout",
      eventDateId: data.today.id,
      email: "cancel@example.com",
    });

    await loginAsAdmin(page);
    await cancelOrder(page, placed.orderNumber);

    await page.goto(`/reserve/${data.today.id}`);
    const card = productCard(page, FIXTURE.scarce.name);
    await expect(card).not.toContainText("SOLD OUT");
    await expect(card.getByRole("button", { name: "1つ増やす" })).toBeVisible();
  });

  test("売切にすると、お客様の画面でも売切になる", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/inventory");
    await page.getByRole("button", { name: /\(今日\)$/ }).click();

    // 「販売中 / 売切」は押すたびに切り替わるボタン。対象の行に絞ってから探す。
    const row = rowContaining(page, FIXTURE.plenty.name);
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "販売中" }).click();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText(/件を保存しました/)).toBeVisible();

    await page.goto(`/reserve/${data.today.id}`);
    await expect(productCard(page, FIXTURE.plenty.name)).toContainText("SOLD OUT");
  });

  test("受付上限を予約数より下げようとすると、商品名つきで断られる", async ({ page }) => {
    await reserve(page, {
      product: FIXTURE.plenty.name,
      name: "枠 太郎",
      diningStyle: "takeout",
      eventDateId: data.today.id,
      quantity: 2,
      email: "cap@example.com",
    });

    await loginAsAdmin(page);
    await page.goto("/admin/inventory");
    await page.getByRole("button", { name: /\(今日\)$/ }).click();

    const row = rowContaining(page, FIXTURE.plenty.name);
    await row.locator('input[inputmode="numeric"]').fill("1");
    await page.getByRole("button", { name: "保存", exact: true }).click();

    /*
      何が通らなかったのかが分からないと、店舗は直しようがありません。
      この知らせは数秒で消えるので、ほかを見る前にここで捕まえます。
    */
    await expect(page.locator("body")).toContainText(
      `「${FIXTURE.plenty.name}」は既に2個の予約があるため、受付上限を1に下げられません`
    );
  });
});
