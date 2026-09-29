"use client";

import { useRef, useState } from "react";

/**
 * Picking a product photo.
 *
 * The picture is shrunk in the browser before it is sent. Photos off a phone
 * are several megabytes of detail nobody sees in a 56-pixel thumbnail, and
 * sending them as they are would be slow on shop wifi and wasteful to store.
 *
 * What comes back is an address, which is what the product has always held —
 * an externally hosted picture still works if one is ever pasted in.
 */
export function ProductImageField({
  value,
  onChange,
  label = "商品画像（任意）",
}: {
  value: string;
  onChange: (url: string) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(file: File) {
    setError("");
    setUploading(true);
    try {
      const shrunk = await shrink(file);

      const form = new FormData();
      form.append("file", shrunk, "product.jpg");

      const res = await fetch("/api/admin/images", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? "画像を保存できませんでした");
        return;
      }
      onChange(data.url);
    } catch (err) {
      console.error("Image upload error:", err);
      setError("画像を読み込めませんでした。別の画像でお試しください。");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>

      <div className="flex items-start gap-3">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">
              画像なし
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
            className="hidden"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              {uploading ? "アップロード中..." : value ? "画像を変える" : "画像を選ぶ"}
            </button>
            {value && (
              <button
                type="button"
                onClick={() => onChange("")}
                disabled={uploading}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                削除
              </button>
            )}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
            スマホで撮った写真をそのまま選べます。大きい画像は自動で縮小します。
            <br />
            画像を選んだあと、<strong>「保存」を押すと商品に反映されます。</strong>
          </p>
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
      </div>
    </div>
  );
}

/** Longest side of the stored picture. Well above any place it is displayed. */
const MAX_EDGE = 1200;

/**
 * Re-encodes the picture at a sensible size.
 *
 * Falls back to the original file if the browser cannot decode it — the
 * server checks the type and size either way, so nothing unchecked gets in.
 */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return file;

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85)
  );
  if (!blob) return file;

  /**
   * Only when it actually came out smaller.
   *
   * Re-encoding is not always a saving: a flat graphic or a screenshot can be
   * a few tens of kilobytes as PNG and several hundred as JPEG, even at
   * smaller dimensions. Measured at 28KB in and 469KB out on one such image,
   * which is the wrong direction for something that is already small enough.
   */
  return blob.size < file.size ? blob : file;
}
