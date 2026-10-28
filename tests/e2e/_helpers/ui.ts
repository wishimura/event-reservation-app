/**
 * 画面を触るときの共通部品。
 *
 * 要素はラベル・役割・文字で探します。CSS クラス名・DOM の形・並び順では
 * 探しません。見た目を変えただけで落ちるテストは、やがて誰も直さなくなります。
 *
 * 固定の待ち時間（`waitForTimeout`）も使いません。遅い環境では足りず、速い環境
 * では無駄です。`expect(...)` で状態そのものを待ちます。
 */
import { expect, type Locator, type Page } from "@playwright/test";

export type DiningStyle = "eat_in" | "takeout";

/** 商品カード。名前で探す（並び順に依存しない）。 */
export function productCard(page: Page, name: string): Locator {
  return page.locator("[data-product-card]").filter({ hasText: name }).first();
}

/**
 * 表の行。中身で探す。
 *
 * `:visible` を付けているのは、製造計画のように表とカードの2通りを持つ画面が
 * あるためです。DOM には両方あるので、付けないと狭い画面で隠れている表の行を
 * 掴んで待ち続けます。
 */
export function rowContaining(page: Page, text: string): Locator {
  return page.locator("tr:visible").filter({ hasText: text }).first();
}

/**
 * 受取管理の「まとまり」のカード。お客様の名前や注文番号で探す。
 *
 * ここだけは目印を付けてもらっています。カードも中の1件も入れ子の `div` で、
 * 役割も文字も重なっているため、1〜3 の探し方では掴み分けられません。
 */
export function pickupGroup(page: Page, text: string): Locator {
  return page.locator("[data-pickup-group]").filter({ hasText: text }).first();
}

/** 受取管理の、注文1件ぶんの行。 */
export function pickupOrder(page: Page, orderNumber: string): Locator {
  return page.locator(`[data-order-row="${orderNumber}"]`);
}

/**
 * 横にはみ出していないこと。
 *
 * スマホで横スクロールが出ると、ボタンが画面の外に逃げて押せなくなります。
 * assertion で拾いにくいので、幅そのものを測ります。
 */
export async function expectNoHorizontalOverflow(page: Page, where: string) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth
        ),
      { message: `${where} が横にはみ出している` }
    )
    .toBeLessThanOrEqual(1);
}

export interface ReserveOptions {
  /** 予約する商品の名前。 */
  product: string;
  /** お客様のお名前。 */
  name: string;
  diningStyle: DiningStyle;
  email?: string;
  phone?: string;
  /** 受取日の id。省略すると一覧のいちばん上を選ぶ。 */
  eventDateId?: string;
  /** 何個入れるか。 */
  quantity?: number;
  /**
   * 選ばずに送信して止まることまで確かめるか。
   * 既定で確かめます（区分の無い注文は税額の根拠を失うため）。
   */
  checkUnselected?: boolean;
}

export interface Placed {
  orderNumber: string;
  email: string;
  phone: string;
}

/**
 * トップから完了画面まで、お客様と同じ順に操作する。
 *
 * 画面の文言を変えたらここだけ直せば済むよう、1か所にまとめてあります。
 */
export async function reserve(page: Page, options: ReserveOptions): Promise<Placed> {
  const email = options.email ?? "e2e@example.com";
  const phone = options.phone ?? "090-1111-2222";
  const quantity = options.quantity ?? 1;

  if (options.eventDateId) {
    await page.goto(`/reserve/${options.eventDateId}`);
  } else {
    await page.goto("/");
    await page.locator('a[href^="/reserve/"]').first().click();
    await page.waitForURL(/\/reserve\/[0-9a-f-]{36}$/);
  }

  const card = productCard(page, options.product);
  await expect(card).toBeVisible();
  for (let i = 0; i < quantity; i++) {
    await card.getByRole("button", { name: "1つ増やす" }).click();
  }

  await page.getByRole("button", { name: /確認へ進む/ }).click();
  await page.waitForURL(/\/reserve\/confirm/);

  await page.getByPlaceholder("山田 太郎").fill(options.name);
  await page.getByPlaceholder("taro@example.com").fill(email);
  await page.getByPlaceholder("090-1234-5678").fill(phone);

  if (options.checkUnselected !== false) {
    // 店内か持ち帰りかを選ばないまま送ると、止まること。
    // 区分の無い注文が入ると、納める消費税の根拠が失われる。
    await page.getByRole("button", { name: "注文を確定する" }).click();
    await expect(
      page.getByText("店内でお召し上がりか、お持ち帰りかを選んでください")
    ).toBeVisible();
    await expect(page).toHaveURL(/\/reserve\/confirm/);
  }

  const styleLabel = options.diningStyle === "eat_in" ? "店内で食べる" : "持ち帰る";
  await page.getByRole("button", { name: new RegExp(styleLabel) }).click();
  await page.getByRole("button", { name: "注文を確定する" }).click();

  await page.waitForURL(/\/reserve\/complete/);

  // 完了画面は保存しておいた注文を読んでから描くので、番号が出るまで待つ
  const number = page.getByText(/ORD-\d{6}-[A-Z0-9]{6}/).first();
  await expect(number).toBeVisible();
  const orderNumber = (await number.innerText()).match(
    /ORD-\d{6}-[A-Z0-9]{6}/
  )?.[0];
  if (!orderNumber) throw new Error("完了画面に注文番号が出ていない");

  return { orderNumber, email, phone };
}
