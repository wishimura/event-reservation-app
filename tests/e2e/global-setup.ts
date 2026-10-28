/**
 * E2E を流す前に一度だけ。
 *
 * ここでしていることは、接続先の確認だけです。前提データは各テストが
 * `beforeEach` で作り直します（前のテストの副作用に頼らないため）。
 *
 * サーバーのビルドが始まる前に確かめるのが大事です。向き先が間違っていると
 * 気づくのが、4分かけてビルドしたあとでは遅すぎます。
 */
import { closeE2eDb, e2eDatabaseUrl, truncateAll } from "./_helpers/db";

export default async function globalSetup() {
  const url = e2eDatabaseUrl();
  const name = url.split("/").pop()?.split("?")[0] ?? "";
  console.log(`[e2e] データベース: ${name}`);

  // 空にできることをここで確かめておく。マイグレーションが当たっていない、
  // 接続できない、といった失敗を最初の1本の中ではなくここで出す。
  await truncateAll();
  await closeE2eDb();
}
