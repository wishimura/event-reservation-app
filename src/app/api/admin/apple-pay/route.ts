import { NextRequest, NextResponse } from "next/server";
import { hasSquareAccessToken, registerApplePayDomain } from "@/lib/square";

/**
 * Apple Pay domain registration, from the admin console.
 *
 * The registration is a single call against the shop's own Square account,
 * and the access token is already in this environment — so doing it here
 * saves setting up a local checkout just to run it once.
 *
 * The domain is chosen in the console, defaulting to the one it is open on,
 * because only the operator knows which URL customers are given. A project
 * can carry several aliases and every deploy adds a throwaway one, so
 * guessing gets it wrong. Apple verifies by fetching a file from the domain
 * over public HTTPS, so it has to be reachable without logging in.
 *
 * More than one domain can be registered; do it once per URL in use.
 */

export const dynamic = "force-dynamic";

/** A hostname Apple could actually reach, or null. */
function usableDomain(value: string | undefined | null): string | null {
  const host = value?.trim();
  if (!host) return null;

  // Drop the scheme and port: Apple registers hostnames, not origins.
  const domain = host
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0]
    .toLowerCase();

  // Apple cannot reach a local machine, so there is nothing to register.
  if (
    !domain ||
    domain === "localhost" ||
    domain.endsWith(".local") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(domain)
  ) {
    return null;
  }

  return domain;
}

export async function GET(request: NextRequest) {
  const openedOn = usableDomain(request.headers.get("host"));

  // Vercel's idea of the production domain is the shortest alias, which is
  // not necessarily the one customers are given. Offer it, do not assume it.
  const alternative = usableDomain(process.env.VERCEL_PROJECT_PRODUCTION_URL);

  return NextResponse.json({
    configured: hasSquareAccessToken(),
    domain: openedOn,
    alternative: alternative && alternative !== openedOn ? alternative : null,
  });
}

export async function POST(request: NextRequest) {
  if (!hasSquareAccessToken()) {
    return NextResponse.json(
      { error: "Square のアクセストークンが設定されていません" },
      { status: 400 }
    );
  }

  let requested: string | undefined;
  try {
    const body = await request.json();
    requested = typeof body?.domain === "string" ? body.domain : undefined;
  } catch {
    // No body is fine: fall back to the domain this request arrived on.
  }

  const domain =
    usableDomain(requested) ?? usableDomain(request.headers.get("host"));

  if (!domain) {
    return NextResponse.json(
      {
        error:
          "登録できるドメインではありません。お客様に案内するURLのドメインを入力してください。",
      },
      { status: 400 }
    );
  }

  try {
    const result = await registerApplePayDomain(domain);

    if (result.status === "verified") {
      return NextResponse.json({ domain, verified: true });
    }

    return NextResponse.json(
      {
        domain,
        verified: false,
        error:
          `${domain} の確認が完了しませんでした。` +
          "サイトがログイン無しで開ける状態か確認してから、もう一度お試しください。",
      },
      { status: 409 }
    );
  } catch (error) {
    console.error("Apple Pay domain registration failed:", error);
    return NextResponse.json(
      { error: "Apple Pay のドメイン登録に失敗しました" },
      { status: 500 }
    );
  }
}
