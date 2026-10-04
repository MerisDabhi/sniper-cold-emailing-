import { NextRequest } from "next/server";
import { db, fetchLeads, id as newId, pushEvent, sb } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { leadLabel } from "@/lib/engine";
import { sendGmail } from "@/lib/google";
import { readThread } from "@/lib/mailbox";
import { textToHtml } from "@/lib/template";
import { leaseAlive } from "@/lib/lease";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Ctx = { params: Promise<{ leadId: string }> };

/**
 * Reply to a lead from the inbox: sent from the same inbox, in the same Gmail thread
 * (or from the same WhatsApp number). Replying by hand ends the automatic sequence for them.
 */
export const POST = handle(async (req: NextRequest, { params }: Ctx) => {
  const { leadId } = await params;
  const body = await req.json().catch(() => ({}));
  const text = String(body.text || "").trim();
  if (!text) return fail("Write a message first");
  if (text.length > 10_000) return fail("That message is too long");

  const [lead] = await fetchLeads((q) => q.eq("id", leadId).limit(1));
  if (!lead) return fail("Conversation not found", 404);
  const d = db();
  const c = d.campaigns.find((x) => x.id === lead.campaignId);

  if (c?.channel === "whatsapp") {
    const wa = d.waAccounts.find((a) => a.id === lead.accountId);
    if (!wa || wa.status !== "connected") return fail("This WhatsApp number isn't connected right now");
    if (!(await leaseAlive("whatsapp")).online) return fail("The WhatsApp worker is offline, so nothing can be sent right now.");
    const cmdId = newId("cmd_");
    const { error } = await sb()
      .from("wa_commands")
      .insert({ id: cmdId, account_id: wa.id, type: "test", payload: { to: `+${lead.phone}`, text } });
    if (error) return fail(error.message, 500);
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const { data: cmd } = await sb().from("wa_commands").select("status, result").eq("id", cmdId).single();
      if (cmd?.status === "failed") return fail(cmd.result || "Sending failed");
      if (cmd?.status === "done") break;
    }
    // WhatsApp history isn't readable later, so keep what you wrote for the conversation view.
    pushEvent({ type: "manual", campaignId: lead.campaignId, accountId: wa.id, leadId: lead.id, email: leadLabel(lead), detail: text.slice(0, 4000) });
  } else {
    const account = d.accounts.find((a) => a.id === lead.accountId);
    if (!account) return fail("The inbox that emailed this lead is no longer connected");
    if (!lead.email) return fail("This lead has no email address");
    const thread = lead.threadId ? await readThread(account, lead.threadId) : [];
    const last = thread[thread.length - 1];
    const baseSubject = (lead.firstSubject || thread[0]?.subject || "").replace(/^(re:\s*)+/i, "");
    let full = text;
    if (account.signature.trim()) full += `\n\n${account.signature.trim()}`;
    await sendGmail(account, {
      fromName: account.name,
      fromEmail: account.email,
      to: lead.email,
      subject: baseSubject ? `Re: ${baseSubject}` : "Re:",
      text: full,
      html: textToHtml(full),
      threadId: lead.threadId,
      inReplyTo: last?.messageIdHeader,
    });
  }

  // You're talking to them yourself now — stop automatic follow-ups.
  if (lead.status === "pending" || lead.status === "in_progress") lead.status = "completed";
  await sb().from("leads").update({ read_at: Date.now() }).eq("id", lead.id);
  return ok({ sent: true });
});
