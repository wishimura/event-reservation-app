import { expect, test, type Page } from "@playwright/test";
import {
  closeE2eDb,
  FIXTURE,
  loginAsAdmin,
  openPickupGroup,
  pickupGroup,
  pickupOrder,
  reserve,
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

/** 同じ連絡先の方。ガチ勢は1日に何度も買う。 */
const REPEATER = { email: "gachi@example.com", phone: "090-7777-8888" };
/** 同姓同名だが、連絡先はまったく別の方。 */
const NAMESAKE = { email: "another@example.com", phone: "090-3333-4444" };
const NAME = "水木 しげる";

/** 同姓同名が混ざった、当日の注文をひと揃い作る。 */
async function placeOrders(page: Page) {
  const first = await reserve(page, {
    product: FIXTURE.plenty.name,
    name: NAME,
    diningStyle: "eat_in",
    eventDateId: data.today.id,
    ...REPEATER,
  });
  const second = await reserve(page, {
    product: FIXTURE.plenty.name,
    name: NAME,
    diningStyle: "eat_in",
    eventDateId: data.today.id,
    ...REPEATER,
  });
  const third = await reserve(page, {
    product: FIXTURE.plenty.name,
    name: NAME,
    diningStyle: "takeout",
    eventDateId: data.today.id,
    ...REPEATER,
  });
  const other = await reserve(page, {
    product: FIXTURE.plenty.name,
    name: NAME,
    diningStyle: "takeout",
    eventDateId: data.today.id,
    ...NAMESAKE,
  });
  return { first, second, third, other };
}

test.describe("S-05 受取管理と名寄せ", () => {
  test("同じ連絡先の予約は1枚にまとまり、まとめた理由が書いてある", async ({ page }) => {
    const { first, second, third, other } = await placeOrders(page);

    await loginAsAdmin(page);
    await page.goto("/admin/pickup");

    // 畳んだ状態でも、どなたかを見分けるものは出ている。
    const collapsed = pickupGroup(page, NAME);
    await expect(collapsed).toContainText("3件まとめ");
    await expect(collapsed).toContainText(REPEATER.email);
    await expect(collapsed).toContainText("0/3 受取済");

    const group = await openPickupGroup(page, NAME);
    await expect(group).toContainText("3件まとめ");
    // 黙ってまとめるのがいちばん危ない。理由をその場に出す。
    await expect(group).toContainText("メールアドレスと電話番号が一致");
    await expect(group).toContainText("0/3 受取済");

    // まとめても、1件ずつ見える。
    for (const order of [first, second, third]) {
      await expect(group.locator(`[data-order-row="${order.orderNumber}"]`)).toBeVisible();
    }
    // 連絡先が違う方は、同じお名前でも混ざらない。
    await expect(group.locator(`[data-order-row="${other.orderNumber}"]`)).toHaveCount(0);
  });

  test("同姓同名の別の方には、取り違えを防ぐ注意書きが出る", async ({ page }) => {
    const { first, other } = await placeOrders(page);

    await loginAsAdmin(page);
    await page.goto("/admin/pickup");

    /*
      当日に効くのはこの一行だけなので、**畳んだままでも**出ていること。
      クリックの向こうに隠れていると、開かずに渡してしまいます。
    */
    const cards = page.locator("[data-pickup-group]");
    await expect(cards).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      await expect(cards.nth(i)).toContainText(
        `同じ「${NAME}」様が他にもいらっしゃいます`
      );
    }

    // 開けば、それぞれの注文番号で見分けられる。
    for (const number of [first.orderNumber, other.orderNumber]) {
      const group = page
        .locator("[data-pickup-group]")
        .filter({ hasText: `同じ「${NAME}」様` })
        .nth(number === first.orderNumber ? 0 : 1);
      await group.getByRole("button").first().click();
    }
    await expect(pickupOrder(page, first.orderNumber)).toBeVisible();
    await expect(pickupOrder(page, other.orderNumber)).toBeVisible();
  });

  test("名前でもメールでも注文番号でも、まとまりごと出てくる", async ({ page }) => {
    const { first } = await placeOrders(page);

    await loginAsAdmin(page);
    await page.goto("/admin/pickup");
    const search = page.getByPlaceholder(/検索|お名前/);

    for (const term of [NAME, REPEATER.email, first.orderNumber]) {
      await search.fill(term);
      // 検索中は開いたまま。番号で引いたのにもう一度押させない。
      const group = pickupGroup(page, NAME);
      await expect(group).toContainText("3件まとめ");
      await expect(group.locator(`[data-order-row="${first.orderNumber}"]`)).toBeVisible();
    }
  });

  test("カウンターで区分を切り替えても、金額は1円も変わらない", async ({ page }) => {
    const { third } = await placeOrders(page);

    await loginAsAdmin(page);
    await page.goto("/admin/pickup");
    await openPickupGroup(page, NAME);

    const row = pickupOrder(page, third.orderNumber);
    await expect(row).toContainText("テイクアウト");
    const before = await row.getByText(/^¥[\d,]+/).first().innerText();

    await row.getByRole("button", { name: "イートインに変更" }).click();
    await expect(row).toContainText("イートイン");

    // 決済は終わっている。ここで金額が動いたら追加請求か返金が要る。
    await expect(row.getByText(/^¥[\d,]+/).first()).toHaveText(before);

    // 戻せること。当日は何度でも行き来する。
    await row.getByRole("button", { name: "テイクアウトに変更" }).click();
    await expect(row).toContainText("テイクアウト");

    await page.reload();
    await openPickupGroup(page, NAME);
    await expect(pickupOrder(page, third.orderNumber)).toContainText("テイクアウト");
  });

  test("既定では畳んであり、押すと中身が開く", async ({ page }) => {
    /*
      当日は20件ほど並びます。全部広げたままだと、お客様1人ぶんが縦に何行も
      積み上がって、目当ての方を探すだけでスクロールし続けることになります。
    */
    const { first } = await placeOrders(page);

    await loginAsAdmin(page);
    await page.goto("/admin/pickup");

    const group = pickupGroup(page, NAME);
    await expect(group).toBeVisible();

    // 畳んでいても、見分けるのに要るものは出ている。
    await expect(group).toContainText(NAME);
    await expect(group).toContainText(REPEATER.email);
    await expect(group).toContainText(REPEATER.phone);
    await expect(group).toContainText("0/3 受取済");

    // 注文の中身と、渡すためのボタンは隠れている。
    await expect(pickupOrder(page, first.orderNumber)).toBeHidden();
    await expect(
      group.getByRole("button", { name: "残り3件をまとめて受取完了" })
    ).toBeHidden();

    await openPickupGroup(page, NAME);
    await expect(pickupOrder(page, first.orderNumber)).toBeVisible();
    await expect(
      group.getByRole("button", { name: "残り3件をまとめて受取完了" })
    ).toBeVisible();

    // もう一度押せば畳める。
    await group.getByRole("button").first().click();
    await expect(pickupOrder(page, first.orderNumber)).toBeHidden();
  });

  test("1件ずつでも、残りをまとめてでも渡せる", async ({ page }) => {
    const { first, second, third } = await placeOrders(page);

    await loginAsAdmin(page);
    await page.goto("/admin/pickup");

    const group = await openPickupGroup(page, NAME);
    await pickupOrder(page, first.orderNumber)
      .getByRole("button", { name: "受取完了" })
      .click();
    await expect(group).toContainText("1/3 受取済");

    await group.getByRole("button", { name: "残り2件をまとめて受取完了" }).click();
    await expect(group).toContainText("3/3 受取済");
    for (const order of [second, third]) {
      await expect(pickupOrder(page, order.orderNumber)).toContainText("受取済");
    }

    // 押し間違いは戻せること。
    await pickupOrder(page, second.orderNumber)
      .getByRole("button", { name: "取消" })
      .click();
    await expect(group).toContainText("2/3 受取済");
  });
});
