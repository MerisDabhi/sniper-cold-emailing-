import { NextRequest } from "next/server";
import { db, id } from "@/lib/db";
import { handle, ok } from "@/lib/api";
import { loadRollup, summarize } from "@/lib/stats";
import { campaignSentToday } from "@/lib/engine";
import type { Campaign } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const d = db();
  const rollup = await loadRollup();
  return ok({
    campaigns: [...d.campaigns]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((c) => ({ ...c, stats: summarize(rollup.filter((r) => r.campaign_id === c.id)), sentToday: campaignSentToday(c) })),
  });
});

/** The browser's timezone when valid (the server may run in UTC), else the server's. */
function validTimezone(tz: unknown) {
  if (typeof tz === "string" && tz) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    } catch {}
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Sensible starting point for a new campaign on each channel. */
function defaults(channel: Campaign["channel"], tz: string): Omit<Campaign, "id" | "name" | "createdAt"> {
  const timezone = () => tz;
  const d = db();
  const common = {
    channel,
    status: "draft" as const,
    stopOnReply: true,
    trackOpens: false,
    unsubscribeFooter: true,
    sheetStatus: true,
    sheetStatusColumn: "Outreach Status",
    countryCode: "",
  };
  if (channel === "whatsapp") {
    return {
      ...common,
      steps: [
        {
          id: id("s_"),
          delayDays: 0,
          subject: "",
          body: "{Hi|Hey} {{first_name|there}} 👋\n\nThis is {{sender_first_name}}. I came across {{company|your business}} and had a quick idea that could help.\n\nWould you be open to a short chat?",
        },
        { id: id("s_"), delayDays: 2, subject: "", body: "Hi {{first_name|there}}, just following up on my message above — would love to hear your thoughts 🙂" },
      ],
      // Slower and smaller than email: WhatsApp is far stricter about unsolicited messages.
      schedule: { timezone: timezone(), days: [1, 2, 3, 4, 5], startHour: 10, endHour: 18, minGapSec: 180, maxGapSec: 480 },
      dailyLimit: 20,
      accountIds: d.waAccounts.filter((a) => a.status === "connected" && !a.paused).map((a) => a.id),
      unsubscribeText: "(Reply STOP if you'd prefer not to hear from me.)",
    };
  }
  return {
    ...common,
    steps: [
      {
        id: id("s_"),
        delayDays: 0,
        subject: "{Quick question|Idea} for {{company|your team}}",
        body: "{Hi|Hey} {{first_name|there}},\n\nI came across {{company|your company}} and had a quick idea I think could help.\n\nWould you be open to a short chat this week?\n\nBest,\n{{sender_first_name}}",
      },
      { id: id("s_"), delayDays: 3, subject: "", body: "Hi {{first_name|there}}, just bumping this to the top of your inbox — any thoughts?" },
    ],
    schedule: { timezone: timezone(), days: [1, 2, 3, 4, 5], startHour: 9, endHour: 18, minGapSec: 60, maxGapSec: 180 },
    dailyLimit: 50,
    accountIds: d.accounts.filter((a) => a.status === "active").map((a) => a.id),
    unsubscribeText: "P.S. If this isn't relevant, just reply \"unsubscribe\" and I won't reach out again.",
  };
}

export const POST = handle(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  const channel = body.channel === "whatsapp" ? "whatsapp" : "email";
  const c: Campaign = {
    id: id("c_"),
    name: String(body.name || "").trim().slice(0, 120) || "Untitled campaign",
    createdAt: new Date().toISOString(),
    ...defaults(channel, validTimezone(body.timezone)),
  };
  db().campaigns.push(c);
  return ok({ campaign: c });
});
