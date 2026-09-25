import { NextRequest, NextResponse } from "next/server";
import { hasSquareAccessToken, registerApplePayDomain } from "@/lib/square";

/**
 * Apple Pay domain registration, from the admin console.
 *
 * The registration is a single call against the shop's own Square account,
 * and the access token is already in this environment — so doing it here
 * saves setting up a local checkout just to run it once.
 *
 * The domain is taken from the request rather than typed in, so it is always
 * the domain the console was actually opened on. Apple verifies by fetching
 * a file from that domain over public HTTPS, which means the domain has to be
 * reachable without logging in.
 */

export const dynamic = "force-dynamic";

/** The bare hostname this request arrived on, or null if it is not usable. */
function requestDomain(request: NextRequest): string | null {
  const host = request.headers.get("host")?.trim();
  if (!host) return null;

  // Drop the port: Apple registers hostnames, not origins.
  const domain = host.split(":")[0].toLowerCase();

  // Apple cannot reach a local machine, so there is nothing to register.
  if (
    domain === "localhost" ||
    domain.endsWith(".local") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(domain)
  ) {
    return null;
  }

  return domain;
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    configured: hasSquareAccessToken(),
    domain: requestDomain(request),
  });
}

export async function POST(request: NextRequest) {
  if (!hasSquareAccessToken()) {
    return NextResponse.json(
      { error: "Square のアクセストークンが設定されていません" },
      { status: 400 }
    );
  }

  const domain = requestDomain(request);
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
