import "server-only";
import { db } from "./db";
import type { AppEvent, Lead } from "./types";

const DAY = 86_400_000;

export function summarize(leads: Lead[], events: AppEvent[]) {
  void events;
  // Every send advances stepIndex by one, so this is an exact all-time count (events in memory only cover 45 days).
  const sent = leads.reduce((n, l) => n + l.stepIndex, 0);
  const contacted = leads.filter((l) => l.stepIndex > 0).length;
  const replied = leads.filter((l) => l.repliedAt).length;
  const opened = leads.filter((l) => l.openedAt).length;
  const bounced = leads.filter((l) => l.status === "bounced").length;
  const unsubscribed = leads.filter((l) => l.status === "unsubscribed").length;
  const pct = (n: number) => (contacted ? Math.round((n / contacted) * 1000) / 10 : 0);
  return {
    leads: leads.length,
    sent,
    contacted,
    replied,
    opened,
    bounced,
    unsubscribed,
    pending: leads.filter((l) => l.status === "pending").length,
    inProgress: leads.filter((l) => l.status === "in_progress").length,
    completed: leads.filter((l) => l.status === "completed").length,
    failed: leads.filter((l) => l.status === "failed").length,
    duplicates: leads.filter((l) => l.status === "duplicate").length,
    replyRate: pct(replied),
    openRate: pct(opened),
    bounceRate: pct(bounced),
    unsubRate: pct(unsubscribed),
  };
}

export function daily(events: AppEvent[], days = 14) {
  const out: { date: string; label: string; sent: number; replies: number; opens: number; bounces: number }[] = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(start.getTime() - i * DAY);
    out.push({
      date: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      sent: 0,
      replies: 0,
      opens: 0,
      bounces: 0,
    });
  }
  const first = start.getTime() - (days - 1) * DAY;
  for (const e of events) {
    if (e.at < first) continue;
    const idx = Math.floor((e.at - first) / DAY);
    const row = out[idx];
    if (!row) continue;
    if (e.type === "sent") row.sent++;
    else if (e.type === "reply") row.replies++;
    else if (e.type === "open") row.opens++;
    else if (e.type === "bounce") row.bounces++;
  }
  return out;
}

export function campaignStats(campaignId: string) {
  const d = db();
  return summarize(
    d.leads.filter((l) => l.campaignId === campaignId),
    d.events.filter((e) => e.campaignId === campaignId),
  );
}
