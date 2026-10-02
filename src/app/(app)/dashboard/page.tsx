"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Eye, Mail, MailX, Plus, Reply, Send, Undo2, Users } from "lucide-react";
import { api, fmt, pollWhileVisible } from "@/lib/client";
import { ActivityChart, Legend, Stat } from "@/components/Charts";
import { ActivityFeed, type FeedEvent } from "@/components/ActivityFeed";
import { ChannelIcon, WhatsAppGlyph, type ChannelKind } from "@/components/Channel";
import { Avatar, Badge, Button, Card, CardHeader, Empty, PageHeader, Progress, Segmented, Spinner, cn } from "@/components/ui";

type Totals = {
  leads: number;
  sent: number;
  contacted: number;
  replied: number;
  opened: number;
  bounced: number;
  unsubscribed: number;
  replyRate: number;
  openRate: number;
  bounceRate: number;
  unsubRate: number;
};

type Analytics = {
  totals: Totals;
  sentToday: number;
  capacity: number;
  daily: { label: string; sent: number; replies: number; opens: number; bounces: number }[];
  byChannel: (Totals & { channel: ChannelKind })[];
  campaigns: { active: number; total: number };
  accounts: { id: string; email: string; name: string; picture?: string; status: string; dailyLimit: number; sentToday: number; replies: number; channel: ChannelKind }[];
  hasEmailSenders: boolean;
  hasWhatsAppSenders: boolean;
  activity: FeedEvent[];
};

type Filter = "all" | ChannelKind;

