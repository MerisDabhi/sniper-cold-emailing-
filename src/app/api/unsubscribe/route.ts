import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { addUnsubscribe } from "@/lib/engine";
import { fail, handle, ok } from "@/lib/api";

/** Public: recipients unsubscribe via /u/[token]; also supports RFC 8058 one-click POST. */
export const POST = handle(async (req: NextRequest) => {
  const tokenParam = req.nextUrl.searchParams.get("t");
  const body = tokenParam ? { token: tokenParam } : await req.json().catch(() => ({}));
  const lead = db().leads.find((l) => l.token === body.token);
  if (!lead) return fail("Link is invalid or expired", 404);
  await addUnsubscribe(lead.email, "link", lead);
  return ok();
});
