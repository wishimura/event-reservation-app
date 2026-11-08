import { expect, test } from "@playwright/test";
import {
  closeE2eDb,
  e2eDb,
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
  "/admin/incident-logs",
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

  test("注文一覧の状態の札が、縦書きにならない", async ({ page }) => {
    /*
      列が詰まると「決済済み」が一文字ずつ縦に割れて読めなくなります。
      幅が足りないときに折り返してよいのは商品の列だけです。

      札が横に寝ているかは、幅と高さを比べれば分かります（縦書きなら
      高さのほうが大きくなる）。
    */
    await reserve(page, {
      product: FIXTURE.plenty.name,
      name: "縦書き 太郎",
      diningStyle: "takeout",
      eventDateId: data.today.id,
      email: "nowrap@example.com",
    });

    await loginAsAdmin(page);
    await page.goto("/admin/orders");

    const row = rowContaining(page, "縦書き 太郎");
    await expect(row).toBeVisible();

    for (const label of ["決済済み", "確定", "未受取", "テイクアウト"]) {
      const badge = row.getByText(label, { exact: true }).first();
      await expect(badge).toBeVisible();
      const box = await badge.boundingBox();
      expect(box, `${label} の大きさが取れない`).not.toBeNull();
      expect(
        box!.width,
        `${label} が縦書きになっている (${box!.width}x${box!.height})`
      ).toBeGreaterThan(box!.height);
    }
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
    const res = await page.request.post("/api/incident", {
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
    await page.goto("/admin/incident-logs");

    const row = rowContaining(page, marker);
    await expect(row).toBeVisible();
    await expect(row).toContainText("カード入力欄");
    await expect(row).toContainText("お客様の端末");
    await expect(row).toContainText("エラー");

    // うまくいかなかったものだけに絞っても残る。
    await page.getByText("うまくいかなかったものだけ").click();
    await expect(rowContaining(page, marker)).toBeVisible();
  });

  test("間違えてキャンセルしても、取り消して元に戻せる", async ({ page }) => {
    /*
      お店の現実は「隣の人の注文を間違えて消した」です。戻す道が無いと、
      その場で作り直すことになり、注文番号も決済の記録も合わなくなります。

      在庫も一緒に戻ること（キャンセルで戻した枠を、取り直すこと）まで
      見ます。表示だけ戻って在庫が戻らないと、当日お店が足りません。
    */
    const placed = await reserve(page, {
      product: FIXTURE.plenty.name,
      name: "取り消し 太郎",
      diningStyle: "takeout",
      eventDateId: data.today.id,
      email: "restore@example.com",
    });

    await loginAsAdmin(page);
    await page.goto("/admin/orders");

    const row = rowContaining(page, placed.orderNumber);
    await row.click();

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "この注文をキャンセル" }).click();

    /*
      キャンセルできたことは、取り消すボタンが出たことで分かります。
      「キャンセル」という文字で探すと、絞り込みの選択肢まで引っかかります。
    */
    const restore = page.getByRole("button", { name: "キャンセルを取り消す" });
    await expect(restore).toBeVisible();

    page.once("dialog", (d) => d.accept());
    await restore.click();

    // 戻ったら、またキャンセルできる状態に戻っていること。
    await expect(
      page.getByRole("button", { name: "この注文をキャンセル" })
    ).toBeVisible();
    await expect(restore).toHaveCount(0);

    // 製造計画の数が元どおりであること（在庫も戻っている証拠）。
    await page.goto("/admin/production");
    await expect(page.locator("main")).toContainText(
      new RegExp(`1\\s*/\\s*(上限\\s*)?${FIXTURE.plenty.capacity}`)
    );
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

  test("メールが届かなかった注文に印が付き、届いたら消える", async ({ page }) => {
    /*
      配信事業者の1日の上限に当たると、予約は通るのに確認メールだけが
      出ません。お客様は何も受け取らず、こちらも気づけませんでした。

      大事なのは**印が消えること**です。一度でも失敗があれば印を付ける
      作りだと、あとから再送して届いたあとも残り続け、どれがまだ
      終わっていないのか分からなくなります。見るのは最後の記録だけ。
    */
    const order = await reserve(page, {
      product: FIXTURE.plenty.name,
      name: "メール 太郎",
      diningStyle: "takeout",
      eventDateId: data.today.id,
    });

    const logMail = (outcome: "ok" | "error") =>
      e2eDb().query(
        `insert into incident_logs (area, source, stage, outcome, order_number, message)
         values ('email', 'server', 'customer_mail', $1, $2, $3)`,
        [outcome, order.orderNumber, outcome === "ok" ? "送信しました" : "断られました"]
      );

    await loginAsAdmin(page);

    await logMail("error");
    await page.goto("/admin/orders");
    await expect(rowContaining(page, order.orderNumber)).toContainText(
      "メール未送信"
    );

    // 再送して届いた、という記録。印はここで消えること。
    await logMail("ok");
    await page.goto("/admin/orders");
    await expect(rowContaining(page, order.orderNumber)).not.toContainText(
      "メール未送信"
    );
  });
});
