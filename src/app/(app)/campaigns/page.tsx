"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Check, Mail, Pause, Play, Plus, Search, Send, Trash2 } from "lucide-react";
import { api, fmt, timeAgo } from "@/lib/client";
import { Button, Card, Empty, Input, Label, Modal, PageHeader, Progress, Segmented, Spinner, StatusBadge, cn } from "@/components/ui";
import { ChannelIcon, WhatsAppGlyph, type ChannelKind } from "@/components/Channel";

type Row = {
  id: string;
  name: string;
  channel: ChannelKind;
  status: string;
  createdAt: string;
  dailyLimit: number;
  accountIds: string[];
  sentToday: number;
  sheet?: { title: string };
  stats: { leads: number; sent: number; contacted: number; replied: number; replyRate: number; bounced: number; unsubscribed: number; completed: number; pending: number; inProgress: number };
};

function CampaignsInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "draft" | "paused" | "completed">("all");
  const [q, setQ] = useState("");
  const [channelFilter, setChannelFilter] = useState<"all" | ChannelKind>("all");
  const [creating, setCreating] = useState(sp.get("new") === "1");
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<ChannelKind>(sp.get("channel") === "whatsapp" ? "whatsapp" : "email");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Row | null>(null);

  const load = useCallback(() => api<{ campaigns: Row[] }>("/api/campaigns").then((d) => setRows(d.campaigns)), []);
  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    setBusy(true);
    try {
      const { campaign } = await api<{ campaign: { id: string } }>("/api/campaigns", { body: { name, channel, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
      router.push(`/campaigns/${campaign.id}?tab=sheet`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  async function toggle(r: Row) {
    try {
      await api(`/api/campaigns/${r.id}/action`, { body: { action: r.status === "active" ? "pause" : "resume" } });
      toast.success(r.status === "active" ? "Campaign paused" : "Campaign resumed");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const list = (rows || []).filter(
    (r) =>
      (filter === "all" || r.status === filter) &&
      (channelFilter === "all" || r.channel === channelFilter) &&
      r.name.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Campaigns"
        description="Personalized email and WhatsApp sequences, sent at a human pace."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New campaign
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <Input placeholder="Search campaigns" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <Segmented
          value={channelFilter}
          onChange={setChannelFilter}
          options={[
            { value: "all", label: "All channels" },
            { value: "email", label: <><Mail className="size-3.5" /> Email</> },
            { value: "whatsapp", label: <><WhatsAppGlyph className="size-3.5" /> WhatsApp</> },
          ]}
        />
        <div className="max-w-full overflow-x-auto">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "active", label: "Active" },
            { value: "draft", label: "Drafts" },
            { value: "paused", label: "Paused" },
            { value: "completed", label: "Completed" },
          ]}
        />
        </div>
      </div>

      <Card>
        {!rows ? (
          <div className="grid h-48 place-items-center">
            <Spinner />
          </div>
        ) : !rows.length ? (
          <Empty
            icon={<Send className="size-5" />}
            title="Create your first campaign"
            description="Pick a Google Sheet, map columns, write your sequence and launch."
            action={
              <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                New campaign
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-faint">
                  <th className="px-5 py-2.5 font-medium">Campaign</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="w-48 px-3 py-2.5 font-medium">Progress</th>
                  <th className="px-3 py-2.5 text-right font-medium">Sent</th>
                  <th className="px-3 py-2.5 text-right font-medium">Replies</th>
                  <th className="px-3 py-2.5 text-right font-medium">Bounced</th>
                  <th className="px-3 py-2.5 text-right font-medium">Today</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map((r) => {
                  const done = r.stats.leads - r.stats.pending - r.stats.inProgress;
                  return (
                    <tr key={r.id} className="cursor-pointer hover:bg-surface-2/50" onClick={() => router.push(`/campaigns/${r.id}`)}>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <ChannelIcon channel={r.channel} />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{r.name}</div>
                            <div className="mt-0.5 truncate text-xs text-faint">
                              {r.sheet?.title || "No sheet yet"} · {r.accountIds.length}{" "}
                              {r.channel === "whatsapp" ? `number${r.accountIds.length === 1 ? "" : "s"}` : `inbox${r.accountIds.length === 1 ? "" : "es"}`} ·{" "}
                              {timeAgo(r.createdAt)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3.5">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-2">
                          <Progress value={done} max={r.stats.leads} tone="success" />
                          <span className="w-16 shrink-0 text-right text-xs text-muted tabular-nums">
                            {fmt(r.stats.contacted)}/{fmt(r.stats.leads)}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3.5 text-right tabular-nums">{fmt(r.stats.sent)}</td>
                      <td className="px-3 py-3.5 text-right tabular-nums">
                        {fmt(r.stats.replied)} <span className="text-xs text-faint">({r.stats.replyRate}%)</span>
                      </td>
                      <td className="px-3 py-3.5 text-right tabular-nums">{fmt(r.stats.bounced)}</td>
                      <td className="px-3 py-3.5 text-right text-muted tabular-nums">
                        {r.sentToday}/{r.dailyLimit}
                      </td>
                      <td className="px-3 py-3.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          {(r.status === "active" || r.status === "paused") && (
                            <button title={r.status === "active" ? "Pause" : "Resume"} onClick={() => toggle(r)} className="rounded-md p-1.5 text-faint hover:bg-surface-2 hover:text-text">
                              {r.status === "active" ? <Pause className="size-4" /> : <Play className="size-4" />}
                            </button>
                          )}
                          <button title="Delete" onClick={() => setDeleting(r)} className="rounded-md p-1.5 text-faint hover:bg-danger-soft hover:text-danger">
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!list.length && (
                  <tr>
                    <td colSpan={8} className="px-5 py-10 text-center text-sm text-faint">
                      No campaigns match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New campaign"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button loading={busy} onClick={create}>
              Continue
            </Button>
          </>
        }
      >
        <Label>Channel</Label>
        <div className="mb-5 grid grid-cols-2 gap-3">
          {(
            [
              { id: "email", title: "Email", text: "Gmail inboxes · subject lines, threads, open tracking" },
              { id: "whatsapp", title: "WhatsApp", text: "Linked numbers · typing indicator, chat-style follow-ups" },
            ] as const
          ).map((o) => {
            const on = channel === o.id;
            return (
              <button
                key={o.id}
                onClick={() => setChannel(o.id)}
                className={cn(
                  "relative rounded-xl border p-4 text-left transition",
                  on
                    ? o.id === "whatsapp"
                      ? "border-wa bg-wa-soft/50 ring-3 ring-wa/15"
                      : "border-primary bg-primary-soft/50 ring-3 ring-primary/15"
                    : "border-border hover:border-border-strong",
                )}
              >
                {on && (
                  <span className={cn("absolute top-3 right-3 grid size-5 place-items-center rounded-full text-white", o.id === "whatsapp" ? "bg-wa" : "bg-primary")}>
                    <Check className="size-3" />
                  </span>
                )}
                <ChannelIcon channel={o.id} size="lg" />
                <div className="mt-3 font-semibold">{o.title}</div>
                <div className="mt-0.5 text-xs leading-relaxed text-muted">{o.text}</div>
              </button>
            );
          })}
        </div>
        <Label>Campaign name</Label>
        <Input
          placeholder={channel === "whatsapp" ? "e.g. Restaurants – WhatsApp intro" : "e.g. Agencies – October outreach"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete campaign?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await api(`/api/campaigns/${deleting!.id}`, { method: "DELETE" });
                toast.success("Campaign deleted");
                setDeleting(null);
                load();
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          <b className="text-text">{deleting?.name}</b> and its lead progress will be removed. Your Google Sheet is not touched.
        </p>
      </Modal>
    </div>
  );
}

export default function CampaignsPage() {
  return (
    <Suspense>
      <CampaignsInner />
    </Suspense>
  );
}
