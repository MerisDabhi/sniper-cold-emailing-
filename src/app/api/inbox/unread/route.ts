import { sb } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { isUnread } from "@/lib/labels";

export const dynamic = "force-dynamic";

/** How many conversations have a message you haven't opened yet (for the sidebar badge). */
export const GET = handle(async () => {
  const { data, error } = await sb().from("leads").select("last_reply_at, read_at").not("last_reply_at", "is", null).limit(10000);
  if (error) return fail(error.message, 500);
  return ok({ unread: (data || []).filter(isUnread).length });
});
