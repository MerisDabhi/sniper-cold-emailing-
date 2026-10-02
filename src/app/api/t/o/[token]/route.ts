import { NextRequest } from "next/server";
import { id, sb } from "@/lib/db";

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/** 1×1 open-tracking pixel (only embedded when the app runs on a public URL). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    // Record only the first open, straight in the database — no need to load everything for a pixel.
    const now = Date.now();
    const { data } = await sb()
      .from("leads")
      .update({ opened_at: now })
      .eq("token", token)
      .is("opened_at", null)
      .select("id, campaign_id, account_id, email");
    const lead = data?.[0];
    if (lead) {
      await sb()
        .from("events")
        .insert({ id: id("e_"), type: "open", at: now, campaign_id: lead.campaign_id, account_id: lead.account_id, lead_id: lead.id, email: lead.email });
    }
  } catch (err) {
    console.error("[open-pixel]", err);
  }
  return new Response(GIF, {
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate, private" },
  });
}
