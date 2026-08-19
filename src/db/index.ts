import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

/**
 * We use the WebSocket-based `neon-serverless` driver rather than `neon-http`
 * because order creation needs a real interactive transaction — `neon-http`
 * throws "No transactions support in neon-http driver".
 *
 * Node 22 exposes a global `WebSocket`, so no `ws` polyfill is required.
 */

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill in the Neon connection string."
  );
}

// Reuse the pool across hot reloads in development so we don't leak connections.
const globalForDb = globalThis as unknown as {
  __neonPool?: Pool;
};

const pool =
  globalForDb.__neonPool ?? new Pool({ connectionString, max: 5 });

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

export const db = drizzle(pool, { schema });

export { schema };
