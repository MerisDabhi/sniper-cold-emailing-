import { NextRequest } from "next/server";
import { db, fetchAll, fetchEvents, publicAccount } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { bySender, daily, loadRollup, summarize } from "@/lib/stats";
import { accountSentLast24h, campaignSentToday, inWindow, perAccountQuota, rebalanceLeads } from "@/lib/engine";
import { formatPhone } from "@/lib/phone";
import type { Campaign } from "@/lib/types";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  const d = db();
  const c = d.campaigns.find((x) => x.id === id);
  if (!c) return fail("Campaign not found", 404);
  const [rollup, stepRows, events] = await Promise.all([
    loadRollup([id]),
    fetchAll("lead_steps", (q) => q.eq("campaign_id", id)),
    fetchEvents((q) => q.eq("campaign_id", id).gte("at", Date.now() - 15 * 86_400_000).order("at", { ascending: true })),
  ]);
  const perSender = bySender(rollup);
  const quota = perAccountQuota(c);
  const extra = (sid: string) => ({
    leads: perSender.get(sid)?.leads || 0,
    sentToday: campaignSentToday(c, sid),
    inboxSent24h: accountSentLast24h(sid),
    quota,
  });
  const senders =
    c.channel === "whatsapp"
      ? d.waAccounts
          .filter((a) => c.accountIds.includes(a.id))
          .map((a) => ({
            id: a.id,
            email: a.phone ? formatPhone(a.phone) : a.label || "WhatsApp number",
            name: a.name || a.label || "WhatsApp",
            status: a.status === "connected" ? (a.paused ? "paused" : "active") : "error",
            dailyLimit: a.dailyLimit,
            nextSendAt: a.nextSendAt,
            ...extra(a.id),
          }))
      : d.accounts.filter((a) => c.accountIds.includes(a.id)).map((a) => ({ ...publicAccount(a), ...extra(a.id) }));
  // A lead with step_index = n has received steps 1..n.
  const reached = (stepNo: number) =>
    (stepRows as { step_index: number; leads: number }[]).filter((r) => r.step_index >= stepNo).reduce((n, r) => n + r.leads, 0);

  return ok({
    campaign: c,
    stats: summarize(rollup),
    daily: daily(events, 14, req.nextUrl.searchParams.get("tz")),
    sentToday: campaignSentToday(c),
    inWindow: inWindow(c),
    perAccountQuota: quota,
    senders,
    steps: c.steps.map((s, i) => ({ id: s.id, sent: reached(i + 1) })),
    activity: events.slice(-40).reverse(),
  });
});

const EDITABLE: (keyof Campaign)[] = [
  "name",
  "sheet",
  "mapping",
  "steps",
  "schedule",
  "dailyLimit",
  "accountIds",
  "stopOnReply",
  "trackOpens",
  "unsubscribeFooter",
  "unsubscribeText",
  "sheetStatus",
  "sheetStatusColumn",
  "countryCode",
];

export const PATCH = handle(async (req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  const c = db().campaigns.find((x) => x.id === id);
  if (!c) return fail("Campaign not found", 404);
  const body = await req.json();
  const accountsChanged = body.accountIds && JSON.stringify(body.accountIds) !== JSON.stringify(c.accountIds);
  for (const k of EDITABLE) if (k in body) (c as Record<string, unknown>)[k] = body[k];
  c.name = String(c.name || "").trim().slice(0, 120) || "Untitled campaign";
  c.dailyLimit = Math.max(1, Math.min(10000, Number(c.dailyLimit) || 1));
  c.schedule.minGapSec = Math.max(20, Number(c.schedule.minGapSec) || 60);
  c.schedule.maxGapSec = Math.max(c.schedule.minGapSec, Number(c.schedule.maxGapSec) || 180);
  c.schedule.startHour = Math.max(0, Math.min(23, Number(c.schedule.startHour) || 0));
  c.schedule.endHour = Math.max(1, Math.min(24, Number(c.schedule.endHour) || 24));
  c.steps = (c.steps || []).slice(0, 10).map((s) => ({ ...s, delayDays: Math.max(0, Math.min(90, Number(s.delayDays) || 0)) }));
  c.countryCode = String(c.countryCode || "").replace(/\D/g, "").slice(0, 4);
  if (accountsChanged) await rebalanceLeads(c);
  return ok({ campaign: c });
});

/** Deleting a campaign also deletes its leads (database cascade). Contact history is kept, so nobody is cold-contacted twice. */
export const DELETE = handle(async (_req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  const d = db();
  d.campaigns = d.campaigns.filter((x) => x.id !== id);
  return ok();
});
