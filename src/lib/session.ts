/** Signed session cookie — works in both the Edge middleware and Node route handlers. */

export const SESSION_COOKIE = "sniper_session";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

async function hmac(value: string) {
  const secret = process.env.SESSION_SECRET || "dev-insecure-secret";
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
  if ((await hmac(payload)) !== sig) return null;
  const [email, exp] = payload.split("|");
  if (!email || Number(exp) < Date.now()) return null;
  return email;
}

export const SESSION_MAX_AGE_SEC = MAX_AGE_MS / 1000;
