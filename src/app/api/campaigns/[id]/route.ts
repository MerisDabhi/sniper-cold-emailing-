import { NextRequest } from "next/server";
import { db, publicAccount, save } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { campaignStats, daily } from "@/lib/stats";
import { accountSentLast24h, campaignSentToday, inWindow, perAccountQuota, rebalanceLeads } from "@/lib/engine";
import type { Campaign } from "@/lib/types";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  const d = db();
  const c = d.campaigns.find((x) => x.id === id);
  if (!c) return fail("Campaign not found", 404);
  const events = d.events.filter((e) => e.campaignId === id);
  const leads = d.leads.filter((l) => l.campaignId === id);
  const quota = perAccountQuota(c);
  return ok({
    campaign: c,
    stats: campaignStats(id),
    daily: daily(events),
    sentToday: campaignSentToday(c),
    inWindow: inWindow(c),
    perAccountQuota: quota,
    senders: d.accounts
      .filter((a) => c.accountIds.includes(a.id))
      .map((a) => ({
        ...publicAccount(a),
        leads: leads.filter((l) => l.accountId === a.id).length,
        sentToday: campaignSentToday(c, a.id),
        inboxSent24h: accountSentLast24h(a.id),
        quota,
      })),
    steps: c.steps.map((s, i) => ({
      id: s.id,
      sent: events.filter((e) => e.type === "sent" && e.step === i + 1).length,
    })),
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
];

export const PATCH = handle(async (req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  const c = db().campaigns.find((x) => x.id === id);
  if (!c) return fail("Campaign not found", 404);
  const body = await req.json();
  const accountsChanged = body.accountIds && JSON.stringify(body.accountIds) !== JSON.stringify(c.accountIds);
  for (const k of EDITABLE) if (k in body) (c as Record<string, unknown>)[k] = body[k];
  c.dailyLimit = Math.max(1, Math.min(10000, Number(c.dailyLimit) || 1));
  c.schedule.minGapSec = Math.max(20, Number(c.schedule.minGapSec) || 60);
  c.schedule.maxGapSec = Math.max(c.schedule.minGapSec, Number(c.schedule.maxGapSec) || 180);
  if (accountsChanged) rebalanceLeads(c);
  save();
  return ok({ campaign: c });
});

export const DELETE = handle(async (_req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  const d = db();
  d.campaigns = d.campaigns.filter((x) => x.id !== id);
  d.leads = d.leads.filter((l) => l.campaignId !== id);
  save();
  return ok();
});
