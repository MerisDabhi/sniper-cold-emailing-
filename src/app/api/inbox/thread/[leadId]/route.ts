import { NextRequest } from "next/server";
import { db, fetchEvents, sb } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { errorMessage } from "@/lib/google";
import { isLabel, isUnread } from "@/lib/labels";
import { readThread, type ThreadMessage } from "@/lib/mailbox";
import { formatPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ leadId: string }> };

/** A whole conversation with one lead: the Gmail thread (email) or the sent/received messages (WhatsApp). */
export const GET = handle(async (req: NextRequest, { params }: Ctx) => {
  const { leadId } = await params;
  const { data: lead, error } = await sb().from("leads").select("*").eq("id", leadId).maybeSingle();
  if (error) return fail(error.message, 500);
  if (!lead) return fail("Conversation not found", 404);
  const d = db();
  const c = d.campaigns.find((x) => x.id === lead.campaign_id);
  const channel = c?.channel || "email";
  const contact = lead.phone ? formatPhone(lead.phone) : lead.email || "";

  let messages: ThreadMessage[] = [];
  let sender = "";
  let warning: string | undefined;

  if (channel === "email") {
    const account = d.accounts.find((a) => a.id === lead.account_id);
    sender = account?.email || "";
    if (account && lead.thread_id) {
      try {
        messages = await readThread(account, lead.thread_id);
      } catch (err) {
        warning = `Couldn't load the Gmail thread: ${errorMessage(err)}`;
      }
    }
  } else {
    // WhatsApp history isn't stored by WhatsApp Web linking — show what Sniper sent and received.
    const wa = d.waAccounts.find((a) => a.id === lead.account_id);
    sender = wa?.phone ? formatPhone(wa.phone) : wa?.label || "";
    const events = await fetchEvents((q) => q.eq("lead_id", lead.id).in("type", ["sent", "reply", "manual"]).order("at", { ascending: true }));
    messages = events.map((e) => ({
      id: e.id,
      fromMe: e.type !== "reply",
      from: e.type !== "reply" ? sender : contact,
      to: e.type !== "reply" ? contact : sender,
      subject: "",
      date: e.at,
      text: e.detail || "",
    }));
  }

  // Opening a conversation marks it as read (the live refresh passes ?peek=1 and leaves it alone).
  if (isUnread(lead) && req.nextUrl.searchParams.get("peek") !== "1") {
    await sb().from("leads").update({ read_at: Date.now() }).eq("id", lead.id);
  }

  return ok({
    lead: {
      id: lead.id,
      contact,
      name: [lead.data?.first_name, lead.data?.last_name].filter(Boolean).join(" "),
      company: lead.data?.company || "",
      status: lead.status,
      repliedAt: lead.replied_at,
      label: lead.label || "replied",
      labelManual: !!lead.label_manual,
      data: lead.data || {},
    },
    channel,
    campaign: c?.name || "",
    campaignId: lead.campaign_id,
    sender,
    subject: lead.first_subject || "",
    messages,
    warning,
  });
});

/** Change the label by hand ({ label }, or "" to hand it back to automatic), or mark read/unread ({ read }). */
export const PATCH = handle(async (req: NextRequest, { params }: Ctx) => {
  const { leadId } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if ("label" in body) {
    if (body.label && !isLabel(body.label)) return fail("Unknown label");
    if (body.label) Object.assign(patch, { label: body.label, label_manual: true });
    else patch.label_manual = false;
  }
  if ("read" in body) patch.read_at = body.read === false ? 0 : Date.now();
  if (!Object.keys(patch).length) return fail("Nothing to change");
  const { error } = await sb().from("leads").update(patch).eq("id", leadId);
  if (error) return fail(error.message, 500);
  return ok();
});
