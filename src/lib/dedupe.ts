import "server-only";
import { LEAD_COLUMNS, leadFromRow, sb } from "./db";
import type { Lead } from "./types";

/**
 * Duplicate-send protection, enforced by unique keys in Postgres (not by the in-memory cache):
 *
 *  - `sends (lead_id, step)`: a sequence step is claimed *before* Gmail is called, so the same
 *    step can never go to a lead twice — even after a crash, restart or a retry.
 *  - `contacts (email)`: the first cold email to an address claims it forever, so no other
 *    campaign or inbox can ever cold-email that person again.
 */

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

/** Returns false if this step was already sent (or is being sent) for this lead. */
export async function claimStep(lead: Lead, step: number, accountId: string): Promise<boolean> {
  const { data, error } = await sb()
    .from("sends")
    .upsert(
      { lead_id: lead.id, step, campaign_id: lead.campaignId, account_id: accountId, email: lead.email },
      { onConflict: "lead_id,step", ignoreDuplicates: true },
    )
    .select("lead_id");
  if (error) throw new Error(`Supabase claimStep: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** Undo a claim when Gmail rejected the email, so the step can be retried. */
export async function releaseStep(leadId: string, step: number) {
  const { error } = await sb().from("sends").delete().eq("lead_id", leadId).eq("step", step);
  if (error) console.error("[dedupe] releaseStep failed", error.message);
}

/**
 * A step was already claimed for this lead (by an earlier run, or a run happening right now).
 * Pull the lead's real state from the database instead of guessing:
 *  - "synced": the database already shows the step as sent → the lead was updated in place
 *  - "wait":   another run is sending it right now → leave it alone this round
 *  - "stale":  claimed >10 min ago but never recorded (crash right after sending) → skip the step
 */
export async function syncClaimedLead(lead: Lead, step: number): Promise<"synced" | "wait" | "stale"> {
  const [{ data: row, error }, { data: claim }] = await Promise.all([
    sb().from("leads").select(LEAD_COLUMNS).eq("id", lead.id).maybeSingle(),
    sb().from("sends").select("created_at").eq("lead_id", lead.id).eq("step", step).maybeSingle(),
  ]);
  if (error) throw new Error(`Supabase syncClaimedLead: ${error.message}`);
  const fresh = row ? leadFromRow(row as unknown as Record<string, unknown>) : null;
  if (fresh && fresh.stepIndex > step) {
    for (const k of Object.keys(lead) as (keyof Lead)[]) delete lead[k];
    Object.assign(lead, fresh);
    return "synced";
  }
  const claimedAt = claim?.created_at ? new Date(claim.created_at).getTime() : 0;
  return Date.now() - claimedAt > 10 * 60_000 ? "stale" : "wait";
}

export async function recordStepMessage(leadId: string, step: number, gmailMessageId: string) {
  await sb().from("sends").update({ gmail_message_id: gmailMessageId }).eq("lead_id", leadId).eq("step", step);
}

export type ContactClaim = { ok: true } | { ok: false; campaignId: string; leadId: string };

/** Claim the address for a first-touch cold email. Fails if anyone already cold-emailed it. */
export async function claimContact(lead: Lead, accountId: string): Promise<ContactClaim> {
  const email = normalizeEmail(lead.email);
  const { data, error } = await sb()
    .from("contacts")
    .upsert({ email, lead_id: lead.id, campaign_id: lead.campaignId, account_id: accountId }, { onConflict: "email", ignoreDuplicates: true })
    .select("email");
  if (error) throw new Error(`Supabase claimContact: ${error.message}`);
  if (data?.length) return { ok: true };

  const { data: existing, error: e2 } = await sb().from("contacts").select("lead_id, campaign_id").eq("email", email).maybeSingle();
  if (e2) throw new Error(`Supabase claimContact: ${e2.message}`);
  if (!existing || existing.lead_id === lead.id) return { ok: true }; // our own earlier claim
  return { ok: false, campaignId: existing.campaign_id, leadId: existing.lead_id };
}

export async function releaseContact(email: string, leadId: string) {
  const { error } = await sb().from("contacts").delete().eq("email", normalizeEmail(email)).eq("lead_id", leadId);
  if (error) console.error("[dedupe] releaseContact failed", error.message);
}

/** Which of these addresses have already received a cold email (from any campaign)? */
export async function alreadyContacted(emails: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>(); // email -> campaign_id
  const list = [...new Set(emails.map(normalizeEmail))];
  for (let i = 0; i < list.length; i += 200) {
    const { data, error } = await sb().from("contacts").select("email, campaign_id").in("email", list.slice(i, i + 200));
    if (error) throw new Error(`Supabase alreadyContacted: ${error.message}`);
    for (const r of data || []) out.set(r.email, r.campaign_id);
  }
  return out;
}
