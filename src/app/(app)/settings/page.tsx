"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { AlertTriangle, CheckCircle2, Copy, FileSpreadsheet, LogOut, MailX, Monitor, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { api, timeAgo } from "@/lib/client";
import { displayContact } from "@/lib/phone";
import { ChannelBadge } from "@/components/Channel";
import { Avatar, Badge, Button, Card, CardHeader, Segmented } from "@/components/ui";

type Me = {
  owner: { email: string; name: string; picture?: string; connectedAt: string } | null;
  appUrl: string;
  redirectUri: string;
  publicUrl: string | null;
  isPublic: boolean;
  sheetWrite: boolean;
  sheetError: string | null;
  unsubscribes: { email: string; at: number; source: string }[];
};

export default function SettingsPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [me, setMe] = useState<Me | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    api<Me>("/api/me").then(setMe);
  }, []);

  const redirect = me?.redirectUri || "";

  return (
    <div className="animate-fade-up max-w-3xl space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">Workspace, appearance and compliance.</p>
      </div>

      <Card>
        <CardHeader title="Google Sheets connection" description="The Google account used to read your lead sheets and write their status." />
        <div className="flex flex-wrap items-center gap-4 p-5">
          <div className="relative">
            <Avatar src={me?.owner?.picture} name={me?.owner?.name || "?"} size={40} />
            <span className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full border-2 border-surface bg-success">
              <FileSpreadsheet className="size-2.5 text-white" />
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium">{me?.owner?.name}</div>
            <div className="text-sm text-muted">{me?.owner?.email}</div>
          </div>
          {me && !me.sheetWrite ? (
            <Badge tone="amber" dot>
              Read-only
            </Badge>
          ) : (
            <Badge tone="green" dot>
              Connected {me?.owner && timeAgo(me.owner.connectedAt)}
            </Badge>
          )}
          <a href="/api/auth/google/start?purpose=owner">
            <Button variant={me && !me.sheetWrite ? "primary" : "secondary"} size="sm">
              Reconnect
            </Button>
          </a>
        </div>
        {me && (!me.sheetWrite || me.sheetError) && (
          <div className="mx-5 mb-5 flex items-start gap-2.5 rounded-lg bg-warning-soft px-4 py-3 text-[13px] text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {!me.sheetWrite ? "Reconnect to give Sniper edit access, so it can write each lead's status back into your sheets." : me.sheetError}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Appearance" />
        <div className="flex items-center justify-between p-5">
          <span className="text-sm text-muted">Theme</span>
          {mounted && (
            <Segmented
              value={(theme as "light" | "dark" | "system") || "system"}
              onChange={setTheme}
              options={[
                { value: "light", label: <><Sun className="size-3.5" /> Light</> },
                { value: "dark", label: <><Moon className="size-3.5" /> Dark</> },
                { value: "system", label: <><Monitor className="size-3.5" /> System</> },
              ]}
            />
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Google Cloud setup" description="These must match your OAuth client in Google Cloud Console." />
        <div className="space-y-4 p-5 text-sm">
          <div>
            <div className="mb-1.5 text-[13px] font-medium">
              Authorized redirect URI <span className="font-normal text-faint">· for the domain you&apos;re on right now</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-[13px]">
              <span className="flex-1 truncate">{redirect}</span>
              <button
                onClick={() => (navigator.clipboard.writeText(redirect), toast.success("Copied"))}
                className="rounded p-1 text-muted hover:bg-surface hover:text-text"
              >
                <Copy className="size-3.5" />
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-faint">
              This follows whatever domain you open Sniper on — nothing to change when you connect your own domain. Add one line per domain you
              use under <b className="text-muted">Authorized redirect URIs</b> in Google Cloud (e.g. your domain and http://localhost:3000).
            </p>
          </div>
          <ul className="space-y-2 text-[13px] text-muted">
            {["Gmail API and Google Sheets API enabled", "Every sending inbox added as a Test user (while the app is in Testing mode)", "Publish the app to Production to stop tokens expiring every 7 days"].map((t) => (
              <li key={t} className="flex gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" /> {t}
              </li>
            ))}
          </ul>
          {!me?.isPublic && (
            <p className="rounded-lg bg-warning-soft px-3 py-2.5 text-[13px] text-warning">
              Running on localhost: open tracking and unsubscribe links are off. Reply-based unsubscribes still work. Open Sniper once on your
              own domain and they switch on automatically.
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Unsubscribed contacts" description="These people are never contacted again, in any campaign." action={<Badge>{me?.unsubscribes.length ?? 0}</Badge>} />
        {me?.unsubscribes.length ? (
          <ul className="max-h-72 divide-y divide-border overflow-y-auto">
            {me.unsubscribes.map((u) => (
              <li key={u.email} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                <MailX className="size-4 text-warning" />
                <span className="flex-1 truncate font-medium">{displayContact(u.email)}</span>
                {u.email.startsWith("wa:") && <ChannelBadge channel="whatsapp" />}
                <span className="text-faint">via {u.source}</span>
                <span className="w-16 text-right text-faint">{timeAgo(u.at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-5 py-8 text-center text-sm text-faint">No one has unsubscribed yet.</div>
        )}
      </Card>

      <Button
        variant="danger"
        icon={<LogOut className="size-4" />}
        onClick={async () => {
          await api("/api/auth/logout", { method: "POST" });
          router.replace("/login");
        }}
      >
        Sign out
      </Button>
    </div>
  );
}
