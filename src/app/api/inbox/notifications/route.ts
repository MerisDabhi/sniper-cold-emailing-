import { NextRequest } from "next/server";
import { db, fetchEvents, fetchLeads } from "@/lib/db";
import { handle, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

/** New replies since ?since (ms) — polled by the phone to show notifications. */
export const GET = handle(async (req: NextRequest) => {
  const since = Math.max(0, Number(req.nextUrl.searchParams.get("since")) || Date.now() - 86_400_000);
  const events = await fetchEvents((q) => q.eq("type", "reply").gt("at", since).order("at", { ascending: false }).limit(50));
  const leads = events.length ? await fetchLeads((q) => q.in("id", events.map((e) => e.leadId).filter(Boolean) as string[])) : [];
  const byId = new Map(leads.map((l) => [l.id, l]));
  const campaigns = new Map(db().campaigns.map((c) => [c.id, c]));
  return ok({
    now: Date.now(),
    replies: events.map((e) => {
      const lead = e.leadId ? byId.get(e.leadId) : undefined;
      const c = e.campaignId ? campaigns.get(e.campaignId) : undefined;
      return {
        id: e.id,
        at: e.at,
        leadId: e.leadId,
        contact: e.email,
        name: lead ? [lead.data?.first_name, lead.data?.last_name].filter(Boolean).join(" ") : "",
        company: lead?.data?.company || "",
        channel: c?.channel || "email",
        campaign: c?.name || "",
        text: e.detail || "",
      };
    }),
  });
});
