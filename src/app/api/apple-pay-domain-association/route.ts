/**
 * Apple Pay domain verification.
 *
 * Apple only lets a site offer Apple Pay once it has fetched a verification
 * file from that site's `/.well-known/`. Square publishes the file and keeps
 * it up to date, and warns against caching it for long, so rather than
 * committing a copy that quietly goes stale we serve Square's current one and
 * re-fetch it every hour.
 *
 * `next.config.ts` rewrites the `/.well-known/` path Apple looks at onto this
 * route. Registering the domain itself is a one-off:
 * `npx tsx scripts/register-apple-pay-domain.ts <domain>`.
 */

const SQUARE_ASSOCIATION_FILE =
  "https://app.squareup.com/digital-wallets/apple-pay/apple-developer-merchantid-domain-association";

export async function GET() {
  try {
    const response = await fetch(SQUARE_ASSOCIATION_FILE, {
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      console.error(
        "Apple Pay association file fetch failed:",
        response.status
      );
      return new Response("", { status: 502 });
    }

    return new Response(await response.text(), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Apple Pay association file fetch failed:", error);
    return new Response("", { status: 502 });
  }
}
