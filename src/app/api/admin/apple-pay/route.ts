import { NextRequest, NextResponse } from "next/server";
import { hasSquareAccessToken, registerApplePayDomain } from "@/lib/square";

/**
 * Apple Pay domain registration, from the admin console.
 *
 * The registration is a single call against the shop's own Square account,
 * and the access token is already in this environment — so doing it here
 * saves setting up a local checkout just to run it once.
 *
 * What gets registered is the project's production domain, not whatever URL
 * the console happens to be open on. Every deploy also gets its own throwaway
 * URL, and registering one of those would verify a domain that stops being
 * used at the next deploy. Apple verifies by fetching a file from the domain
 * over public HTTPS, so it has to be reachable without logging in.
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

/**
 * The domain to register: the project's production domain when the host
 * tells us one, otherwise whatever this request came in on.
 */
function targetDomain(request: NextRequest): {
  domain: string | null;
  openedOn: string | null;
} {
  const openedOn = usableDomain(request.headers.get("host"));
  const production = usableDomain(process.env.VERCEL_PROJECT_PRODUCTION_URL);

  return { domain: production ?? openedOn, openedOn };
}

export async function GET(request: NextRequest) {
  const { domain, openedOn } = targetDomain(request);

  return NextResponse.json({
    configured: hasSquareAccessToken(),
    domain,
    // Lets the console point out that the URL in the address bar is not the
    // one being registered.
    opened_on: openedOn,
  });
}

export async function POST(request: NextRequest) {
  if (!hasSquareAccessToken()) {
    return NextResponse.json(
      { error: "Square のアクセストークンが設定されていません" },
      { status: 400 }
    );
  }

  const { domain } = targetDomain(request);
  if (!domain) {
    return NextResponse.json(
      {
        error:
          "このアドレスでは登録できません。本番のURLで管理画面を開いてから実行してください。",
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
