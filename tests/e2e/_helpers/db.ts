/**
 * E2E 用のデータベース操作。
 *
 * ## 安全ガード（最重要）
 *
 * E2E はテーブルを空にします。**接続先を間違えると本番の予約が消えます。**
 * 事故を仕組みで防ぐため、次をすべて満たさないと実行しません。
 *
 *   1. `E2E_DATABASE_URL` が設定されている（`DATABASE_URL` は使わない）
 *   2. `DATABASE_URL` と別の値である
 *   3. データベース名に `test` / `e2e` / `_ci` のいずれかが含まれる
 *
 * 3 をどうしても満たせない場合だけ `E2E_ALLOW_UNSAFE_DB=1` で外せますが、
 * **本番や共有の環境では絶対に付けないでください。**
 */
import { Pool } from "pg";

const SAFE_DB_NAME = /(test|e2e|_ci)/i;

let pool: Pool | null = null;

/** 安全ガードを通した接続文字列。問題があれば理由を明示して落とす。 */
export function e2eDatabaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) {
    throw new Error(
      "E2E_DATABASE_URL が未設定です。E2E はテーブルを空にするため、" +
        "開発用の DATABASE_URL とは別の専用データベースを .env.local に書いてください。"
    );
  }
  if (process.env.DATABASE_URL && url === process.env.DATABASE_URL) {
    throw new Error(
      "E2E_DATABASE_URL が DATABASE_URL と同じです。" +
        "E2E は専用のデータベースで動かしてください（開発中のデータが消えます）。"
    );
  }
  if (process.env.E2E_ALLOW_UNSAFE_DB !== "1") {
    // 接続文字列にはパスワードが入っている。ログに出さないよう名前だけ取り出す。
    const name = url.split("/").pop()?.split("?")[0] ?? "";
    if (!SAFE_DB_NAME.test(name)) {
      throw new Error(
        `E2E_DATABASE_URL のデータベース名 "${name}" に test / e2e / _ci が含まれていません。` +
          "本番へ向けてしまう事故を防ぐためのガードです。専用データベースの名前を変えるか、" +
          "意図的な場合のみ E2E_ALLOW_UNSAFE_DB=1 を付けてください（本番では絶対に付けない）。"
      );
    }
  }
  return url;
}

export function e2eDb(): Pool {
  pool ??= new Pool({ connectionString: e2eDatabaseUrl(), max: 4 });
  return pool;
}

export async function closeE2eDb(): Promise<void> {
  await pool?.end();
  pool = null;
}

/**
 * 全テーブルを空にする。
 *
 * テーブル名を並べず `pg_tables` から引きます。並べる方式は、テーブルが増えた
 * ときの書き漏らしで「前のテストのデータが残る」という、いちばん追いにくい
 * 壊れ方をするためです。マイグレーションの履歴テーブルは残します。
 */
export async function truncateAll(): Promise<void> {
  const db = e2eDb();
  const { rows } = await db.query<{ tablename: string }>(
    `select tablename from pg_tables
      where schemaname = 'public' and tablename not like '__drizzle%'`
  );
  if (rows.length === 0) return;
  const names = rows.map((r) => `"${r.tablename}"`).join(", ");
  await db.query(`truncate table ${names} restart identity cascade`);
}
