import { db } from "@/lib/db";
import { handle, ok } from "@/lib/api";
import { NextRequest } from "next/server";
import { ownerCanWriteSheets } from "@/lib/google";
import { OAUTH_CALLBACK_PATH, isLocalOrigin, publicUrl, refreshPublicUrl, requestOrigin } from "@/lib/url";
import { sheetSyncError } from "@/lib/sheetSync";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: NextRequest) => {
  const d = db();
  const o = d.owner;
  const origin = requestOrigin(req.headers, req.nextUrl.origin);
  await refreshPublicUrl();
  return ok({
    owner: o ? { email: o.email, name: o.name, picture: o.picture, connectedAt: o.connectedAt } : null,
    appUrl: origin,
    redirectUri: origin + OAUTH_CALLBACK_PATH,
    publicUrl: publicUrl(),
    isPublic: !isLocalOrigin(origin) || !!publicUrl(),
    sheetWrite: !!o && ownerCanWriteSheets(),
    sheetError: sheetSyncError(),
    unsubscribes: d.unsubscribes.slice(-200).reverse(),
  });
});
