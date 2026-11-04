"use client";

import { ProductImageField } from "./ProductImageField";

/**
 * 2枚目以降の商品写真。
 *
 * ## なぜ要るか
 *
 * 一覧に出るのは1枚だけで、それも 96 ピクセル角です。断面も、盛りつけも、
 * 原材料の表示も、そこには写りません。お店から「隅々まで見せたい」という
 * 話が出たのはそのためで、ここに足した写真は詳細を開いたときに並びます。
 *
 * ## 作りについて
 *
 * 1枚ぶんの操作は1枚目とまったく同じなので、`ProductImageField` を
 * そのまま並べています。末尾に常に空の1枚を置いてあり、そこで選べば
 * 増える、消せば減る、という形です。
 */

/** 1商品あたりの上限。サーバー側（products の API）と同じ数。 */
const MAX_EXTRA_IMAGES = 8;

export function ExtraProductImages({
  urls,
  onChange,
}: {
  urls: string[];
  onChange: (urls: string[]) => void;
}) {
  function replace(index: number, url: string) {
    const next = [...urls];
    if (url) {
      next[index] = url;
    } else {
      next.splice(index, 1);
    }
    onChange(next.filter(Boolean));
  }

  const slots = urls.length < MAX_EXTRA_IMAGES ? [...urls, ""] : urls;

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <div>
        <p className="text-xs font-medium text-slate-500">追加の写真（任意）</p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
          商品をタップしたときに、1枚目に続けて並びます。断面や盛りつけ、
          原材料の表示など、一覧では見えないところにどうぞ。最大 {MAX_EXTRA_IMAGES} 枚。
        </p>
      </div>

      {slots.map((url, index) => (
        <ProductImageField
          key={`${index}-${url}`}
          value={url}
          onChange={(next) => replace(index, next)}
          label={url ? `${index + 2}枚目` : "写真を足す"}
        />
      ))}
    </div>
  );
}
