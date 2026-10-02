import { NextRequest } from "next/server";
import { db, id, sb } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { accountSentLast24h } from "@/lib/engine";
import { leaseAlive } from "@/lib/lease";
import { bySender, loadRollup } from "@/lib/stats";

export const dynamic = "force-dynamic";
const MAX_NUMBERS = 25;

/** Linked WhatsApp numbers with today's usage, plus whether the WhatsApp worker is online. */
export const GET = handle(async () => {
  const d = db();
  const [worker, rollup] = await Promise.all([leaseAlive("whatsapp"), loadRollup()]);
  const perSender = bySender(rollup);
  return ok({
    worker,
    max: MAX_NUMBERS,
    accounts: d.waAccounts.map((a) => {
      const { qr, ...rest } = a;
      void qr;
      return {
        ...rest,
        sentToday: accountSentLast24h(a.id),
        totalSent: perSender.get(a.id)?.sent || 0,
        replies: perSender.get(a.id)?.replied || 0,
        campaigns: d.campaigns.filter((c) => c.accountIds.includes(a.id)).length,
      };
    }),
  });
});

/** Start linking a new number: the worker picks it up and publishes a QR code. */
export const POST = handle(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  if (db().waAccounts.length >= MAX_NUMBERS) return fail(`You can link up to ${MAX_NUMBERS} WhatsApp numbers`);
  const row = { id: id("w_"), label: String(body.label || "").trim().slice(0, 60), status: "pending", daily_limit: 15 };
  const { error } = await sb().from("wa_accounts").insert(row);
  if (error) return fail(error.message, 500);
  return ok({ id: row.id });
});
