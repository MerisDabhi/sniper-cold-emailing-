import { db, publicAccount } from "@/lib/db";
import { handle, ok } from "@/lib/api";
import { accountSentLast24h } from "@/lib/engine";
import { bySender, loadRollup } from "@/lib/stats";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const d = db();
  const perSender = bySender(await loadRollup());
  return ok({
    accounts: d.accounts.map((a) => ({
      ...publicAccount(a),
      sentToday: accountSentLast24h(a.id),
      totalSent: perSender.get(a.id)?.sent || 0,
      replies: perSender.get(a.id)?.replied || 0,
      campaigns: d.campaigns.filter((c) => c.accountIds.includes(a.id)).length,
    })),
    max: 25,
  });
});
