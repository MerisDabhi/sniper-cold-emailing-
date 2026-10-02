import { NextRequest } from "next/server";
import { db, publicAccount, save } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { rebalanceLeads } from "@/lib/engine";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  const a = db().accounts.find((x) => x.id === id);
  if (!a) return fail("Inbox not found", 404);
  const body = await req.json();
  if (typeof body.name === "string" && body.name.trim()) a.name = body.name.trim();
  if (typeof body.signature === "string") a.signature = body.signature;
  if (body.dailyLimit !== undefined) a.dailyLimit = Math.max(1, Math.min(500, Number(body.dailyLimit) || 30));
  if (body.status === "paused" || body.status === "active") {
    a.status = body.status;
    if (body.status === "active") a.error = undefined;
  }
  save();
  return ok({ account: publicAccount(a) });
});

export const DELETE = handle(async (_req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  const d = db();
  const idx = d.accounts.findIndex((x) => x.id === id);
  if (idx === -1) return fail("Inbox not found", 404);
  d.accounts.splice(idx, 1);
  for (const c of d.campaigns) {
    if (!c.accountIds.includes(id)) continue;
    c.accountIds = c.accountIds.filter((x) => x !== id);
    await rebalanceLeads(c);
  }
  save();
  return ok();
});
