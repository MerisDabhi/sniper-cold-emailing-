import { NextRequest } from "next/server";
import { fail, handle, ok } from "@/lib/api";
import { db, sb } from "@/lib/db";
import { rebalanceLeads } from "@/lib/engine";
import { leaseAlive } from "@/lib/lease";
import { errorMessage } from "@/lib/google";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// These routes touch only the wa_accounts row, so they talk to Supabase directly (fast enough
// to poll every couple of seconds while a QR code is on screen).

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const { data, error } = await sb()
    .from("wa_accounts")
    .select("id, label, phone, name, status, paused, qr, error, daily_limit, connected_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return fail(error.message, 500);
  if (!data) return fail("Number not found", 404);
  return ok({ account: data, worker: await leaseAlive("whatsapp") });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const body = await req.json();
    const patch: Record<string, unknown> = {};
    if (typeof body.label === "string") patch.label = body.label.trim().slice(0, 60);
    if (body.dailyLimit !== undefined) patch.daily_limit = Math.max(1, Math.min(200, Number(body.dailyLimit) || 15));
    if (typeof body.paused === "boolean") patch.paused = body.paused;
    if (Object.keys(patch).length) {
      const { error } = await sb().from("wa_accounts").update(patch).eq("id", id);
      if (error) return fail(error.message, 500);
    }
    // Show a fresh QR code / reconnect — only for numbers that aren't already connected or showing a QR.
    if (body.reconnect) {
      const { error } = await sb()
        .from("wa_accounts")
        .update({ status: "pending", qr: null, error: null })
        .eq("id", id)
        .in("status", ["logged_out", "disconnected"]);
      if (error) return fail(error.message, 500);
    }
    return ok();
  } catch (err) {
    return fail(errorMessage(err), 500);
  }
}

/**
 * Remove a number. Normally the worker unlinks it from the phone first; if the worker is
 * offline (or `?force=1`), the number is deleted here — unlink it in WhatsApp → Linked devices.
 */
export const DELETE = handle(async (req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  // Take the number out of its campaigns; its not-yet-contacted leads move to the other numbers.
  const d = db();
  d.waAccounts = d.waAccounts.filter((a) => a.id !== id);
  for (const c of d.campaigns) {
    if (!c.accountIds.includes(id)) continue;
    c.accountIds = c.accountIds.filter((x) => x !== id);
    await rebalanceLeads(c);
  }
  const force = req.nextUrl.searchParams.get("force") === "1" || !(await leaseAlive("whatsapp")).online;
  const { error } = force
    ? await sb().from("wa_accounts").delete().eq("id", id)
    : await sb().from("wa_accounts").update({ status: "remove_requested" }).eq("id", id);
  if (error) return fail(error.message, 500);
  return ok({ removed: force ? "now" : "requested" });
});
