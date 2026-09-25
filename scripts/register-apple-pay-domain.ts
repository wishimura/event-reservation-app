import { config } from "dotenv";

config({ path: ".env.local" });

/**
 * Registers a domain for Apple Pay, once.
 *
 * The same thing is available as a button in the admin console, which is the
 * easier route since the token is already set there. This exists for when you
 * would rather do it from a terminal.
 *
 *   npx tsx scripts/register-apple-pay-domain.ts yoyaku.example.jp
 *
 * Run it again for every domain the site is reachable on, and again if the
 * domain changes. Registering one that is already registered is harmless.
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

  // src/lib/square.ts reads the environment at import time, so it has to be
  // pulled in after dotenv has populated it.
  const { hasSquareAccessToken, registerApplePayDomain } = await import(
    "../src/lib/square"
  );

  if (!hasSquareAccessToken()) {
    console.error("SQUARE_ACCESS_TOKEN is not set.");
    process.exit(1);
  }

  const live = process.env.SQUARE_ENVIRONMENT?.trim() === "production";
  console.log(
    `Registering ${domainName} for Apple Pay (${live ? "production" : "sandbox"})...`
  );

  const result = await registerApplePayDomain(domainName);

  if (result.status === "verified") {
    console.log(`${domainName} is verified. Apple Pay is live.`);
    return;
  }

  console.error(
    "Apple could not verify the domain.\n" +
      `Check that https://${domainName}/.well-known/apple-developer-merchantid-domain-association\n` +
      "is reachable over HTTPS without logging in, then run this again."
  );
  process.exit(1);
}

main().catch((error) => {
  console.error("Apple Pay domain registration failed:", error);
  process.exit(1);
});
