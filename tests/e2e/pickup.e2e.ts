import { expect, test, type Page } from "@playwright/test";
import {
  closeE2eDb,
  e2eDb,
  FIXTURE,
  loginAsAdmin,
  openPickupGroup,
  pickupGroup,
  pickupOrder,
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

  test("お召し上がり方法で絞れて、隠れた注文があることは隠さない", async ({ page }) => {
    /*
      仕込みでは「イートインが何人ぶん」が要ります。ただ、絞ったせいで
      **その方の残りの注文が見えなくなる**のが怖いところです。席に出す分
      だけを見ているあいだに「この方はこれで全部」と思い込むと、袋のほうを
      渡し忘れます。だから隠れている件数は札で出します。
    */
    const eatIn = await reserve(page, {
      product: FIXTURE.plenty.name,
      name: NAME,
      diningStyle: "eat_in",
      eventDateId: data.today.id,
      ...REPEATER,
    });
    const takeout = await reserve(page, {
      product: FIXTURE.plenty.name,
      name: NAME,
      diningStyle: "takeout",
      eventDateId: data.today.id,
      ...REPEATER,
    });

    await loginAsAdmin(page);
    await page.goto("/admin/pickup");

    const group = await openPickupGroup(page, NAME);
    await expect(group).toContainText(eatIn.orderNumber);
    await expect(group).toContainText(takeout.orderNumber);

    // 「イートインに変更」とは別物。件数の付いた絞り込みのほうを押す。
    await page.getByRole("button", { name: /^イートイン\d+件$/ }).click();

    const narrowed = await openPickupGroup(page, NAME);
    await expect(narrowed).toContainText(eatIn.orderNumber);
    await expect(narrowed).not.toContainText(takeout.orderNumber);
    // 残りがあることは、押さなくても分かること。
    await expect(narrowed).toContainText("他に1件");
  });

  test("先の受取日も見られるが、その日まで渡したことにはできない", async ({ page }) => {
    /*
      仕込みは前の日に始まります。何組の方が何件取りに来るのかを当日の朝に
      初めて知るのでは、段取りが立ちません。

      そのかわり、**まだ渡していないものに「渡した」と付けられては困る**ので、
      当日以外は読むだけにしてあります。ここで見るのはその2つです。
    */
    const tomorrow = await reserve(page, {
      product: FIXTURE.plenty.name,
      name: "鬼太郎 太郎",
      diningStyle: "takeout",
      eventDateId: data.tomorrow.id,
    });

    await loginAsAdmin(page);
    await page.goto("/admin/pickup");

    // 既定は今日。明日の注文はまだ出てこない。
    await expect(page.getByText(tomorrow.orderNumber)).toHaveCount(0);

    const [, month, day] = data.tomorrow.date.split("-");
    const chip = new RegExp(`^${Number(month)}/${Number(day)}`);
    await page.getByRole("button", { name: chip }).click();

    await expect(page.getByText(/先の日を見ています/)).toBeVisible();

    // まとまりは畳んであるので、開いてから中身を見る。
    const group = await openPickupGroup(page, "鬼太郎 太郎");
    await expect(group).toContainText(tomorrow.orderNumber);

    // 渡す操作は出ていないこと。
    await expect(page.getByRole("button", { name: "受取完了" })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /まとめて受取完了/ })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /に変更$/ })
    ).toHaveCount(0);
  });

  test("まだ渡していない方が先に並び、その数が出る", async ({ page }) => {
    /*
      昼を過ぎると、済んだ方が上に積もります。そのままだと「まだ来て
      いないのは誰か」を一覧から拾うのに、毎回スクロールし続けることに
      なります。残りが**先頭に来ること**と、**数が押す前から見えること**。
    */
    const waiting = await reserve(page, {
      product: FIXTURE.plenty.name,
      name: "砂かけ 婆",
      diningStyle: "takeout",
      eventDateId: data.today.id,
      email: "suna@example.com",
      phone: "090-7777-1111",
    });
    const done = await reserve(page, {
      product: FIXTURE.plenty.name,
      name: "ねこ 娘",
      diningStyle: "takeout",
      eventDateId: data.today.id,
      email: "neko@example.com",
      phone: "090-5555-6666",
    });

    await loginAsAdmin(page);
    await page.goto("/admin/pickup");

    const pending = page.getByRole("button", { name: /^未受取のみ\d+件$/ });
    await expect(pending).toContainText("2件");

    // 1人に渡す。
    const neko = await openPickupGroup(page, "ねこ 娘");
    await neko.getByRole("button", { name: "受取完了" }).click();
    await expect(neko).toContainText("1/1 受取済");
    await expect(pending).toContainText("1件");

    // 渡していない方が先頭にいること。
    const names = page.locator("[data-pickup-group]");
    await expect(names.first()).toContainText("砂かけ 婆");

    // 絞れば、渡していない方だけが残ること。
    await pending.click();
    await expect(page.getByText("ねこ 娘")).toHaveCount(0);
    const only = await openPickupGroup(page, "砂かけ 婆");
    await expect(only).toContainText(waiting.orderNumber);
    expect(done.orderNumber).not.toEqual(waiting.orderNumber);
  });

  test("渡す操作は受取管理だけにあり、注文一覧には無い", async ({ page }) => {
    /*
      渡す単位はお客様であって、注文ではありません。

      注文一覧にも同じボタンを置いていた時期がありますが、1件ずつ並ぶ画面で
      消し込むと、**同じ方の2件目を渡し忘れます**。受取管理なら「0/2 受取済」
      と出て、まとめて渡せて、同姓同名の警告も出ます。場所を1つに戻しました。

      一覧では**状態は読める**こと（渡し終わったかどうかは一覧でも知りたい）、
      ただし**変えられない**ことを見ます。
    */
    const { first } = await placeOrders(page);

    await loginAsAdmin(page);
    await page.goto("/admin/orders");
    const row = rowContaining(page, first.orderNumber);
    await expect(row).toContainText("未受取");
    await row.click();

    await expect(
      page.getByRole("button", { name: "「受取済」にする" })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "「未受取」に戻す" })
    ).toHaveCount(0);
  });

  test("過ぎた日の付け忘れは、受取管理から直せる", async ({ page }) => {
    /*
      注文一覧から受取の操作を外した以上、**ここが唯一の直し場所**です。
      先の日は書けないままですが、過ぎた日まで書けなくすると
      「昨日渡したのに付け忘れた」をどこからも直せなくなります。
    */
    /*
      前提データに過ぎた日はありません（当日・翌日・受付停止日だけ）。
      他のテストが数える日数を変えたくないので、この1本のぶんだけ
      ここで足します。
    */
    const d = new Date(`${data.today.date}T00:00:00`);
    d.setDate(d.getDate() - 1);
    const yesterday = d.toISOString().slice(0, 10);

    const { rows: dateRows } = await e2eDb().query<{ id: string }>(
      `insert into event_dates (event_id, pickup_date, reservation_open, reservation_status)
       values ($1, $2, false, 'closed') returning id`,
      [data.eventId, yesterday]
    );
    await e2eDb().query(
      `insert into orders
         (event_id, event_date_id, order_number, customer_name, customer_email,
          customer_phone, total_amount, dining_style, payment_method,
          payment_status, order_status, pickup_status, source)
       values ($1, $2, 'ORD-PAST-0001', 'ねずみ 男', 'nezumi@example.com',
               '090-9999-0000', 1000, 'takeout', 'credit_card', 'paid',
               'confirmed', 'not_picked_up', 'online')`,
      [data.eventId, dateRows[0].id]
    );

    await loginAsAdmin(page);
    await page.goto("/admin/pickup");

    const [, month, day] = yesterday.split("-");
    await page
      .getByRole("button", { name: new RegExp(`^${Number(month)}/${Number(day)}`) })
      .click();

    await expect(page.getByText(/過ぎた日を見ています/)).toBeVisible();

    const group = await openPickupGroup(page, "ねずみ 男");
    await expect(group).toContainText("ORD-PAST-0001");
    await group.getByRole("button", { name: "受取完了" }).click();
    await expect(group).toContainText("1/1 受取済");
  });
});