export default function Dashboard() {
  const [channel, setChannel] = useState<Filter>("all");
  const [data, setData] = useState<Analytics | null>(null);

  const load = useCallback(() => {
    api<Analytics>(`/api/analytics?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}${channel === "all" ? "" : `&channel=${channel}`}`)
      .then(setData)
      .catch(() => {});
  }, [channel]);

  useEffect(() => {
    load();
    return pollWhileVisible(load, 60_000);
  }, [load]);

  if (!data)
    return (
      <div className="grid h-[60vh] place-items-center">
        <Spinner />
      </div>
    );

  const t = data.totals;
  const wa = channel === "whatsapp";
  const noSenders = !data.hasEmailSenders && !data.hasWhatsAppSenders;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Analytics"
        description="Performance across every campaign, inbox and number."
        actions={
          <>
            <Segmented
              value={channel}
              onChange={setChannel}
              options={[
                { value: "all", label: "All" },
                { value: "email", label: <><Mail className="size-3.5" /> Email</> },
                { value: "whatsapp", label: <><WhatsAppGlyph className="size-3.5" /> WhatsApp</> },
              ]}
            />
            <Link href={`/campaigns?new=1${channel === "whatsapp" ? "&channel=whatsapp" : ""}`}>
              <Button icon={<Plus className="size-4" />}>New campaign</Button>
            </Link>
          </>
        }
      />

      {noSenders && (
        <div className="mb-6 grid gap-3 md:grid-cols-2">
          <SetupCard channel="email" href="/accounts" title="Connect a Gmail inbox" text="Send cold email from your own Gmail accounts — up to 25." />
          <SetupCard channel="whatsapp" href="/whatsapp" title="Link a WhatsApp number" text="Scan a QR code, like WhatsApp Web, and send chat-style outreach." />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label={wa ? "Messages sent" : "Emails sent"} value={fmt(t.sent)} sub={`${fmt(data.sentToday)} in last 24h`} icon={<Send className="size-3.5" />} />
        <Stat label="Contacted" value={fmt(t.contacted)} sub={`of ${fmt(t.leads)} leads`} icon={<Users className="size-3.5" />} tone="violet" />
        <Stat label="Replies" value={fmt(t.replied)} sub={`${t.replyRate}% reply rate`} icon={<Reply className="size-3.5" />} tone="success" />
        {wa ? (
          <Stat label="In sequence" value={fmt(t.contacted - t.replied - t.bounced - t.unsubscribed)} sub="awaiting reply" icon={<Eye className="size-3.5" />} tone="violet" />
        ) : (
          <Stat label="Opens" value={fmt(t.opened)} sub={`${t.openRate}% open rate`} icon={<Eye className="size-3.5" />} tone="violet" />
        )}
        <Stat label={wa ? "Not on WhatsApp" : "Bounced"} value={fmt(t.bounced)} sub={`${t.bounceRate}% of contacted`} icon={<Undo2 className="size-3.5" />} tone="danger" />
        <Stat label="Unsubscribed" value={fmt(t.unsubscribed)} sub={`${t.unsubRate}% of contacted`} icon={<MailX className="size-3.5" />} tone="warning" />
      </div>

      {channel === "all" && <ChannelMix byChannel={data.byChannel} onPick={setChannel} />}

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title="Sending activity" description="Last 30 days" action={<Legend />} />
          <div className="p-4">
            <ActivityChart data={data.daily} height={290} />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Sender health"
            description={`${fmt(data.sentToday)} / ${fmt(data.capacity)} daily capacity used`}
            action={
              <Link href={wa ? "/whatsapp" : "/accounts"} className="text-xs font-medium text-primary hover:underline">
                Manage
              </Link>
            }
          />
          {data.accounts.length ? (
            <ul className="max-h-[310px] divide-y divide-border overflow-y-auto">
              {data.accounts.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                  {a.channel === "whatsapp" ? (
                    <ChannelIcon channel="whatsapp" size="sm" className="size-7 rounded-full" />
                  ) : (
                    <Avatar src={a.picture} name={a.name} size={28} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium">{a.email}</span>
                      {a.status !== "active" && <Badge tone={a.status === "error" ? "red" : "amber"}>{a.status === "error" ? "offline" : a.status}</Badge>}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Progress value={a.sentToday} max={a.dailyLimit} tone={a.sentToday >= a.dailyLimit ? "warning" : a.channel === "whatsapp" ? "success" : "primary"} />
                      <span className="shrink-0 text-[11px] text-faint tabular-nums">
                        {a.sentToday}/{a.dailyLimit}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-5 py-10 text-center text-sm text-faint">No senders connected.</div>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Recent activity" description="Refreshes every minute" />
        {data.campaigns.total ? (
          <ActivityFeed events={data.activity} />
        ) : (
          <Empty
            icon={<Send className="size-5" />}
            title="No campaigns yet"
            description="Create an email or WhatsApp campaign, connect your sheet and write your sequence."
            action={
              <Link href="/campaigns?new=1">
                <Button icon={<Plus className="size-4" />}>Create campaign</Button>
              </Link>
            }
          />
        )}
      </Card>
    </div>
  );
}

function SetupCard({ channel, href, title, text }: { channel: ChannelKind; href: string; title: string; text: string }) {
  return (
    <Link href={href}>
      <Card
        className={cn(
          "group flex items-center gap-4 p-5 transition hover:shadow-pop",
          channel === "whatsapp" ? "hover:border-wa/40" : "hover:border-primary/40",
        )}
      >
        <ChannelIcon channel={channel} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{title}</div>
          <div className="text-sm text-muted">{text}</div>
        </div>
        <ArrowRight className="size-4 text-faint transition group-hover:translate-x-0.5 group-hover:text-text" />
      </Card>
    </Link>
  );
}

/** Email vs WhatsApp side by side, with a bar showing how sending is split. */
function ChannelMix({ byChannel, onPick }: { byChannel: Analytics["byChannel"]; onPick: (c: ChannelKind) => void }) {
  const total = byChannel.reduce((n, c) => n + c.sent, 0);
  const email = byChannel.find((c) => c.channel === "email")!;
  const whatsapp = byChannel.find((c) => c.channel === "whatsapp")!;
  const emailPct = total ? (email.sent / total) * 100 : 50;
  return (
    <Card className="mt-6 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-semibold">Channel mix</h3>
          <p className="text-[13px] text-muted">How your outreach splits between email and WhatsApp</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-primary" /> Email
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-wa" /> WhatsApp
          </span>
        </div>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full bg-primary transition-all duration-700" style={{ width: `${total ? emailPct : 0}%` }} />
        <div className="h-full bg-wa transition-all duration-700" style={{ width: `${total ? 100 - emailPct : 0}%` }} />
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {[email, whatsapp].map((c) => (
          <button
            key={c.channel}
            onClick={() => onPick(c.channel)}
            className="flex items-center gap-4 rounded-xl border border-border p-4 text-left transition hover:border-border-strong hover:bg-surface-2/50"
          >
            <ChannelIcon channel={c.channel} size="lg" />
            <div className="grid flex-1 grid-cols-3 gap-2">
              {[
                ["Sent", fmt(c.sent)],
                ["Contacted", fmt(c.contacted)],
                ["Reply rate", `${c.replyRate}%`],
              ].map(([l, v]) => (
                <div key={l}>
                  <div className="text-lg font-semibold tabular-nums">{v}</div>
                  <div className="text-[11px] text-faint">{l}</div>
                </div>
              ))}
            </div>
            <ArrowRight className="size-4 text-faint" />
          </button>
        ))}
      </div>
    </Card>
  );
}
