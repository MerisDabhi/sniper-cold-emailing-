import "server-only";
import { sb } from "./db";

/**
 * Where the app lives — worked out automatically, so connecting a custom domain needs no
 * config change.
 *
 *  - In a request: the domain the browser is actually on (`requestOrigin`). This is what the
 *    Google sign-in redirect uses, so it always matches the page you started from.
 *  - In background senders (no request): `publicUrl()` — the `APP_URL` setting if set, otherwise
 *    the last public domain the app was opened on (saved automatically by `rememberPublicUrl`).
 */

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i;
const HOST_RE = /^[a-z0-9.-]+(:\d{1,5})?$|^\[[0-9a-f:]+\](:\d{1,5})?$/i;

export const OAUTH_CALLBACK_PATH = "/api/auth/google/callback";

type HeaderSource = { get(name: string): string | null };

/** The origin (protocol + host) the browser used for this request, e.g. https://outreach.example.com */
export function requestOrigin(headers: HeaderSource, fallback?: string): string {
  const host = (headers.get("x-forwarded-host") || headers.get("host") || "").split(",")[0].trim();
  if (!host || !HOST_RE.test(host)) return (fallback || envUrl() || "http://localhost:3000").replace(/\/$/, "");
  const forwardedProto = (headers.get("x-forwarded-proto") || "").split(",")[0].trim().toLowerCase();
  const proto = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : LOCAL.test(host) ? "http" : "https";
  return `${proto}://${host}`;
}

export const isLocalOrigin = (origin: string) => {
  try {
    return LOCAL.test(new URL(origin).host);
  } catch {
    return true;
  }
};

function envUrl() {
  const v = (process.env.APP_URL || "").trim().replace(/\/$/, "");
  return /^https?:\/\//i.test(v) ? v : "";
}

// ─── Public URL for background senders ─────────────────────────────────────

const g = globalThis as unknown as { __sniperPublicUrl?: { value: string | null; at: number } };
const TTL_MS = 5 * 60_000;

/** Load the public URL (cached for 5 minutes). Call before composing messages. */
export async function refreshPublicUrl(): Promise<string | null> {
  const cached = g.__sniperPublicUrl;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  let value: string | null = null;
  const env = envUrl();
  if (env && !isLocalOrigin(env)) value = env;
  else {
    const { data } = await sb().from("app_settings").select("value").eq("key", "public_url").maybeSingle();
    value = data?.value || null;
  }
  g.__sniperPublicUrl = { value, at: Date.now() };
  return value;
}

/** The cached public URL, or null when the app has only been used on localhost. */
export function publicUrl(): string | null {
  return g.__sniperPublicUrl?.value ?? null;
}

/** Called on page loads: remember the public domain the app is being used on. */
export async function rememberPublicUrl(origin: string) {
  if (isLocalOrigin(origin)) return;
  const cached = g.__sniperPublicUrl;
  if (cached?.value === origin && Date.now() - cached.at < TTL_MS) return;
  const { data } = await sb().from("app_settings").select("value").eq("key", "public_url").maybeSingle();
  if (data?.value !== origin) {
    await sb().from("app_settings").upsert({ key: "public_url", value: origin, updated_at: new Date().toISOString() });
  }
  g.__sniperPublicUrl = { value: envUrl() && !isLocalOrigin(envUrl()) ? envUrl() : origin, at: Date.now() };
}
