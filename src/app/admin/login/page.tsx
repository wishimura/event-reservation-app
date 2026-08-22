import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

/**
 * Showing the password on a page anyone can reach hands the console — and
 * every reservation's name, email and phone number — to whoever finds the
 * URL. It is therefore off unless SHOW_LOGIN_HINT is explicitly "true", so
 * turning it off is one environment variable rather than a code change, and
 * the hint carries its own warning so it cannot be quietly forgotten.
 */
function testCredential(): string | null {
  if (process.env.SHOW_LOGIN_HINT !== "true") return null;
  return process.env.ADMIN_PASSWORD || null;
}

export default function AdminLoginPage() {
  const hint = testCredential();

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-slate-800">管理画面</h1>
          <p className="text-xs text-slate-500 mt-1">Event Reservation</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <Suspense
            fallback={<div className="text-sm text-slate-400">読み込み中...</div>}
          >
            <LoginForm />
          </Suspense>
        </div>

        {hint && (
          <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <div className="flex items-start gap-2.5">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                strokeLinecap="round"
              >
                <path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z" />
                <path d="M12 9v4" />
                <path d="M12 17v.01" />
              </svg>
              <div className="min-w-0">
                <p className="text-xs font-bold text-amber-900">
                  テスト用の表示（本番前に必ず消してください）
                </p>
                <p className="mt-1 text-xs leading-relaxed text-amber-800">
                  パスワード:{" "}
                  <span className="font-mono font-bold tracking-wide">
                    {hint}
                  </span>
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-amber-700">
                  このページは誰でも開けます。予約が入り始める前に、Vercel の環境変数
                  <span className="font-mono"> SHOW_LOGIN_HINT </span>
                  を削除してください。
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
