import "server-only";
import { fetchAll } from "./db";
import type { AppEvent } from "./types";

const DAY = 86_400_000;

/** One row of the `lead_rollup` view: lead counts for a campaign × sender pair. */
export type Rollup = {
  campaign_id: string;
  account_id: string;
  leads: number;
  pending: number;
  in_progress: number;
  completed: number;
  replied_status: number;
  bounced: number;
  unsubscribed: number;
  failed: number;
  duplicate: number;
  sent: number;
  contacted: number;
  replied: number;
  opened: number;
};

export async function loadRollup(campaignIds?: string[]): Promise<Rollup[]> {
  if (campaignIds && !campaignIds.length) return [];
  return (await fetchAll("lead_rollup", campaignIds ? (q) => q.in("campaign_id", campaignIds) : undefined)) as unknown as Rollup[];
}

export type Totals = ReturnType<typeof summarize>;

/** Add up rollup rows into the numbers the UI shows. */
export function summarize(rows: Rollup[]) {
  const sum = (k: keyof Rollup) => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0);
  const contacted = sum("contacted");
  const replied = sum("replied");
  const opened = sum("opened");
  const bounced = sum("bounced");
  const unsubscribed = sum("unsubscribed");
  const pct = (n: number) => (contacted ? Math.round((n / contacted) * 1000) / 10 : 0);
  return {
    leads: sum("leads"),
    sent: sum("sent"),
    contacted,
    replied,
    opened,
    bounced,
    unsubscribed,
    pending: sum("pending"),
    inProgress: sum("in_progress"),
    completed: sum("completed"),
    failed: sum("failed"),
    duplicates: sum("duplicate"),
    replyRate: pct(replied),
    openRate: pct(opened),
    bounceRate: pct(bounced),
    unsubRate: pct(unsubscribed),
  };
}

function dayKey(ts: number, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
}

function safeTz(tz?: string | null) {
  try {
    if (tz) {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    }
  } catch {}
  return "UTC";
}

/** Per-day counts for charts, bucketed in the viewer's timezone. */
export function daily(events: AppEvent[], days = 14, timezone?: string | null) {
  const tz = safeTz(timezone);
  const out: { date: string; label: string; sent: number; replies: number; opens: number; bounces: number }[] = [];
  const index = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const ts = Date.now() - i * DAY;
    const key = dayKey(ts, tz);
    if (index.has(key)) continue;
    index.set(key, out.length);
    out.push({
      date: key,
      label: new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(new Date(ts)),
      sent: 0,
      replies: 0,
      opens: 0,
      bounces: 0,
    });
  }
  for (const e of events) {
    const i = index.get(dayKey(e.at, tz));
    if (i === undefined) continue;
    const row = out[i];
    if (e.type === "sent") row.sent++;
    else if (e.type === "reply") row.replies++;
    else if (e.type === "open") row.opens++;
    else if (e.type === "bounce") row.bounces++;
  }
  return out;
}

/** Sum rollup rows per sender (inbox or WhatsApp number). */
export function bySender(rows: Rollup[]) {
  const out = new Map<string, { leads: number; sent: number; replied: number }>();
  for (const r of rows) {
    const cur = out.get(r.account_id) || { leads: 0, sent: 0, replied: 0 };
    cur.leads += r.leads;
    cur.sent += r.sent;
    cur.replied += r.replied;
    out.set(r.account_id, cur);
  }
  return out;
}
