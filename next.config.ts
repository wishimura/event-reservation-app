import type { NextConfig } from "next";
import { execSync } from "node:child_process";

/**
 * この画面がどのコミットから作られたかを、画面に出せるようにします。
 *
 * 「直したものが本番に出ているのか」を、お店も私たちも見て確かめられる
 * ようにするためです。これが無いと、反映を待っているのか、反映済みなのに
 * 直っていないのかが区別できません。
 *
 * ビルドのときに1回だけ決まる値なので `env` に入れます（リクエストごとに
 * 変わってはいけません）。Vercel は commit のハッシュを環境変数でくれます。
 * 手元では git に聞き、git も無ければ `dev` とします。
 */
function buildSha(): string {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromVercel) return fromVercel.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_SHA: buildSha(),
    /** ビルドした時刻。表示は日本時間に直します（`BuildStamp`）。 */
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },

  async rewrites() {
    return [
      {
        // Apple looks for the verification file at this exact path. The route
        // behind it serves Square's current copy — see the route for why it
        // is not a committed file.
        source: "/.well-known/apple-developer-merchantid-domain-association",
        destination: "/api/apple-pay-domain-association",
      },
    ];
  },
};

export default nextConfig;
