import { NextRequest } from "next/server";
import { fetchLeads } from "@/lib/db";
import { addUnsubscribe } from "@/lib/engine";
import { fail, handle, ok } from "@/lib/api";
import { contactKey } from "@/lib/phone";

/** Public: recipients unsubscribe via /u/[token]; also supports RFC 8058 one-click POST. */
export const POST = handle(async (req: NextRequest) => {
  const tokenParam = req.nextUrl.searchParams.get("t");
  const body = tokenParam ? { token: tokenParam } : await req.json().catch(() => ({}));
  const tok = typeof body.token === "string" ? body.token.trim() : "";
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(tok)) return fail("Link is invalid or expired", 404);
  const [lead] = await fetchLeads((q) => q.eq("token", tok).limit(1));
  if (!lead) return fail("Link is invalid or expired", 404);
  await addUnsubscribe(contactKey(lead), "link", lead);
  return ok();
});
