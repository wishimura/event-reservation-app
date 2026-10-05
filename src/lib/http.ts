/**
 * Small guards for what arrives over HTTP.
 *
 * Everything here exists because Postgres is stricter than JSON is. An id
 * that is not a uuid, or a body that parsed but is not an object, reaches
 * the database as a type error and comes back out as a 500 — which reads to
 * whoever is watching as "the site is broken" rather than "that address does
 * not exist". Checking the shape first turns those into the answers they
 * actually are.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value is a canonical uuid, which is the only form we ever mint. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * Reads a JSON object out of a request.
 *
 * `request.json()` is happy to return `null`, a number or an array — all of
 * them valid JSON — and reading a field off that throws. Returns null when
 * the body is anything other than a plain object, so the caller can answer
 * with a 400 instead of falling over.
 */
export async function readJsonObject(
  request: Request
): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await request.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
