import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

/**
 * We use the WebSocket-based `neon-serverless` driver rather than `neon-http`
 * because order creation needs a real interactive transaction — `neon-http`
 * throws "No transactions support in neon-http driver".
 *
 * Node 22 exposes a global `WebSocket`, so no `ws` polyfill is required.
 *
 * The pool is built on first use rather than at import time. Next collects
 * page data at build time, which loads every route module; throwing there
 * over a missing DATABASE_URL would fail the build on any machine that has
 * no database configured.
 */

// Reuse the pool across hot reloads in development so we don't leak connections.
const globalForDb = globalThis as unknown as { __neonPool?: Pool };

function createDb() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill in the Neon connection string."
    );
  }

  const pool = globalForDb.__neonPool ?? new Pool({ connectionString, max: 5 });

  /**
   * `Pool` inherits EventEmitter, which throws when an "error" event has no
   * listener. Idle clients emit that event on any connection-level failure —
   * a dropped socket, or Postgres rejecting the credentials — which would
   * otherwise take down the whole function instead of failing the one query.
   */
  if (pool.listenerCount("error") === 0) {
    pool.on("error", (err: Error) => {
      console.error("Neon pool error:", err);
    });
  }

  if (process.env.NODE_ENV !== "production") {
    globalForDb.__neonPool = pool;
  }

  return drizzle(pool, { schema });
}

type Db = ReturnType<typeof createDb>;

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
