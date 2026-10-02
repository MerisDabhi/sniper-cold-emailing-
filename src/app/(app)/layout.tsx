import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { headers } from "next/headers";
import { sb } from "@/lib/db";
import { rememberPublicUrl, requestOrigin } from "@/lib/url";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // First run: connect the Google account that owns the lead sheets.
  const { data, error } = await sb().from("owner").select("email").maybeSingle();
  if (!error && !data) redirect("/welcome");
  // Remember the public domain so background senders can put it in unsubscribe links.
  await rememberPublicUrl(requestOrigin(await headers())).catch(() => {});
  return <Shell>{children}</Shell>;
}
