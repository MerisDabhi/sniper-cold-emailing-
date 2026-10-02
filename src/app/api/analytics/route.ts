import { NextRequest } from "next/server";
import { db, fetchEvents, publicAccount } from "@/lib/db";
import { handle, ok } from "@/lib/api";
import { bySender, daily, loadRollup, summarize } from "@/lib/stats";
import { accountSentLast24h } from "@/lib/engine";
import { formatPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

/** Dashboard numbers, optionally for one channel (?channel=email|whatsapp), charted in ?tz. */
export const GET = handle(async (req: NextRequest) => {
  const d = db();
  const now = Date.now();
  const sp = req.nextUrl.searchParams;
  const channel = sp.get("channel");
  const campaigns = channel === "email" || channel === "whatsapp" ? d.campaigns.filter((c) => c.channel === channel) : d.campaigns;
  const ids = campaigns.map((c) => c.id);

  const [allRollup, events] = await Promise.all([
    loadRollup(),
    ids.length ? fetchEvents((q) => q.in("campaign_id", ids).gte("at", now - 31 * 86_400_000).order("at", { ascending: true })) : [],
  ]);
  const idSet = new Set(ids);
  const rollup = allRollup.filter((r) => idSet.has(r.campaign_id));
  const perSender = bySender(allRollup);

  const names = new Map(d.campaigns.map((c) => [c.id, c.name]));
  const channelOf = new Map(d.campaigns.map((c) => [c.id, c.channel]));
  const senderName = new Map<string, string>([
    ...d.accounts.map((a) => [a.id, a.email] as [string, string]),
    ...d.waAccounts.map((a) => [a.id, a.phone ? formatPhone(a.phone) : a.label || "WhatsApp"] as [string, string]),
  ]);

  const emailSenders =
    channel === "whatsapp"
      ? []
      : d.accounts.map((a) => ({
          ...publicAccount(a),
          channel: "email" as const,
          sentToday: accountSentLast24h(a.id),
          replies: perSender.get(a.id)?.replied || 0,
        }));
  const waSenders =
    channel === "email"
      ? []
      : d.waAccounts.map((a) => ({
          id: a.id,
          email: a.phone ? formatPhone(a.phone) : a.label || "New number",
          name: a.name || a.label || "WhatsApp",
          status: a.status === "connected" ? (a.paused ? "paused" : "active") : "error",
          dailyLimit: a.dailyLimit,
          channel: "whatsapp" as const,
          sentToday: accountSentLast24h(a.id),
          replies: perSender.get(a.id)?.replied || 0,
        }));
  const senders = [...emailSenders, ...waSenders];

  return ok({
    totals: summarize(rollup),
    sentToday: events.filter((e) => e.type === "sent" && e.at > now - 86_400_000).length,
    capacity: senders.filter((a) => a.status === "active").reduce((s, a) => s + a.dailyLimit, 0),
    daily: daily(events, 30, sp.get("tz")),
    byChannel: (["email", "whatsapp"] as const).map((ch) => {
      const cids = new Set(d.campaigns.filter((c) => c.channel === ch).map((c) => c.id));
      return { channel: ch, ...summarize(allRollup.filter((r) => cids.has(r.campaign_id))) };
    }),
    campaigns: {
      active: campaigns.filter((c) => c.status === "active").length,
      total: campaigns.length,
    },
    accounts: senders,
    hasEmailSenders: d.accounts.length > 0,
    hasWhatsAppSenders: d.waAccounts.length > 0,
    unsubscribes: d.unsubscribes.length,
    activity: events
      .slice(-25)
      .reverse()
      .map((e) => ({
        ...e,
        channel: e.campaignId ? channelOf.get(e.campaignId) : undefined,
        campaign: e.campaignId ? names.get(e.campaignId) : undefined,
        sender: e.accountId ? senderName.get(e.accountId) : undefined,
      })),
  });
});
