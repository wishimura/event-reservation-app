import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

/**
 * E2E の設定。方針は docs/シナリオテスト仕様書.md。
 *
 * **専用のデータベースが要ります**（テーブルを空にするため）。`E2E_DATABASE_URL`
 * に指定してください。安全ガードは tests/e2e/_helpers/db.ts にあります。
 *
 * 本番ビルドに対して流します。開発サーバーだと、本番でしか出ない不具合
 * （キャッシュ、プリレンダリング、CSS の順序）を見逃します。すでにサーバーを
 * 立てているなら `E2E_BASE_URL` を渡せば、それを使い回します。
 */
loadEnv({ path: ".env.local", quiet: true });

/**
 * アプリに渡す接続先。
 *
 * **空文字を渡さないこと。** 空文字だとドライバは起動時ではなく最初のクエリで
 * 落ちるので、画面には「エラーが発生しました」としか出ず、原因にたどり着くのに
 * 時間がかかります。ここで止めれば理由が1行で分かります。
 */
function appDatabaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) {
    throw new Error(
      "E2E_DATABASE_URL が未設定です。E2E はテーブルを空にするため、" +
        "開発用の DATABASE_URL とは別の専用データベースを .env.local に書いてください。"
    );
  }
  return url;
}

const PORT = Number(process.env.E2E_PORT ?? 3929);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // ヘルパーはテストではないので拾わせない。
  //
  // **名前に `spec` も `test` も入れていません。** node:test / Vitest / Jest の
  // 既定の収集パターン（拡張子の前に test か spec が付くもの）が Playwright の
  // ファイルまで拾い、`npm test` が「Playwright Test did not expect
  // test.beforeEach() to be called here」で落ちるためです。`.e2e.spec.ts` では
  // 直りません（spec のグロブに一致したままです）。
  //
  // 逆に `.spec.ts` で作ってしまうとここから外れて**黙って実行されない**ので、
  // `npm run check:scenarios` が見つけて落とします。
  testMatch: /.*\.e2e\.ts$/,
  globalSetup: "./tests/e2e/global-setup.ts",

  // 前提データを共有するので、並列は切る。
  workers: 1,
  fullyParallel: false,

  // 落ちた原因を後から追えるようにする。「なぜか落ちた」を残さない。
  reporter: process.env.CI
    ? [["list"], ["github"], ["html", { open: "never" }]]
    : [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // 落ちたときだけ1回やり直す。常時やり直すと不安定なテストが隠れる。
  retries: process.env.CI ? 1 : 0,

  use: {
    baseURL,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    // ブラウザを別の場所に置いている環境（クラウドのセッションなど）向け。
    // 普段は `npx playwright install chromium` で入るものが使われる。
    launchOptions: process.env.E2E_CHROMIUM_PATH
      ? { executablePath: process.env.E2E_CHROMIUM_PATH }
      : {},
  },

  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
    {
      // お客様はほぼスマホから予約します。店舗もカウンターでは手元の端末です。
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run build && npx next start --port ${PORT}`,
        // 空のデータベースでも 200 が返る画面を使う。/api/events は催しが
        // 1件も無いと 404 を返すので、起動の判定には使えない。
        url: `http://127.0.0.1:${PORT}/admin/login`,
        timeout: 300_000,
        reuseExistingServer: !process.env.CI,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          // PATH などを失わないよう明示的に引き継ぐ
          ...(process.env as Record<string, string>),
          // アプリも必ず E2E 用のデータベースに向ける。
          // 開発用の DATABASE_URL を引き継がせない（上の展開をこの行で潰す）。
          DATABASE_URL: appDatabaseUrl(),
          ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "qa-password",
          ADMIN_SESSION_SECRET:
            process.env.ADMIN_SESSION_SECRET ?? "e2e-only-secret-at-least-32-characters",
          /*
            Square の鍵は渡しません。渡すと E2E が本物のカード決済を叩きます。
            鍵が無ければアプリは現地払いのまま動くので、画面の流れはそのまま
            確かめられます。決済そのものは tests/payment.test.ts で見ます。
          */
          SQUARE_ACCESS_TOKEN: "",
          SQUARE_APPLICATION_ID: "",
          SQUARE_LOCATION_ID: "",
          // 予約確認メールを本当に送らない。
          RESEND_API_KEY: "",
          NODE_ENV: "production",
        },
      },
});
