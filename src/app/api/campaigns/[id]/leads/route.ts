import { NextRequest } from "next/server";
import { db, leadFromRow, sb } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { leadLabel } from "@/lib/engine";
import { formatPhone } from "@/lib/phone";
import { loadRollup } from "@/lib/stats";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const STATUSES = ["pending", "in_progress", "completed", "replied", "bounced", "unsubscribed", "failed", "duplicate"];
const PAGE_SIZE = 50;

/** One page of a campaign's leads, filtered and searched in the database. */
export const GET = handle(async (req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") || "all";
  // Strip characters that have meaning in PostgREST filter syntax.
  const q = (sp.get("q") || "").replace(/[,()*%\\:"']/g, " ").trim().slice(0, 80);
  const page = Math.max(1, Number(sp.get("page")) || 1);
  if (status !== "all" && !STATUSES.includes(status)) return fail("Unknown status");

  let query = sb()
    .from("leads")
    .select("*", { count: "exact" })
    .eq("campaign_id", id)
    .order("seq", { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status !== "all") query = query.eq("status", status);
  if (q) {
    const like = `*${q}*`;
    query = query.or(
      ["email", "phone", "data->>first_name", "data->>last_name", "data->>company"].map((f) => `${f}.ilike.${like}`).join(","),
    );
  }

  const [{ data, count, error }, rollup] = await Promise.all([query, loadRollup([id])]);
  if (error) return fail(error.message, 500);

  const counts: Record<string, number> = { all: 0 };
  for (const r of rollup) {
    counts.all += r.leads;
    counts.pending = (counts.pending || 0) + r.pending;
    counts.in_progress = (counts.in_progress || 0) + r.in_progress;
    counts.completed = (counts.completed || 0) + r.completed;
    counts.replied = (counts.replied || 0) + r.replied_status;
    counts.bounced = (counts.bounced || 0) + r.bounced;
    counts.unsubscribed = (counts.unsubscribed || 0) + r.unsubscribed;
    counts.failed = (counts.failed || 0) + r.failed;
    counts.duplicate = (counts.duplicate || 0) + r.duplicate;
  }

  const d = db();
  const senders = new Map<string, string>([
    ...d.accounts.map((a) => [a.id, a.email] as [string, string]),
    ...d.waAccounts.map((a) => [a.id, a.phone ? formatPhone(a.phone) : a.label || "WhatsApp"] as [string, string]),
  ]);
  const total = count ?? 0;
  return ok({
    counts,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    leads: (data || []).map((row) => {
      const l = leadFromRow(row);
      return {
        id: l.id,
        email: leadLabel(l),
        name: [l.data?.first_name, l.data?.last_name].filter(Boolean).join(" "),
        company: l.data?.company || "",
        status: l.status,
        step: l.stepIndex,
        sender: senders.get(l.accountId) || "—",
        lastSentAt: l.lastSentAt,
        nextAt: l.status === "in_progress" ? l.nextAt : undefined,
        repliedAt: l.repliedAt,
        openedAt: l.openedAt,
        error: l.error,
      };
    }),
  });
});
