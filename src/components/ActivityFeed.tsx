"use client";

import { AlertTriangle, CopyX, Eye, MailX, Reply, Send, Undo2 } from "lucide-react";
import { timeAgo } from "@/lib/client";
import { cn } from "./ui";
import { WhatsAppGlyph, type ChannelKind } from "./Channel";

export type FeedEvent = {
  id: string;
  type: "sent" | "reply" | "open" | "bounce" | "unsubscribe" | "error" | "duplicate";
  at: number;
  email?: string;
  step?: number;
  detail?: string;
  campaign?: string;
  sender?: string;
  channel?: ChannelKind;
};

const META: Record<FeedEvent["type"], { icon: typeof Send; cls: string; verb: (wa: boolean) => string }> = {
  sent: { icon: Send, cls: "bg-primary-soft text-primary", verb: (wa) => (wa ? "Message sent to" : "Email sent to") },
  reply: { icon: Reply, cls: "bg-success-soft text-success", verb: () => "Reply from" },
  open: { icon: Eye, cls: "bg-violet/10 text-violet", verb: () => "Opened by" },
  bounce: { icon: Undo2, cls: "bg-danger-soft text-danger", verb: (wa) => (wa ? "Not on WhatsApp:" : "Bounced:") },
  unsubscribe: { icon: MailX, cls: "bg-warning-soft text-warning", verb: () => "Unsubscribed:" },
  error: { icon: AlertTriangle, cls: "bg-danger-soft text-danger", verb: () => "Failed to send to" },
  duplicate: { icon: CopyX, cls: "bg-violet/10 text-violet", verb: () => "Skipped (already contacted):" },
};

export function ActivityFeed({ events }: { events: FeedEvent[] }) {
  if (!events.length) return <div className="px-5 py-10 text-center text-sm text-faint">No activity yet. Launch a campaign to see it here.</div>;
  return (
    <ul className="divide-y divide-border">
      {events.map((e) => {
        const m = META[e.type] || META.error;
        const Icon = m.icon;
        const wa = e.channel === "whatsapp" || (e.email || "").startsWith("+");
        return (
          <li key={e.id} className="flex gap-3 px-5 py-3">
            <span className={cn("relative mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg", e.type === "sent" && wa ? "bg-wa-soft text-wa" : m.cls)}>
              <Icon className="size-3.5" />
              {wa && (
                <span className="absolute -right-1 -bottom-1 grid size-3.5 place-items-center rounded-full bg-wa text-white ring-2 ring-surface">
                  <WhatsAppGlyph className="size-2.5" />
                </span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px]">
                <span className="text-muted">{m.verb(wa)} </span>
                <span className="font-medium">{e.email}</span>
                {e.type === "sent" && e.step ? <span className="text-faint"> · step {e.step}</span> : null}
              </div>
              <div className="mt-0.5 truncate text-xs text-faint">
                {[e.campaign, e.sender && `via ${e.sender}`, e.type !== "sent" ? e.detail : null].filter(Boolean).join(" · ")}
              </div>
            </div>
            <span className="shrink-0 text-xs text-faint">{timeAgo(e.at)}</span>
          </li>
        );
      })}
    </ul>
  );
}
