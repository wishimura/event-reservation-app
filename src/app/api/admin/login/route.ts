import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_COOKIE_NAME,
  createSessionToken,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  let password: unknown;
  try {
    ({ password } = await request.json());
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  if (typeof password !== "string" || password.length === 0) {
    return NextResponse.json(
      { error: "パスワードを入力してください" },
      { status: 400 }
    );
  }

  let ok: boolean;
  try {
    ok = verifyPassword(password);
  } catch (err) {
    console.error("Admin login misconfigured:", err);
    return NextResponse.json(
      { error: "サーバー設定が不完全です" },
      { status: 500 }
    );
  }

  if (!ok) {
    return NextResponse.json(
      { error: "パスワードが違います" },
      { status: 401 }
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    ADMIN_COOKIE_NAME,
    await createSessionToken(),
    sessionCookieOptions
  );
  return response;
}
