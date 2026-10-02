import "server-only";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { db, save } from "./db";
import type { GmailAccount, OAuthTokens } from "./types";


export const OWNER_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  // Read leads + write each lead's status back into the sheet.
  "https://www.googleapis.com/auth/spreadsheets",
];

export const SHEETS_WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

/** True when the owner granted write access (older logins only had read-only). */
export function ownerCanWriteSheets() {
  const scope = db().owner?.tokens.scope || "";
  return scope.split(" ").includes(SHEETS_WRITE_SCOPE);
}

export const GMAIL_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

/**
 * Google OAuth client. `redirectUri` is only needed for the sign-in flow — it's built from the
 * domain the user is on (see url.ts), so any domain works as long as it's registered in Google Cloud.
 */
export function oauthClient(redirectUri?: string): OAuth2Client {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are missing");
  }
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri);
}

export function authUrl(purpose: "owner" | "gmail", state: string, redirectUri: string, loginHint?: string) {
  return oauthClient(redirectUri).generateAuthUrl({
    access_type: "offline",
    prompt: "consent select_account",
    scope: purpose === "owner" ? OWNER_SCOPES : GMAIL_SCOPES,
    state,
    include_granted_scopes: false,
    login_hint: loginHint,
  });
}

/** Build an authorized client that persists refreshed tokens back into the store. */
function clientFor(tokens: OAuthTokens, onTokens: (t: OAuthTokens) => void): OAuth2Client {
  const c = oauthClient();
  c.setCredentials(tokens);
  c.on("tokens", (t) => {
    onTokens({ ...tokens, ...t, refresh_token: t.refresh_token || tokens.refresh_token });
    save();
  });
  return c;
}

export function ownerClient(): OAuth2Client {
  const owner = db().owner;
  if (!owner) throw new Error("Google Sheets is not connected");
  return clientFor(owner.tokens, (t) => {
    owner.tokens = t;
  });
}

export function accountClient(account: GmailAccount): OAuth2Client {
  return clientFor(account.tokens, (t) => {
    account.tokens = t;
  });
}

export async function fetchProfile(client: OAuth2Client) {
  const { data } = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
  return { email: (data.email || "").toLowerCase(), name: data.name || data.email || "", picture: data.picture || undefined };
}

// ─── Sheets ────────────────────────────────────────────────────────────────

export function parseSpreadsheetId(input: string): string | null {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{25,}$/.test(input.trim())) return input.trim();
  return null;
}

export async function getSpreadsheetMeta(spreadsheetId: string) {
  const sheets = google.sheets({ version: "v4", auth: ownerClient() });
  const { data } = await sheets.spreadsheets.get({ spreadsheetId, fields: "properties.title,sheets.properties.title" });
  return {
    title: data.properties?.title || "Untitled sheet",
    tabs: (data.sheets || []).map((s) => s.properties?.title || "").filter(Boolean),
  };
}

export async function getSheetRows(spreadsheetId: string, tab: string) {
  const sheets = google.sheets({ version: "v4", auth: ownerClient() });
  const range = `'${tab.replace(/'/g, "''")}'`;
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const values = (data.values || []) as string[][];
  if (!values.length) return { headers: [] as string[], rows: [] as Record<string, string>[], rowNumbers: [] as number[] };
  const headers = values[0].map((h, i) => String(h || "").trim() || `Column ${i + 1}`);
  const rows: Record<string, string>[] = [];
  const rowNumbers: number[] = []; // 1-based sheet row of each entry in `rows`
  values.slice(1).forEach((r, i) => {
    const o: Record<string, string> = {};
    headers.forEach((h, j) => (o[h] = String(r[j] ?? "").trim()));
    if (Object.values(o).some(Boolean)) {
      rows.push(o);
      rowNumbers.push(i + 2);
    }
  });
  return { headers, rows, rowNumbers };
}

/** A1 column letter for a 0-based index: 0 → A, 26 → AA. */
export function columnLetter(index: number) {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/**
 * Write status text into one column of a sheet tab, locating rows by email or phone.
 * Creates the column header if it doesn't exist (and widens the grid if needed).
 */
export async function writeSheetStatuses(opts: {
  spreadsheetId: string;
  tab: string;
  /** Column holding the email/phone used to find each lead's row */
  matchHeader: string;
  /** Normalizes a cell of that column the same way lead addresses are normalized */
  normalize: (value: string) => string | null;
  statusHeader: string;
  updates: { match?: string; row?: number; text: string }[];
}) {
  const sheets = google.sheets({ version: "v4", auth: ownerClient() });
  const tabRef = `'${opts.tab.replace(/'/g, "''")}'`;
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: opts.spreadsheetId, range: tabRef });
  const values = (data.values || []) as string[][];
  const headers = (values[0] || []).map((h) => String(h || "").trim());

  const matchIdx = headers.indexOf(opts.matchHeader);
  let statusIdx = headers.findIndex((h) => h.toLowerCase() === opts.statusHeader.trim().toLowerCase());
  const writes: { range: string; values: string[][] }[] = [];

  if (statusIdx === -1) {
    statusIdx = headers.length;
    const meta = await sheets.spreadsheets.get({ spreadsheetId: opts.spreadsheetId, fields: "sheets.properties(sheetId,title,gridProperties)" });
    const props = meta.data.sheets?.find((s) => s.properties?.title === opts.tab)?.properties;
    const cols = props?.gridProperties?.columnCount ?? 26;
    if (props?.sheetId !== undefined && statusIdx >= cols) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: opts.spreadsheetId,
        requestBody: { requests: [{ appendDimension: { sheetId: props.sheetId, dimension: "COLUMNS", length: statusIdx - cols + 1 } }] },
      });
    }
    writes.push({ range: `${tabRef}!${columnLetter(statusIdx)}1`, values: [[opts.statusHeader.trim()]] });
  }

  const rowOf = new Map<string, number>();
  if (matchIdx !== -1) {
    values.slice(1).forEach((r, i) => {
      const e = opts.normalize(String(r[matchIdx] || ""));
      if (e && !rowOf.has(e)) rowOf.set(e, i + 2);
    });
  }

  const col = columnLetter(statusIdx);
  for (const u of opts.updates) {
    const row = u.row ?? (u.match ? rowOf.get(u.match) : undefined);
    if (row) writes.push({ range: `${tabRef}!${col}${row}`, values: [[u.text]] });
  }
  if (!writes.length) return 0;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: opts.spreadsheetId,
    requestBody: { valueInputOption: "RAW", data: writes },
  });
  return writes.length;
}

