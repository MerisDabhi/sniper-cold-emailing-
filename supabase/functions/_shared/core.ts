// Shared helpers for Sniper's Edge Functions (Deno).
// Secrets come from Supabase Vault via the service-role-only `app_secret` function — nothing secret
// is ever shipped inside the mobile app.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { decodeBase64Url, encodeBase64Url } from "jsr:@std/encoding@1/base64url";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

let client: SupabaseClient | null = null;
export function sb(): SupabaseClient {
  if (!client) {
    client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

const secretCache = new Map<string, string>();
export async function secret(name: string): Promise<string> {
  const cached = secretCache.get(name);
  if (cached) return cached;
  const { data, error } = await sb().rpc("app_secret", { p_name: name });
  if (error || !data) throw new Error(`Missing secret ${name}`);
  secretCache.set(name, data as string);
  return data as string;
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
export const fail = (message: string, status = 400) => json({ error: message }, status);

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Login tokens (HMAC-signed, 60 days) ───────────────────────────────────

const TOKEN_TTL_MS = 60 * 86_400_000;

export async function signToken(user: string): Promise<string> {
  const payload = `${user}|${Date.now() + TOKEN_TTL_MS}`;
  const sig = createHmac("sha256", await secret("mobile_token_secret")).update(payload).digest("base64url");
  return `${encodeBase64Url(new TextEncoder().encode(payload))}.${sig}`;
}

export async function verifyToken(req: Request): Promise<string | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return null;
  let payload: string;
  try {
    payload = new TextDecoder().decode(decodeBase64Url(b64));
  } catch {
    return null;
  }
  const expected = createHmac("sha256", await secret("mobile_token_secret")).update(payload).digest("base64url");
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [user, exp] = payload.split("|");
  return user && Number(exp) > Date.now() ? user : null;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Uint8Array.from(hash.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

// ─── Google OAuth (refresh access tokens stored in the database) ───────────

type Tokens = { access_token?: string | null; refresh_token?: string | null; expiry_date?: number | null; [k: string]: unknown };

/** A valid access token for a Gmail inbox (`accounts` row) or the Sheets owner (`owner` row). */
export async function accessToken(table: "accounts" | "owner", id: string, tokens: Tokens): Promise<string> {
  if (tokens.access_token && (tokens.expiry_date || 0) > Date.now() + 60_000) return tokens.access_token;
  if (!tokens.refresh_token) throw new Error("Google access expired — reconnect this account in Sniper");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: await secret("google_client_id"),
      client_secret: await secret("google_client_secret"),
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google sign-in refresh failed: ${data.error_description || data.error || res.status}`);
  const updated = { ...tokens, access_token: data.access_token, expiry_date: Date.now() + (data.expires_in || 3600) * 1000 };
  await sb().from(table).update({ tokens: updated }).eq("id", id);
  return data.access_token;
}

export async function google<T = Record<string, unknown>>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data?.error?.message || `Google API error ${res.status}`);
  return data as T;
}

// ─── Gmail ─────────────────────────────────────────────────────────────────

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[]; headers?: { name: string; value: string }[] };
export type GmailMessage = { id: string; threadId: string; internalDate?: string; snippet?: string; payload?: Part };

export const header = (m: GmailMessage, name: string) =>
  m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

const b64text = (data?: string) => (data ? new TextDecoder().decode(decodeBase64Url(data)) : "");

function stripHtml(html: string) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function bodyText(part?: Part): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return b64text(part.body.data);
  for (const p of part.parts || []) {
    const t = bodyText(p);
    if (t) return t;
  }
  if (part.mimeType === "text/html" && part.body?.data) return stripHtml(b64text(part.body.data));
  return "";
}

function splitQuoted(text: string): { text: string; quoted?: string } {
  const n = text.replace(/\r\n/g, "\n");
  const markers = [/\n\s*On .{3,200}?wrote:\s*\n/s, /\n-{2,}\s*Original Message\s*-{2,}/i, /\nFrom: .+\nSent: /];
  let cut = -1;
  for (const re of markers) {
    const m = n.match(re);
    if (m?.index !== undefined && (cut === -1 || m.index < cut)) cut = m.index;
  }
  if (cut <= 0) return { text: n.trim() };
  return { text: n.slice(0, cut).trim(), quoted: n.slice(cut).trim() };
}

export async function readThread(token: string, threadId: string, myEmail: string) {
  const data = await google<{ messages?: GmailMessage[] }>(token, `${GMAIL}/threads/${threadId}?format=full`);
  const me = myEmail.toLowerCase();
  return (data.messages || []).map((m) => {
    const from = header(m, "From");
    const { text, quoted } = splitQuoted(bodyText(m.payload) || m.snippet || "");
    return {
      id: m.id,
      fromMe: from.toLowerCase().includes(me),
      from,
      to: header(m, "To"),
      subject: header(m, "Subject"),
      date: Number(m.internalDate) || Date.now(),
      text,
      quoted,
      messageIdHeader: header(m, "Message-ID") || undefined,
    };
  });
}

function encodeHeader(raw: string) {
  const v = raw.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${encodeBase64(new TextEncoder().encode(v))}?=`;
}

const b64lines = (s: string) => encodeBase64(new TextEncoder().encode(s)).replace(/.{76}/g, "$&\r\n");

export function textToHtml(text: string) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const linked = esc.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return `<div dir="ltr" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">${linked
    .split(/\n{2,}/)
    .map((p) => `<div>${p.replace(/\n/g, "<br>")}</div>`)
    .join("<div><br></div>")}</div>`;
}

export async function sendGmail(
  token: string,
  mail: { fromName: string; fromEmail: string; to: string; subject: string; text: string; threadId?: string; inReplyTo?: string },
) {
  const boundary = "b_" + crypto.randomUUID().replace(/-/g, "");
  const oneLine = (v: string) => v.split(/[\r\n]/)[0].trim();
  const headers = [
    `From: ${encodeHeader(mail.fromName)} <${oneLine(mail.fromEmail)}>`,
    `To: ${oneLine(mail.to)}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (mail.inReplyTo) headers.push(`In-Reply-To: ${oneLine(mail.inReplyTo)}`, `References: ${oneLine(mail.inReplyTo)}`);
  const raw = [
    ...headers,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64lines(mail.text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64lines(textToHtml(mail.text)),
    `--${boundary}--`,
  ].join("\r\n");
  return await google<{ id: string; threadId: string }>(token, `${GMAIL}/messages/send`, {
    method: "POST",
    body: JSON.stringify({ raw: encodeBase64Url(new TextEncoder().encode(raw)), threadId: mail.threadId }),
  });
}

export const GMAIL_API = GMAIL;

// ─── Misc ──────────────────────────────────────────────────────────────────

export const id = (prefix: string) => prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

export const leadLabel = (l: { email?: string | null; phone?: string | null }) => (l.phone ? `+${l.phone}` : l.email || "");

export const leadName = (data: Record<string, string> | null) => [data?.first_name, data?.last_name].filter(Boolean).join(" ");
