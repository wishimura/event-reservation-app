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
function postgresError(
  error: unknown
): { code?: string; constraint?: string } | undefined {
  let current = error;

  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && "code" in current) {
      const withCode = current as { code?: unknown; constraint?: unknown };
      if (typeof withCode.code === "string") {
        return {
          code: withCode.code,
          constraint:
            typeof withCode.constraint === "string"
              ? withCode.constraint
              : undefined,
        };
      }
    }
    current = (current as { cause?: unknown }).cause;
  }

  return undefined;
}

/** 23505 — a UNIQUE constraint was violated. */
export function isUniqueViolation(error: unknown): boolean {
  return postgresError(error)?.code === "23505";
}

/**
 * Whether a failure is a unique violation on one particular constraint.
 *
 * Two of them can come out of the same insert and they mean opposite things:
 * a clash on the order number is bad luck and the order should be replayed
 * with a new one, while a clash on the customer's request id means this very
 * order already exists and must not be made a second time.
 */
export function isUniqueViolationOn(error: unknown, constraint: string): boolean {
  const pg = postgresError(error);
  return pg?.code === "23505" && pg.constraint === constraint;
}
