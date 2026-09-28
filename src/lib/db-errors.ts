/**
 * Reading Postgres error codes back out of a Drizzle failure.
 *
 * Drizzle wraps whatever the driver threw in a `DrizzleQueryError` carrying
 * the SQL text, and hangs the original underneath as `cause`. The Postgres
 * error code — the part worth branching on — is only on that inner error, so
 * checking `error.code` on what was caught silently never matches and the
 * branch is dead.
 *
 * Walk the chain instead, with a bound in case anything ever links to itself.
 */
function postgresErrorCode(error: unknown): string | undefined {
  let current = error;

  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && "code" in current) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string") return code;
    }
    current = (current as { cause?: unknown }).cause;
  }

  return undefined;
}

/** 23505 — a UNIQUE constraint was violated. */
export function isUniqueViolation(error: unknown): boolean {
  return postgresErrorCode(error) === "23505";
}
