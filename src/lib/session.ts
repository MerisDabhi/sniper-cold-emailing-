/** Signed session cookie — works in both the Edge middleware and Node route handlers. */

export const SESSION_COOKIE = "sniper_session";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set (at least 32 characters)");
  return "dev-only-insecure-secret-change-me-please";
}

/** Compare two strings without leaking where they differ. */
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmac(value: string) {
  const secret = sessionSecret();
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signSession(email: string) {
  const payload = `${email}|${Date.now() + MAX_AGE_MS}`;
  return `${btoa(payload)}.${await hmac(payload)}`;
}

export async function verifySession(cookie?: string): Promise<string | null> {
  if (!cookie) return null;
  const [b64, sig] = cookie.split(".");
  if (!b64 || !sig) return null;
  let payload: string;
  try {
    payload = atob(b64);
  } catch {
    return null;
  }
  let expected: string;
  try {
    expected = await hmac(payload);
  } catch {
    return null; // misconfigured secret: treat everyone as signed out
  }
  if (!safeEqual(expected, sig)) return null;
  const [email, exp] = payload.split("|");
  if (!email || Number(exp) < Date.now()) return null;
  return email;
}

export const SESSION_MAX_AGE_SEC = MAX_AGE_MS / 1000;
