import { NextRequest } from "next/server";
import { db, id, save } from "@/lib/db";
import { handle, ok } from "@/lib/api";
import { campaignStats } from "@/lib/stats";
import { campaignSentToday } from "@/lib/engine";
import type { Campaign } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const d = db();
  return ok({
    campaigns: [...d.campaigns]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((c) => ({ ...c, stats: campaignStats(c.id), sentToday: campaignSentToday(c) })),
  });
});

export const POST = handle(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  const d = db();
  const c: Campaign = {
    id: id("c_"),
    name: String(body.name || "").trim() || "Untitled campaign",
    status: "draft",
    steps: [
      {
        id: id("s_"),
        delayDays: 0,
        subject: "{Quick question|Idea} for {{company|your team}}",
        body: "{Hi|Hey} {{first_name|there}},\n\nI came across {{company|your company}} and had a quick idea I think could help.\n\nWould you be open to a short chat this week?\n\nBest,\n{{sender_first_name}}",
      },
      {
        id: id("s_"),
        delayDays: 3,
        subject: "",
        body: "Hi {{first_name|there}}, just bumping this to the top of your inbox — any thoughts?",
      },
    ],
    schedule: {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      days: [1, 2, 3, 4, 5],
      startHour: 9,
      endHour: 18,
      minGapSec: 60,
      maxGapSec: 180,
    },
    dailyLimit: 50,
    accountIds: d.accounts.filter((a) => a.status === "active").map((a) => a.id),
    stopOnReply: true,
    trackOpens: false,
    unsubscribeFooter: true,
    unsubscribeText: "P.S. If this isn't relevant, just reply \"unsubscribe\" and I won't reach out again.",
    sheetStatus: true,
    sheetStatusColumn: "Outreach Status",
    createdAt: new Date().toISOString(),
  };
  d.campaigns.push(c);
  save();
  return ok({ campaign: c });
});
