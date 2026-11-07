import { expect, test, type Page } from "@playwright/test";
import {
  closeE2eDb,
  e2eDb,
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

  test("当日店頭だけの商品は、売切と区別して並び、予約には進めない", async ({ page }) => {
    /*
      「売り切れ」と「はじめから予約を受けない」は別物です。

      生産数を0にして代用すると、お客様には売り切れと同じ顔に見えて、
      作ったのに出せなかったのか、はじめから店頭だけなのかが分かりません。
      ここで見るのは、札が入れ替わること・数量が選べないこと・
      それでも在庫は持ったままであることの3つです。
    */
    await e2eDb().query("update products set walk_in_only = true where name = $1", [
      FIXTURE.plenty.name,
    ]);

    await page.goto(`/reserve/${data.today.id}`);
    const card = productCard(page, FIXTURE.plenty.name);
    await expect(card).toContainText("当日店頭販売のみ");
    await expect(card).not.toContainText("SOLD OUT");
    await expect(card.getByRole("button", { name: "1つ増やす" })).toHaveCount(0);

    // 売り切れの商品のほうは、今までどおり SOLD OUT のまま。
    await expect(productCard(page, FIXTURE.soldOut.name)).toContainText("SOLD OUT");
  });

  test("当日店頭だけの商品は、画面を飛ばして直接送っても予約にならない", async ({
    page,
  }) => {
    await e2eDb().query("update products set walk_in_only = true where name = $1", [
      FIXTURE.plenty.name,
    ]);

    const res = await page.request.post("/api/orders", {
      data: {
        event_id: data.eventId,
        event_date_id: data.today.id,
        customer_name: "テスト 太郎",
        customer_email: "e2e@example.com",
        customer_phone: "090-1111-2222",
        dining_style: "takeout",
        items: [{ product_id: data.products.plenty, quantity: 1 }],
      },
    });
    expect(res.ok()).toBe(false);

    // 断られた以上、受付枠は1つも減っていないこと。
    const { rows } = await e2eDb().query<{ reserved_quantity: number }>(
      `select reserved_quantity from daily_product_inventory
        where event_date_id = $1 and product_id = $2`,
      [data.today.id, data.products.plenty]
    );
    expect(rows[0].reserved_quantity).toBe(0);
  });

  test("その日だけ並ばない商品があれば、画面が知らせて、その場で直せる", async ({ page }) => {
    /*
      （受取日 × 商品）の行が無い商品は、その日には存在しない扱いになります。
      以前は受取日を足すときに「販売中」の商品だけを作っていたため、そのとき
      販売停止だった品が1日だけ抜け、画面から直す手段もありませんでした。
      本番で実際に起きています。

      ここでは行を1つ消して、抜けている状態を作ります。
    */
    await e2eDb().query(
      `delete from daily_product_inventory
        where event_date_id = $1 and product_id = $2`,
      [data.today.id, data.products.plenty]
    );

    await loginAsAdmin(page);
    await page.goto("/admin/inventory");
    await page.getByRole("button", { name: /\(今日\)$/ }).click();

    // 黙って消えているのがいちばん危ない。名前を出して知らせること。
    await expect(page.getByText(/設定されていない商品が 1 件あります/)).toBeVisible();
    await expect(page.locator("main")).toContainText(FIXTURE.plenty.name);

    await page.getByRole("button", { name: "この受取日にも並べる" }).click();
    await expect(page.getByText(/1 件を追加しました/)).toBeVisible();

    // 戻ってくるが、受付枠は0。お店が数を入れるまで勝手には売らない。
    const row = rowContaining(page, FIXTURE.plenty.name);
    await expect(row).toBeVisible();
    await expect(row.locator('input[inputmode="numeric"]')).toHaveValue("0");

    // 知らせは消えている。
    await expect(page.getByText(/設定されていない商品が/)).toHaveCount(0);
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
