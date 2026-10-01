"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Pause, Play, Plus, Search, Send, Trash2 } from "lucide-react";
import { api, fmt, timeAgo } from "@/lib/client";
import { Button, Card, Empty, Input, Label, Modal, PageHeader, Progress, Segmented, Spinner, StatusBadge } from "@/components/ui";

type Row = {
  id: string;
  name: string;
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
  const [creating, setCreating] = useState(sp.get("new") === "1");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Row | null>(null);

  const load = useCallback(() => api<{ campaigns: Row[] }>("/api/campaigns").then((d) => setRows(d.campaigns)), []);
  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    setBusy(true);
    try {
      const { campaign } = await api<{ campaign: { id: string } }>("/api/campaigns", { body: { name } });
      router.push(`/campaigns/${campaign.id}?tab=leads`);
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

  const list = (rows || []).filter((r) => (filter === "all" || r.status === filter) && r.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Campaigns"
        description="Personalized sequences sent from your Gmail inboxes."
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
                        <div className="font-medium">{r.name}</div>
                        <div className="mt-0.5 text-xs text-faint">
                          {r.sheet?.title || "No sheet yet"} · {r.accountIds.length} inbox{r.accountIds.length === 1 ? "" : "es"} · {timeAgo(r.createdAt)}
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
        <Label>Campaign name</Label>
        <Input autoFocus placeholder="e.g. Agencies – October outreach" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
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
