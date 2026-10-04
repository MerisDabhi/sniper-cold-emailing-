import "server-only";
import { google, type gmail_v1 } from "googleapis";
import { accountClient } from "./google";
import type { GmailAccount } from "./types";

/** One message of a conversation, as shown in the mobile app. */
export type ThreadMessage = {
  id: string;
  fromMe: boolean;
  from: string;
  to: string;
  subject: string;
  date: number;
  /** The new part of the message (quoted history removed when we can detect it) */
  text: string;
  /** Earlier messages quoted below it, if any */
  quoted?: string;
  messageIdHeader?: string;
};

const b64 = (data?: string | null) => (data ? Buffer.from(data, "base64url").toString("utf8") : "");

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

/** Find the plain-text body of a message (falling back to HTML converted to text). */
function bodyText(part?: gmail_v1.Schema$MessagePart): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return b64(part.body.data);
  for (const p of part.parts || []) {
    const t = bodyText(p);
    if (t) return t;
  }
  if (part.mimeType === "text/html" && part.body?.data) return stripHtml(b64(part.body.data));
  return "";
}

/** Split "new text" from the quoted history ("On Mon, … wrote:" / "> …" lines). */
function splitQuoted(text: string): { text: string; quoted?: string } {
  const normalized = text.replace(/\r\n/g, "\n");
  const markers = [/\n\s*On .{3,200}?wrote:\s*\n/s, /\n-{2,}\s*Original Message\s*-{2,}/i, /\nFrom: .+\nSent: /];
  let cut = -1;
  for (const re of markers) {
    const m = normalized.match(re);
    if (m?.index !== undefined && (cut === -1 || m.index < cut)) cut = m.index;
  }
  if (cut === -1) {
    const lines = normalized.split("\n");
    const firstQuote = lines.findIndex((l, i) => l.startsWith(">") && lines.slice(i).every((x) => x.startsWith(">") || !x.trim()));
    if (firstQuote > 0) cut = lines.slice(0, firstQuote).join("\n").length;
  }
  if (cut <= 0) return { text: normalized.trim() };
  return { text: normalized.slice(0, cut).trim(), quoted: normalized.slice(cut).trim() };
}

/** Read a whole Gmail conversation from the inbox that sent it. */
export async function readThread(account: GmailAccount, threadId: string): Promise<ThreadMessage[]> {
  const gmail = google.gmail({ version: "v1", auth: accountClient(account) });
  const { data } = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
  const me = account.email.toLowerCase();
  return (data.messages || []).map((m) => {
    const h = (n: string) => m.payload?.headers?.find((x) => x.name?.toLowerCase() === n.toLowerCase())?.value || "";
    const from = h("From");
    const { text, quoted } = splitQuoted(bodyText(m.payload) || m.snippet || "");
    return {
      id: m.id!,
      fromMe: from.toLowerCase().includes(me),
      from,
      to: h("To"),
      subject: h("Subject"),
      date: Number(m.internalDate) || Date.now(),
      text,
      quoted,
      messageIdHeader: h("Message-ID") || undefined,
    };
  });
}
