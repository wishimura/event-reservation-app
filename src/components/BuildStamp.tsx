/**
 * いま見ている画面が、どのコミットから、いつ作られたか。
 *
 * 直したものが本番に出たかどうかを、画面を見るだけで分かるようにします。
 * これが無いと「反映待ち」と「反映済みだが直っていない」を区別できず、
 * 確かめる手段が「とりあえずもう一度試す」しかなくなります。
 *
 * 値は `next.config.ts` がビルド時に1回だけ埋め込みます。
 */

const SHA = process.env.NEXT_PUBLIC_BUILD_SHA || "dev";
const BUILT_AT = process.env.NEXT_PUBLIC_BUILD_TIME || "";

/**
 * ビルド時刻を日本時間の `MM-DD HH:mm` にします。
 *
 * **`toLocaleString` は使いません。** この部品はサーバーでもブラウザでも
 * 描かれ、両者の時間帯の設定が違えば出る文字も変わります。食い違うと
 * React が描き直しの警告を出しますし、何より表示が端末任せになります。
 * 9時間足して桁を取り出すだけなら、どこで描いても同じ文字になります。
 */
function formatBuiltAt(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const jst = new Date(t + 9 * 60 * 60 * 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  return (
    `${two(jst.getUTCMonth() + 1)}-${two(jst.getUTCDate())} ` +
    `${two(jst.getUTCHours())}:${two(jst.getUTCMinutes())}`
  );
}

export function BuildStamp({ compact = false }: { compact?: boolean }) {
  const builtAt = formatBuiltAt(BUILT_AT);
  const full = builtAt ? `${SHA}（${builtAt} 時点）` : SHA;

  return (
    <div
      data-testid="build-stamp"
      title={`このページのバージョン: ${full}`}
      className="font-mono text-[10px] leading-tight text-indigo-400"
    >
      <div>v {SHA}</div>
      {!compact && builtAt && <div>{builtAt}</div>}
    </div>
  );
}
