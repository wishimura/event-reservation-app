import { expect, test } from "@playwright/test";
import {
  closeE2eDb,
  expectNoHorizontalOverflow,
  FIXTURE,
  productCard,
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

test.describe("S-01 お客様の予約", () => {
  test("トップから完了画面まで、途中で止まらずに通る", async ({ page }) => {
    const placed = await reserve(page, {
      product: FIXTURE.plenty.name,
      name: "予約 太郎",
      diningStyle: "takeout",
    });

    expect(placed.orderNumber).toMatch(/^ORD-\d{6}-[A-Z0-9]{6}$/);
    await expect(page.getByText(placed.orderNumber)).toBeVisible();
  });

  test("商品を押すと、説明が最後まで読める", async ({ page }) => {
    /*
      一覧では名前は1行、説明は2行で切られます。お店から「個別のメニューの
      説明が読めない」「ガチ勢には隅々まで見せたい」という話が出たのがここ
      です。一覧の密度は変えず、押せば全部出る形にしました。

      切られる側に来る一文が出ているかどうかで見ます。
    */
    await page.goto(`/reserve/${data.today.id}`);

    const card = productCard(page, FIXTURE.plenty.name);
    await expect(card).toBeVisible();

    const tail = "原材料：コーヒー豆（エチオピア産）のみ。";

    /*
      一覧では確かに切られていること。

      文字が DOM に無いことでは見られません。`line-clamp` は文字を消さず、
      見える高さだけを縮めるからです。中身の高さが枠より高ければ、はみ出して
      いる＝読めていない、ということになります。
    */
    const clamped = card.locator("p").filter({ hasText: "エチオピア産の豆" });
    const overflows = await clamped.evaluate(
      (el) => el.scrollHeight > el.clientHeight + 1
    );
    expect(overflows, "一覧の説明が切られていない（前提が崩れている）").toBe(true);

    await card.getByRole("button", { name: /の詳細を見る$/ }).click();

    const detail = page.getByRole("dialog");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(FIXTURE.plenty.name);
    await expect(detail).toContainText(tail);
  });

  test("開いた詳細は、×でもEscでも閉じられる", async ({ page }) => {
    /*
      開いたら必ず閉じられること。スマホで戻る手立てが無くなると、
      そこで予約をやめるしかなくなります。
    */
    await page.goto(`/reserve/${data.today.id}`);

    const card = productCard(page, FIXTURE.plenty.name);
    const open = () => card.getByRole("button", { name: /の詳細を見る$/ }).click();
    const detail = page.getByRole("dialog");

    await open();
    await expect(detail).toBeVisible();
    await detail.getByRole("button", { name: "詳細を閉じる" }).click();
    await expect(detail).toHaveCount(0);

    await open();
    await expect(detail).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
  });

  test("詳細を開いても、かごの中身は変わらない", async ({ page }) => {
    /*
      カード全体が詳細を開くボタンになっています。数量の増減と喧嘩して、
      見ただけで1つ入る——あるいは入れたものが消える——ことがないように。
    */
    await page.goto(`/reserve/${data.today.id}`);

    const card = productCard(page, FIXTURE.plenty.name);
    await card.getByRole("button", { name: "1つ増やす" }).click();
    await expect(page.getByRole("button", { name: /確認へ進む/ })).toBeEnabled();

    await card.getByRole("button", { name: /の詳細を見る$/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "詳細を閉じる" }).click();

    // 1点のまま。増えても減ってもいない。
    await expect(page.getByText("1 点")).toBeVisible();
  });

  test("かけられない電話番号は、払う前に止める", async ({ page }) => {
    /*
      お店は変更・キャンセルを**電話でのみ**受けています。かけられない番号で
      通すと、連絡の手立てが無いご予約になります。

      それに加えて、Square が顧客を作るときに同じ番号を見ます。以前ここが
      緩く（数字と記号が10文字以上なら通る）、弾かれるのは決済のあとでした。
      その時点ではもうお支払いが済んでいて、お客様には何も言えません。
    */
    await page.goto(`/reserve/${data.today.id}`);
    const card = productCard(page, FIXTURE.plenty.name);
    await card.getByRole("button", { name: "1つ増やす" }).click();
    await page.getByRole("button", { name: /確認へ進む/ }).click();
    await page.waitForURL(/\/reserve\/confirm/);

    await page.getByRole("button", { name: /持ち帰る/ }).click();
    await page.getByPlaceholder("山田 太郎").fill("電話 太郎");
    await page.getByPlaceholder("taro@example.com").fill("phone@example.com");

    const phone = page.getByPlaceholder("090-1234-5678");
    const submit = page.getByRole("button", { name: "注文を確定する" });
    const complaint = page.getByText("電話番号の形式をご確認ください（例：090-1234-5678）");

    // 10文字以上の記号の並び。前の作りではこれで先へ進めた。
    await phone.fill("----------");
    await submit.click();
    await expect(complaint).toBeVisible();
    await expect(page).not.toHaveURL(/\/reserve\/complete/);

    // 0 で始まらない番号も通さない。
    await phone.fill("9012345678");
    await expect(complaint).toBeVisible();

    /*
      数字でない文字が混ざっているもの。

      本番でこれが通りました（`09000000000A`）。数字以外をすべて落として
      から桁を数えていたので、A が消えて正しい番号に化けていました。
    */
    await phone.fill("09000000000A");
    await expect(complaint).toBeVisible();

    // まともな番号を入れれば、その場で引っ込んで先へ進める。
    await phone.fill("090-1234-5678");
    await expect(complaint).toHaveCount(0);

    await submit.click();
    await page.waitForURL(/\/reserve\/complete/);
  });

  test("受取時間の枠を選ばせる操作がどこにも残っていない", async ({ page }) => {
    /*
      時間枠はやめた仕様です。消し残すと、選べない欄をお客様に見せることになります。

      ここで見るのは**選ばせる操作が無いこと**であって、「受取時間」という語が
      無いことではありません。本番のご案内文には「受取時間は各日 11:00〜16:00 です」
      と書かれていて、これはお店の文章なので消す理由がないからです。
    */
    const slotPicker = /受取時間|時間帯|時間枠/;

    await page.goto("/");
    await expect(page.getByRole("combobox", { name: slotPicker })).toHaveCount(0);
    await expect(page.getByRole("radio", { name: slotPicker })).toHaveCount(0);
    await expect(page.getByRole("button", { name: slotPicker })).toHaveCount(0);

    await page.goto(`/reserve/${data.today.id}`);
    await productCard(page, FIXTURE.plenty.name)
      .getByRole("button", { name: "1つ増やす" })
      .click();
    await page.getByRole("button", { name: /確認へ進む/ }).click();
    await page.waitForURL(/\/reserve\/confirm/);

    // 選ばせるとしたらこの画面。お召し上がり方法だけが並んでいること。
    await expect(page.getByRole("combobox", { name: slotPicker })).toHaveCount(0);
    await expect(page.getByRole("radio", { name: slotPicker })).toHaveCount(0);
    await expect(page.getByRole("button", { name: slotPicker })).toHaveCount(0);
    await expect(page.locator("select")).toHaveCount(0);
    await expect(page.getByText("お召し上がり方法")).toBeVisible();
  });

  test("受付を止めた日は押せず、直接叩いても注文が通らない", async ({ page }) => {
    await page.goto("/");

    // 日付そのものは出てよい（やっていないことが伝わる）。押せないことが大事。
    await expect(
      page.locator(`a[href="/reserve/${data.closed.id}"]`)
    ).toHaveCount(0);
    await expect(
      page.locator(`a[href="/reserve/${data.today.id}"]`)
    ).toHaveCount(1);

    // 画面を飛ばして直接送っても断られること。
    const res = await page.request.post("/api/orders", {
      data: {
        event_id: data.eventId,
        event_date_id: data.closed.id,
        customer_name: "直打ち 太郎",
        customer_email: "closed@example.com",
        customer_phone: "090-0000-0000",
        payment_method: "cash",
        dining_style: "takeout",
        items: [{ product_id: data.products.plenty, quantity: 1 }],
      },
    });
    expect(res.status()).toBe(400);
  });

  test("存在しない受取日の URL でもエラー画面にならない", async ({ page }) => {
    const res = await page.goto("/reserve/00000000-0000-4000-8000-000000000000");
    expect(res?.status() ?? 500).toBeLessThan(500);

    // UUID ですらない文字列でも同じ。
    const bad = await page.goto("/reserve/not-a-uuid");
    expect(bad?.status() ?? 500).toBeLessThan(500);
  });

  test("売り切れの商品は、売り切れと分かり、数量を増やせない", async ({ page }) => {
    await page.goto(`/reserve/${data.today.id}`);

    const card = productCard(page, FIXTURE.soldOut.name);
    await expect(card).toBeVisible();
    await expect(card).toContainText("SOLD OUT");
    // 売り切れの商品には、そもそも数量の欄を出さない。
    await expect(card.getByRole("button", { name: "1つ増やす" })).toHaveCount(0);
  });

  test("確認画面から戻って商品を足せる。選んでいたものは消えない", async ({ page }) => {
    /*
      「やっぱりこれも」で戻る方はいます。以前は戻るとカゴが空になっていて、
      選び直しからやることになっていました。戻れないのと同じです。
    */
    await page.goto(`/reserve/${data.today.id}`);
    await productCard(page, FIXTURE.plenty.name)
      .getByRole("button", { name: "1つ増やす" })
      .click();
    await page.getByRole("button", { name: /確認へ進む/ }).click();
    await page.waitForURL(/\/reserve\/confirm/);
    await expect(page.locator("main")).toContainText(FIXTURE.plenty.name);

    await page.getByRole("button", { name: "商品を追加・変更する" }).click();
    await page.waitForURL(new RegExp(`/reserve/${data.today.id}$`));

    // 選んでいた1つが残っていること。
    const kept = productCard(page, FIXTURE.plenty.name);
    await expect(kept.locator("span.tabular-nums")).toHaveText("1");

    // もう1品足して、確認画面に両方出ること。
    await productCard(page, FIXTURE.scarce.name)
      .getByRole("button", { name: "1つ増やす" })
      .click();
    await page.getByRole("button", { name: /確認へ進む/ }).click();
    await page.waitForURL(/\/reserve\/confirm/);

    await expect(page.locator("main")).toContainText(FIXTURE.plenty.name);
    await expect(page.locator("main")).toContainText(FIXTURE.scarce.name);
  });

  test("入力が足りないまま押すと、足りない場所まで画面が動く", async ({ page }) => {
    /*
      「注文を確定する」は画面のいちばん下、足りない項目はずっと上にあります。
      押しても画面が動かないと**何も起きなかったように見えます**。
      押した場所に要約を出し、最初の不足まで連れていきます。
    */
    await page.goto(`/reserve/${data.today.id}`);
    await productCard(page, FIXTURE.plenty.name)
      .getByRole("button", { name: "1つ増やす" })
      .click();
    await page.getByRole("button", { name: /確認へ進む/ }).click();
    await page.waitForURL(/\/reserve\/confirm/);

    // 何も入れずに押す。
    const submit = page.getByRole("button", { name: "注文を確定する" });
    await submit.scrollIntoViewIfNeeded();
    await submit.click();

    // 押した場所で反応が返ること。
    const summary = page.getByText("未入力の項目があります。");
    await expect(summary).toBeVisible();

    // 最初の不足（お召し上がり方法）が画面の中に入っていること。
    const picker = page.locator("#field-dining_style");
    await expect(picker).toBeInViewport({ timeout: 10_000 });

    /*
      直したそばから引っ込むこと。

      押した時点の数をそのまま残すと、入れたあとも「◯つ足りません」が出たまま
      になり、入れたはずなのにまだ足りないのかと迷わせます。
    */
    await page.getByRole("button", { name: /店内で食べる/ }).click();
    await page.getByPlaceholder("山田 太郎").fill("足りない 太郎");
    await page.getByPlaceholder("taro@example.com").fill("enough@example.com");
    await expect(summary).toBeVisible(); // 電話番号がまだ
    await page.getByPlaceholder("090-1234-5678").fill("090-1111-2222");
    await expect(summary).toHaveCount(0);

    await submit.click();
    await page.waitForURL(/\/reserve\/complete/);
  });

  test("横にはみ出さない（お客様が触る画面）", async ({ page }) => {
    for (const path of ["/", `/reserve/${data.today.id}`, "/legal/tokushoho"]) {
      await page.goto(path);
      await expectNoHorizontalOverflow(page, path);
    }
  });
});
