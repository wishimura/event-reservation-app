/**
 * Thin fetch wrapper for client components.
 *
 * All data now travels over API routes rather than a database client, so this
 * is the single place that knows how failures are shaped — including an expired
 * admin session, which bounces the user back to the login screen.
 */

export class ApiError extends Error {
  status: number;
  details?: string[];

  constructor(message: string, status: number, details?: string[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export async function fetchJson<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (res.status === 401 && url.startsWith("/api/admin")) {
    window.location.href = `/admin/login?next=${encodeURIComponent(
      window.location.pathname
    )}`;
    throw new ApiError("認証が必要です", 401);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(
      data.error ?? "通信に失敗しました",
      res.status,
      data.details
    );
  }

  return res.json() as Promise<T>;
}
