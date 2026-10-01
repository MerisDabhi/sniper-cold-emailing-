import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { sb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // First run: connect the Google account that owns the lead sheets.
  const { data, error } = await sb().from("owner").select("email").maybeSingle();
  if (!error && !data) redirect("/welcome");
  return <Shell>{children}</Shell>;
}
