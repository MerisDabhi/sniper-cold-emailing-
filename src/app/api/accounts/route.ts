import { db, publicAccount } from "@/lib/db";
import { handle, ok } from "@/lib/api";
import { accountSentLast24h } from "@/lib/engine";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const d = db();
  return ok({
    accounts: d.accounts.map((a) => ({
      ...publicAccount(a),
      sentToday: accountSentLast24h(a.id),
      totalSent: d.leads.reduce((n, l) => (l.accountId === a.id ? n + l.stepIndex : n), 0),
      replies: d.leads.filter((l) => l.accountId === a.id && l.repliedAt).length,
      campaigns: d.campaigns.filter((c) => c.accountIds.includes(a.id)).length,
    })),
    max: 25,
  });
});
