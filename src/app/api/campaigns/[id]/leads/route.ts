import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handle, ok } from "@/lib/api";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") || "all";
  const q = (sp.get("q") || "").toLowerCase();
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const size = 50;
  const d = db();
  const emails = new Map(d.accounts.map((a) => [a.id, a.email]));
  let leads = d.leads.filter((l) => l.campaignId === id);
  const counts: Record<string, number> = { all: leads.length };
  for (const l of leads) counts[l.status] = (counts[l.status] || 0) + 1;
  if (status !== "all") leads = leads.filter((l) => l.status === status);
  if (q) leads = leads.filter((l) => l.email.includes(q) || Object.values(l.data).some((v) => v.toLowerCase().includes(q)));
  return ok({
    counts,
    total: leads.length,
    page,
    pages: Math.max(1, Math.ceil(leads.length / size)),
    leads: leads.slice((page - 1) * size, page * size).map((l) => ({
      id: l.id,
      email: l.email,
      name: [l.data.first_name, l.data.last_name].filter(Boolean).join(" "),
      company: l.data.company || "",
      status: l.status,
      step: l.stepIndex,
      sender: emails.get(l.accountId) || "—",
      lastSentAt: l.lastSentAt,
      nextAt: l.status === "in_progress" ? l.nextAt : undefined,
      repliedAt: l.repliedAt,
      openedAt: l.openedAt,
      error: l.error,
    })),
  });
});