// ─── Gmail ─────────────────────────────────────────────────────────────────

/** Encode a header value. Line breaks and control characters (e.g. from sheet data) are removed so they can't inject headers. */
function encodeHeader(raw: string) {
  const v = raw.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}

/** Single-line value for address headers (To/From): anything after a line break is dropped. */
const oneLine = (v: string) => v.split(/[\r\n]/)[0].trim();

function b64Lines(s: string) {
  return Buffer.from(s, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
}

export type OutgoingEmail = {
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  inReplyTo?: string;
  threadId?: string;
  listUnsubscribe?: string;
  oneClick?: boolean;
};

export async function sendGmail(account: GmailAccount, mail: OutgoingEmail) {
  const gmail = google.gmail({ version: "v1", auth: accountClient(account) });
  const boundary = "b_" + Math.random().toString(36).slice(2);
  const headers = [
    `From: ${encodeHeader(mail.fromName)} <${oneLine(mail.fromEmail)}>`,
    `To: ${oneLine(mail.to)}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (mail.inReplyTo) headers.push(`In-Reply-To: ${mail.inReplyTo}`, `References: ${mail.inReplyTo}`);
  if (mail.listUnsubscribe) headers.push(`List-Unsubscribe: ${mail.listUnsubscribe}`);
  if (mail.oneClick) headers.push("List-Unsubscribe-Post: List-Unsubscribe=One-Click");

  const raw = [
    ...headers,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(mail.text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(mail.html),
    `--${boundary}--`,
  ].join("\r\n");

  const { data } = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: Buffer.from(raw).toString("base64url"), threadId: mail.threadId },
  });

  // Fetch the RFC Message-ID so follow-ups can thread properly.
  let messageId: string | undefined;
  try {
    const msg = await gmail.users.messages.get({ userId: "me", id: data.id!, format: "metadata", metadataHeaders: ["Message-ID"] });
    messageId = msg.data.payload?.headers?.find((h) => h.name?.toLowerCase() === "message-id")?.value || undefined;
  } catch {
    /* threading falls back to threadId only */
  }
  return { id: data.id!, threadId: data.threadId!, messageId };
}

export type ThreadCheck = { replied: boolean; bounced: boolean; unsubscribe: boolean; at?: number; snippet?: string };

const UNSUB_RE = /\b(unsubscribe|remove me|stop emailing|take me off|not interested|opt[ -]?out)\b/i;

export async function checkThread(account: GmailAccount, threadId: string): Promise<ThreadCheck> {
  const gmail = google.gmail({ version: "v1", auth: accountClient(account) });
  const { data } = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "metadata",
    metadataHeaders: ["From", "Subject", "Auto-Submitted", "X-Autoreply", "X-Autorespond", "Precedence"],
  });
  const result: ThreadCheck = { replied: false, bounced: false, unsubscribe: false };
  for (const m of data.messages || []) {
    const header = (name: string) => m.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
    const from = header("From").toLowerCase();
    if (from.includes(account.email.toLowerCase())) continue;
    const at = Number(m.internalDate) || Date.now();
    if (/mailer-daemon|postmaster|mail delivery/.test(from)) {
      result.bounced = true;
      result.at = at;
      continue;
    }
    // Out-of-office and other automatic replies are not real replies — keep the sequence going.
    const auto = header("Auto-Submitted").toLowerCase();
    if (
      (auto && auto !== "no") ||
      header("X-Autoreply") ||
      header("X-Autorespond") ||
      /^(auto_reply|bulk|junk)$/i.test(header("Precedence")) ||
      /^(automatic reply|auto[- ]?reply|autoreply|out of (the )?office)/i.test(header("Subject"))
    ) {
      continue;
    }
    result.replied = true;
    result.at = at;
    result.snippet = m.snippet || "";
    if (UNSUB_RE.test(m.snippet || "")) result.unsubscribe = true;
  }
  return result;
}

export function isAuthError(err: unknown): boolean {
  const e = err as { message?: string; response?: { status?: number; data?: { error?: string } } };
  const msg = `${e?.message || ""} ${e?.response?.data?.error || ""}`;
  return e?.response?.status === 401 || /invalid_grant|unauthorized_client|invalid_client|Token has been expired|insufficient/i.test(msg);
}

export function errorMessage(err: unknown): string {
  const e = err as { message?: string; response?: { data?: { error?: { message?: string } | string; error_description?: string } } };
  const d = e?.response?.data;
  if (d && typeof d.error === "object" && d.error?.message) return d.error.message;
  if (d?.error_description) return d.error_description;
  return e?.message || String(err);
}
