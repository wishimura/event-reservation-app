import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

/**
 * 管理画面のログイン。
 *
 * ## ここにパスワードは出しません
 *
 * 以前は `SHOW_LOGIN_HINT="true"` のあいだだけ、テスト用にパスワードを
 * 画面に出していました。消しました。
 *
 * **環境変数を消すだけでは足りません。** 何かの拍子に値が戻れば——設定の
 * 取り違え、古い控えからの復元、別の人の手——また出ます。このページは
 * 誰でも開けて、入られれば予約全部の氏名・メール・電話が見えます。
 * 出しうる仕掛けを残しておく理由がありません。
 *
 * 守られていることは S-07（`tests/e2e/auth.e2e.ts`）が見ています。
 */
export default function AdminLoginPage() {
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
      </div>
    </main>
  );
}
