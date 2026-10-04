import { NextRequest } from "next/server";
import { db, sb } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { isLabel, isUnread } from "@/lib/labels";
import { formatPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 40;

/**
 * The inbox: everyone who replied, newest message first.
 * ?label= one label · ?unread=1 · ?channel=email|whatsapp · ?q= search · ?page=
 */
export const GET = handle(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const label = sp.get("label") || "";
  const unreadOnly = sp.get("unread") === "1";
  const channel = sp.get("channel");
  const q = (sp.get("q") || "").replace(/[,()*%\\:"']/g, " ").trim().slice(0, 80);
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const d = db();

  // Counts for the filter chips (and to find unread ones — "unread" compares two columns).
  const { data: all, error: countError } = await sb().from("leads").select("id, label, last_reply_at, read_at").not("replied_at", "is", null).limit(10000);
  if (countError) return fail(countError.message, 500);
  const counts: Record<string, number> = { all: 0, unread: 0 };
  const unreadIds: string[] = [];
  for (const l of all || []) {
    counts.all++;
    if (isUnread(l)) {
      counts.unread++;
      unreadIds.push(l.id);
    }
    const key = l.label || "replied";
    counts[key] = (counts[key] || 0) + 1;
  }

  let query = sb().from("leads").select("*", { count: "exact" }).not("replied_at", "is", null).order("last_reply_at", { ascending: false, nullsFirst: false });
  if (isLabel(label)) query = query.eq("label", label);
  if (unreadOnly) query = query.in("id", unreadIds.slice(0, 300));
  if (channel === "email" || channel === "whatsapp") {
    query = query.in("campaign_id", d.campaigns.filter((c) => c.channel === channel).map((c) => c.id));
  }
  if (q) {
    query = query.or(["email", "phone", "first_subject", "data->>first_name", "data->>last_name", "data->>company"].map((f) => `${f}.ilike.*${q}*`).join(","));
  }
  const { data: rows, count, error } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) return fail(error.message, 500);

  // Latest message from each lead, for the preview line.
  const ids = (rows || []).map((r) => r.id as string);
  const { data: replies } = ids.length
    ? await sb().from("events").select("lead_id, detail, at").eq("type", "reply").in("lead_id", ids).order("at", { ascending: false })
    : { data: [] as { lead_id: string; detail: string | null; at: number }[] };
  const lastReply = new Map<string, string>();
  for (const r of replies || []) if (!lastReply.has(r.lead_id)) lastReply.set(r.lead_id, r.detail || "");

  const campaigns = new Map(d.campaigns.map((c) => [c.id, c]));
  const senders = new Map<string, string>([
    ...d.accounts.map((a) => [a.id, a.email] as [string, string]),
    ...d.waAccounts.map((a) => [a.id, a.phone ? formatPhone(a.phone) : a.label || "WhatsApp"] as [string, string]),
  ]);
  const total = count ?? 0;
  return ok({
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    counts,
    conversations: (rows || []).map((l) => {
      const c = campaigns.get(l.campaign_id);
      return {
        id: l.id as string,
        contact: l.phone ? formatPhone(l.phone) : l.email || "",
        name: [l.data?.first_name, l.data?.last_name].filter(Boolean).join(" "),
        company: l.data?.company || "",
        channel: c?.channel || "email",
        campaign: c?.name || "",
        sender: senders.get(l.account_id) || "",
        subject: l.first_subject || "",
        status: l.status,
        label: l.label || "replied",
        labelManual: !!l.label_manual,
        unread: isUnread(l),
        lastReplyAt: l.last_reply_at || l.replied_at,
        preview: lastReply.get(l.id) || "",
      };
    }),
  });
});
