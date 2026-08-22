"use client";

/**
 * Shown in place of a list when its fetch failed.
 *
 * Without this the admin screens rendered an empty table on any backend
 * error, which reads as "there is no data" — the most misleading state a
 * console can show, and the one that hides an unapplied migration or a
 * dropped database connection behind a plausible-looking 0 件.
 */
export function LoadErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-5">
      <p className="text-sm font-bold text-red-800">読み込みに失敗しました</p>
      <p className="mt-1 text-sm text-red-700">{message}</p>
      <p className="mt-2 text-xs text-red-600/80">
        データが 0 件なのではなく、取得そのものが失敗しています。
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 rounded-lg border border-red-300 bg-white px-4 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-100"
        >
          再読み込み
        </button>
      )}
    </div>
  );
}
