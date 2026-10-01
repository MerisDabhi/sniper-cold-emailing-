import { db, publicAccount } from "@/lib/db";
import { handle, ok } from "@/lib/api";
import { daily, summarize } from "@/lib/stats";
import { accountSentLast24h } from "@/lib/engine";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const d = db();
  const now = Date.now();
  const names = new Map(d.campaigns.map((c) => [c.id, c.name]));
  const accEmails = new Map(d.accounts.map((a) => [a.id, a.email]));
  return ok({
    totals: summarize(d.leads, d.events),
    sentToday: d.events.filter((e) => e.type === "sent" && e.at > now - 86_400_000).length,
    capacity: d.accounts.filter((a) => a.status === "active").reduce((s, a) => s + a.dailyLimit, 0),
    daily: daily(d.events, 30),
    campaigns: {
      active: d.campaigns.filter((c) => c.status === "active").length,
      total: d.campaigns.length,
    },
    accounts: d.accounts.map((a) => ({
      ...publicAccount(a),
      sentToday: accountSentLast24h(a.id),
      replies: d.leads.filter((l) => l.accountId === a.id && l.repliedAt).length,
    })),
    unsubscribes: d.unsubscribes.length,
    activity: d.events
      .slice(-25)
      .reverse()
      .map((e) => ({ ...e, campaign: e.campaignId ? names.get(e.campaignId) : undefined, sender: e.accountId ? accEmails.get(e.accountId) : undefined })),
  });
});
