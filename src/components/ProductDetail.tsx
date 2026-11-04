"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { formatPrice } from "@/lib/utils";
import type { Product } from "@/lib/types";

/**
 * 商品の詳細。
 *
 * ## なぜ要るか
 *
 * 一覧では、名前は1行で切られ、説明は2行で切られ、写真は 96 ピクセル角
 * でした。お店から「個別のメニューの説明が読めない」「ガチ勢には隅々まで
 * 見せたい」という話が出たのはそのためです。
 *
 * 一覧の密度は変えません。20品が1画面に収まることにも意味があるので、
 * 読みたい人が開けば全部出る、という形にしてあります。
 *
 * ## 閉じられること
 *
 * 開いたら必ず閉じられなければいけません。×でも、外側でも、Esc でも
 * 閉じます。開いているあいだは後ろの一覧が動かないようにし、閉じたら
 * 元いた場所に戻します（スマホで下まで送った人が先頭に戻されると、
 * もう一度そこまで送り直すことになるので）。
 */
export function ProductDetail({
  product,
  soldOut,
  onClose,
}: {
  product: Product;
  soldOut: boolean;
  onClose: () => void;
}) {
  const photos = [product.image_url, ...(product.extra_image_urls ?? [])].filter(
    (url): url is string => Boolean(url)
  );

  /** 拡大して見ている1枚。閉じているときは null。 */
  const [zoomed, setZoomed] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // 拡大しているときは、まず拡大だけ閉じる。
      setZoomed((current) => {
        if (current) return null;
        onClose();
        return null;
      });
    }

    document.addEventListener("keydown", onKeyDown);

    /*
      後ろの一覧を止める。

      止めずにおくと、詳細の中を送ったつもりが後ろの一覧が動き、閉じたとき
      に見ていた場所を見失います。`position: fixed` で止める書き方もあり
      ますが、スマホで送った位置が飛ぶので、ここは overflow だけにします。
    */
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={product.name}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
    >
      {/*
        外側を押しても閉じる。閉じ方が1つしかないのは不親切なので。

        ボタンではなく、読み上げソフトからは見えない板にしてあります。
        ボタンにすると「閉じる」が2つ並んで聞こえ、しかもこちらは中央では
        本体の下に隠れていて押せません。キーボードと読み上げには、×と Esc
        という確かな出口があります。
      */}
      <div
        role="presentation"
        onClick={onClose}
        className="absolute inset-0 bg-zinc-900/50"
      />

      <div className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <div className="flex items-start gap-3 border-b border-zinc-100 px-5 py-4">
          <h2 className="min-w-0 flex-1 text-base font-bold leading-snug text-zinc-800">
            {product.name}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="詳細を閉じる"
            className="-mr-1 -mt-1 shrink-0 rounded-full p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
          >
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {photos.length > 0 && (
            <div className="mb-4 space-y-3">
              {photos.map((url, index) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setZoomed(url)}
                  aria-label={`${index + 1}枚目の写真を拡大する`}
                  className="relative block w-full overflow-hidden rounded-2xl bg-zinc-100"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt=""
                    loading={index === 0 ? "eager" : "lazy"}
                    className="w-full object-cover"
                  />
                  <span className="absolute bottom-2 right-2 rounded-full bg-zinc-900/60 px-2.5 py-1 text-xs font-medium text-white">
                    タップで拡大
                  </span>
                </button>
              ))}
            </div>
          )}

          {/*
            説明は切りません。ここが「最後まで表示されるようにしたい」の答え
            なので、行数で詰めることはしない。改行は書かれたとおりに出します。
          */}
          {product.description ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-600">
              {product.description}
            </p>
          ) : (
            <p className="text-sm text-zinc-400">
              この商品の説明はまだありません。
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-zinc-100 bg-paper/60 px-5 py-4">
          <p className="text-lg font-bold text-brand-600">
            {formatPrice(product.price)}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-700 active:bg-brand-800"
          >
            {soldOut ? "閉じる" : "一覧に戻って数量を選ぶ"}
          </button>
        </div>
      </div>

      {/*
        拡大した1枚。

        画面いっぱいに、切らずに収めます（`object-contain`）。一覧でも詳細
        でも写真は切り抜かれているので、端まで見られる場所がここしかない。
      */}
      {zoomed && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-900/90">
          <div
            role="presentation"
            onClick={() => setZoomed(null)}
            className="absolute inset-0"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomed}
            alt={product.name}
            className="pointer-events-none relative max-h-[92vh] max-w-[92vw] object-contain"
          />
          <button
            type="button"
            onClick={() => setZoomed(null)}
            aria-label="拡大を閉じる"
            className="absolute right-4 top-4 rounded-full bg-zinc-900/70 p-2.5 text-white"
          >
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}
