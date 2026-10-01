"use client";

import { Eye, MailX, Moon, Reply, Send, Undo2, Users } from "lucide-react";
import { fmt, timeAgo } from "@/lib/client";
import { ActivityChart, Legend, Stat } from "../Charts";
import { ActivityFeed } from "../ActivityFeed";
import { Avatar, Badge, Card, CardHeader, Progress } from "../ui";
import type { Detail } from "./types";

export function AnalyticsTab({ d }: { d: Detail }) {
  const s = d.stats;
  const c = d.campaign;
  const maxStep = Math.max(1, ...d.steps.map((x) => x.sent));
  return (
    <div className="space-y-6">
      {c.status === "active" && !d.inWindow && (
        <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-[13px] text-muted">
          <Moon className="size-4 text-violet" /> Outside the sending window right now — sending resumes automatically during your scheduled hours ({c.schedule.timezone}).
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Sent" value={fmt(s.sent)} sub={`${d.sentToday}/${c.dailyLimit} today`} icon={<Send className="size-3.5" />} />
        <Stat label="Contacted" value={fmt(s.contacted)} sub={`of ${fmt(s.leads)} leads`} icon={<Users className="size-3.5" />} tone="violet" />
        <Stat label="Replies" value={fmt(s.replied)} sub={`${s.replyRate}%`} icon={<Reply className="size-3.5" />} tone="success" />
        <Stat label="Opens" value={fmt(s.opened)} sub={c.trackOpens ? `${s.openRate}%` : "tracking off"} icon={<Eye className="size-3.5" />} tone="violet" />
        <Stat label="Bounced" value={fmt(s.bounced)} sub={`${s.bounceRate}%`} icon={<Undo2 className="size-3.5" />} tone="danger" />
        <Stat label="Unsubscribed" value={fmt(s.unsubscribed)} sub={`${s.unsubRate}%`} icon={<MailX className="size-3.5" />} tone="warning" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader title="Daily activity" description="Last 14 days" action={<Legend />} />
          <div className="p-4">
            <ActivityChart data={d.daily} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Sequence steps" description="Emails sent per step" />
          <div className="space-y-4 p-5">
            {d.steps.map((st, i) => (
              <div key={st.id}>
                <div className="mb-1.5 flex justify-between text-[13px]">
                  <span className="font-medium">Step {i + 1}</span>
                  <span className="text-muted tabular-nums">{fmt(st.sent)}</span>
                </div>
                <Progress value={st.sent} max={maxStep} />
              </div>
            ))}
            <div className="grid grid-cols-3 gap-2 border-t border-border pt-4 text-center">
              {[
                ["Queued", s.pending],
                ["In sequence", s.inProgress],
                ["Finished", s.completed],
              ].map(([l, v]) => (
                <div key={l as string}>
                  <div className="text-lg font-semibold tabular-nums">{fmt(v as number)}</div>
                  <div className="text-[11px] text-faint">{l}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Inbox distribution" description={`Up to ${d.perAccountQuota} emails per inbox per day`} />
          <ul className="divide-y divide-border">
            {d.senders.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                <Avatar src={a.picture} name={a.name} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium">{a.email}</span>
                    {a.status !== "active" && <Badge tone={a.status === "error" ? "red" : "amber"}>{a.status}</Badge>}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Progress value={a.sentToday} max={Math.min(a.quota, a.dailyLimit)} tone="success" />
                    <span className="shrink-0 text-[11px] text-faint tabular-nums">
                      {a.sentToday}/{Math.min(a.quota, a.dailyLimit)} today
                    </span>
                  </div>
                </div>
                <div className="text-right text-xs text-faint">
                  <div className="tabular-nums">{fmt(a.leads)} leads</div>
                  {c.status === "active" && a.nextSendAt > Date.now() && <div>next {timeAgo(a.nextSendAt)}</div>}
                </div>
              </li>
            ))}
            {!d.senders.length && <li className="px-5 py-8 text-center text-sm text-faint">No inboxes selected.</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Activity" />
          <div className="max-h-[420px] overflow-y-auto">
            <ActivityFeed events={d.activity} />
          </div>
        </Card>
      </div>
    </div>
  );
}
