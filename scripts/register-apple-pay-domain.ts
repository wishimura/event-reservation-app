import { config } from "dotenv";
import { SquareClient, SquareEnvironment } from "square";

config({ path: ".env.local" });

/**
 * Registers a domain for Apple Pay, once.
 *
 * Apple will not show the Apple Pay button on a domain it has not verified.
 * Square does the verification on our behalf: it asks Apple to fetch
 * `/.well-known/apple-developer-merchantid-domain-association` from the domain
 * given here, which the app already serves.
 *
 * No Apple Developer account is involved — the merchant of record is Square,
 * using the shop's own account behind SQUARE_ACCESS_TOKEN.
 *
 *   npx tsx scripts/register-apple-pay-domain.ts yoyaku.example.jp
 *
 * Run it again for every domain the site is reachable on, and again if the
 * domain ever changes. Registering one that is already registered is harmless.
 */
async function main() {
  const domainName = process.argv[2]?.trim();

  if (!domainName) {
    console.error(
      "Usage: npx tsx scripts/register-apple-pay-domain.ts <domain>\n" +
        "The domain is the bare hostname, with no scheme and no trailing slash."
    );
    process.exit(1);
  }

  if (domainName.includes("/") || domainName.includes(":")) {
    console.error(
      `"${domainName}" looks like a URL. Pass just the hostname, e.g. yoyaku.example.jp`
    );
    process.exit(1);
  }

  const token = process.env.SQUARE_ACCESS_TOKEN?.trim();
  if (!token) {
    console.error("SQUARE_ACCESS_TOKEN is not set.");
    process.exit(1);
  }

  const environment =
    process.env.SQUARE_ENVIRONMENT?.trim() === "production"
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox;

  console.log(
    `Registering ${domainName} for Apple Pay (${
      environment === SquareEnvironment.Production ? "production" : "sandbox"
    })...`
  );

  const client = new SquareClient({ token, environment });
  const response = await client.applePay.registerDomain({ domainName });

  // Square replies VERIFIED once Apple has fetched the file successfully.
  if (response.status === "VERIFIED") {
    console.log(`${domainName} is verified. Apple Pay is live.`);
    return;
  }

  console.error(
    `Verification did not complete (status: ${response.status ?? "unknown"}).\n` +
      `Check that https://${domainName}/.well-known/apple-developer-merchantid-domain-association\n` +
      "is reachable over HTTPS and returns the file, then run this again."
  );
  process.exit(1);
}

main().catch((error) => {
  console.error("Apple Pay domain registration failed:", error);
  process.exit(1);
});
