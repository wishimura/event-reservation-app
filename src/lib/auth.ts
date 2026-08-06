/**
 * Minimal session auth for the admin console.
 *
 * Uses Web Crypto only, so the same helpers run in both the Node runtime
 * (API routes) and the Edge runtime (middleware).
 */

export const ADMIN_COOKIE_NAME = "admin_session";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer): string {
  const b = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64url(sig);
}

/** Constant-time string comparison, to avoid leaking secrets via timing. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function getSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET is not set");
  }
  return secret;
}

/** Token format: `<expiryMillis>.<hmac>` */
export async function createSessionToken(): Promise<string> {
  const exp = String(Date.now() + SESSION_TTL_MS);
  const sig = await sign(getSecret(), exp);
  return `${exp}.${sig}`;
}

export async function verifySessionToken(
  token: string | undefined
): Promise<boolean> {
  if (!token) return false;

  const sep = token.lastIndexOf(".");
  if (sep <= 0) return false;

  const exp = token.slice(0, sep);
  const sig = token.slice(sep + 1);

  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs < Date.now()) return false;

  let expected: string;
  try {
    expected = await sign(getSecret(), exp);
  } catch {
    return false;
  }

  return timingSafeEqual(sig, expected);
}

export function verifyPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    throw new Error("ADMIN_PASSWORD is not set");
  }
  return timingSafeEqual(input, expected);
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_MS / 1000,
};
