"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Eye, Inbox, MailX, Plus, Reply, Send, Undo2, Users } from "lucide-react";
import { api, fmt, pollWhileVisible } from "@/lib/client";
import { ActivityChart, Legend, Stat } from "@/components/Charts";
import { ActivityFeed, type FeedEvent } from "@/components/ActivityFeed";
import { Avatar, Badge, Button, Card, CardHeader, Empty, PageHeader, Progress, Spinner } from "@/components/ui";

type Analytics = {
  totals: {
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
  sentToday: number;
  capacity: number;
  daily: { label: string; sent: number; replies: number; opens: number; bounces: number }[];
  campaigns: { active: number; total: number };
  accounts: { id: string; email: string; name: string; picture?: string; status: string; dailyLimit: number; sentToday: number; replies: number; error?: string }[];
  activity: FeedEvent[];
};

export default function Dashboard() {
  const [data, setData] = useState<Analytics | null>(null);

  useEffect(() => {
    const load = () => api<Analytics>("/api/analytics").then(setData).catch(() => {});
    load();
    return pollWhileVisible(load, 60_000);
  }, []);

  if (!data)
    return (
      <div className="grid h-[60vh] place-items-center">
        <Spinner />
      </div>
    );

  const t = data.totals;
  const noSetup = !data.accounts.length;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Analytics"
        description="Performance across every campaign and inbox."
        actions={
          <Link href="/campaigns?new=1">
            <Button icon={<Plus className="size-4" />}>New campaign</Button>
          </Link>
        }
      />

      {noSetup && (
        <Card className="mb-6 flex flex-wrap items-center gap-4 border-primary/25 bg-primary-soft/50 p-5">
          <div className="grid size-10 place-items-center rounded-xl bg-primary text-white">
            <Inbox className="size-5" />
          </div>
          <div className="flex-1">
            <div className="font-semibold">Connect your first Gmail inbox</div>
            <div className="text-sm text-muted">Add the Gmail accounts you want to send from — up to 25.</div>
          </div>
          <Link href="/accounts">
            <Button icon={<ArrowRight className="size-4" />}>Add inboxes</Button>
          </Link>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Emails sent" value={fmt(t.sent)} sub={`${fmt(data.sentToday)} in last 24h`} icon={<Send className="size-3.5" />} />
        <Stat label="Contacted" value={fmt(t.contacted)} sub={`of ${fmt(t.leads)} leads`} icon={<Users className="size-3.5" />} tone="violet" />
        <Stat label="Replies" value={fmt(t.replied)} sub={`${t.replyRate}% reply rate`} icon={<Reply className="size-3.5" />} tone="success" />
        <Stat label="Opens" value={fmt(t.opened)} sub={`${t.openRate}% open rate`} icon={<Eye className="size-3.5" />} tone="violet" />
        <Stat label="Bounced" value={fmt(t.bounced)} sub={`${t.bounceRate}% bounce rate`} icon={<Undo2 className="size-3.5" />} tone="danger" />
        <Stat label="Unsubscribed" value={fmt(t.unsubscribed)} sub={`${t.unsubRate}% of contacted`} icon={<MailX className="size-3.5" />} tone="warning" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title="Sending activity" description="Last 30 days" action={<Legend />} />
          <div className="p-4">
            <ActivityChart data={data.daily} height={290} />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Inbox health"
            description={`${fmt(data.sentToday)} / ${fmt(data.capacity)} daily capacity used`}
            action={
              <Link href="/accounts" className="text-xs font-medium text-primary hover:underline">
                Manage
              </Link>
            }
          />
          {data.accounts.length ? (
            <ul className="max-h-[310px] divide-y divide-border overflow-y-auto">
              {data.accounts.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar src={a.picture} name={a.name} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium">{a.email}</span>
                      {a.status !== "active" && <Badge tone={a.status === "error" ? "red" : "amber"}>{a.status}</Badge>}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Progress value={a.sentToday} max={a.dailyLimit} tone={a.sentToday >= a.dailyLimit ? "warning" : "primary"} />
                      <span className="shrink-0 text-[11px] text-faint tabular-nums">
                        {a.sentToday}/{a.dailyLimit}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-5 py-10 text-center text-sm text-faint">No inboxes connected.</div>
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
            description="Create a campaign, connect your sheet and write your sequence."
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
