import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool as LocalPool } from "pg";
import { drizzle as drizzleLocal } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * 本番は Neon に、手元のテストは同じコンテナの PostgreSQL に繋ぎます。
 * どちらを使うかは接続先の URL だけで決めます。
 *
 * Neon 側は WebSocket の `neon-serverless` を使います（`neon-http` は
 * 「No transactions support」で落ちるため。注文の登録は本物のトランザクション
 * を張ります）。このドライバは Neon の入口としか話せないので、素の
 * PostgreSQL には繋がりません。
 *
 * 以前はテストのたびにこのファイルを書き換えて `node-postgres` に差し替えて
 * いました。戻し忘れれば本番が繋がらなくなる作業で、やるたびに危ない。
 * URL を見て選べば、書き換える理由そのものが無くなります。
 */

/**
 * このコンテナの中の PostgreSQL か。
 *
 * **迷ったら Neon 側に倒します。** 読めない文字列を手元の DB と判断して
 * しまうより、本番の接続先として扱って失敗するほうが安全です。
 */
export function isLocalPostgres(connectionString: string): boolean {
  let host: string;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    return false;
  }
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

/**
 * プールは最初に使うときに作ります。Next はビルド時に全ルートを読み込むので、
 * import の時点で DATABASE_URL が無いと落とすと、データベースを設定していない
 * マシンではビルドすら通らなくなります。
 */
const globalForDb = globalThis as unknown as {
  __dbPool?: NeonPool | LocalPool;
};

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill in the Neon connection string."
    );
  }
  return url;
}

/**
 * 5 ではなく 10。
 *
 * 1つのインスタンスが同時に多くのリクエストを捌き、その全部がこのプールから
 * 借ります。注文は0.5秒ほど接続を握るので、5だとその間サイトを見ているだけの
 * 人まで後ろに並びます。Neon のプーラーは数千規模なので、10は何でもない数です。
 */
const MAX_CONNECTIONS = 10;

function createNeonDb(url: string) {
  const pool =
    (globalForDb.__dbPool as NeonPool | undefined) ??
    new NeonPool({ connectionString: url, max: MAX_CONNECTIONS });
  watchForErrors(pool, "Neon pool error:");
  remember(pool);
  return drizzleNeon(pool, { schema });
}

type Db = ReturnType<typeof createNeonDb>;

/**
 * 手元の PostgreSQL。テストと開発でしか通りません。
 *
 * `node-postgres` 版と Neon 版は、このアプリが使う範囲では同じ書き味ですが、
 * 型としては別物です。呼ぶ側に2種類の型を持ち込まないよう、ここで寄せます。
 */
function createLocalDb(url: string): Db {
  const pool =
    (globalForDb.__dbPool as LocalPool | undefined) ??
    new LocalPool({ connectionString: url, max: MAX_CONNECTIONS });
  watchForErrors(pool, "Local postgres pool error:");
  remember(pool);
  return drizzleLocal(pool, { schema }) as unknown as Db;
}

/**
 * `Pool` は EventEmitter を継承していて、"error" に誰も耳を傾けていないと
 * 例外を投げます。待機中の接続は、切れたソケットや認証の失敗といった接続
 * レベルの異常でこれを出すので、聞いておかないとクエリ1本の失敗で済むところが
 * インスタンスごと落ちます。
 */
function watchForErrors(pool: NeonPool | LocalPool, label: string) {
  if (pool.listenerCount("error") === 0) {
    pool.on("error", (err: Error) => {
      console.error(label, err);
    });
  }
}

/** 開発中の再読み込みでプールを作り直して接続を漏らさないようにする。 */
function remember(pool: NeonPool | LocalPool) {
  if (process.env.NODE_ENV !== "production") {
    globalForDb.__dbPool = pool;
  }
}

function createDb(): Db {
  const url = connectionString();
  return isLocalPostgres(url) ? createLocalDb(url) : createNeonDb(url);
}

let cached: Db | undefined;

function getDb(): Db {
  cached ??= createDb();
  return cached;
}

export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
