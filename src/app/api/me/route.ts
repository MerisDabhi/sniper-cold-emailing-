import { db } from "@/lib/db";
import { handle, ok } from "@/lib/api";
import { APP_URL, ownerCanWriteSheets } from "@/lib/google";
import { sheetSyncError } from "@/lib/sheetSync";
import { IS_PUBLIC } from "@/lib/engine";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const d = db();
  const o = d.owner;
  return ok({
    owner: o ? { email: o.email, name: o.name, picture: o.picture, connectedAt: o.connectedAt } : null,
    appUrl: APP_URL,
    isPublic: IS_PUBLIC,
    sheetWrite: !!o && ownerCanWriteSheets(),
    sheetError: sheetSyncError(),
    unsubscribes: d.unsubscribes.slice(-200).reverse(),
  });
});
