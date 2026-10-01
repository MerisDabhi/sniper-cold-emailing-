"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, RefreshCw, RotateCcw, Search, Users } from "lucide-react";
import { api, timeAgo } from "@/lib/client";
import { Button, Card, Empty, Input, Spinner, StatusBadge, cn } from "../ui";

type LeadRow = {
  id: string;
  email: string;
  name: string;
  company: string;
  status: string;
  step: number;
  sender: string;
  lastSentAt?: number;
  nextAt?: number;
  repliedAt?: number;
  error?: string;
};

type Resp = { counts: Record<string, number>; total: number; page: number; pages: number; leads: LeadRow[] };

const FILTERS = ["all", "pending", "in_progress", "completed", "replied", "bounced", "unsubscribed", "duplicate", "failed"];

export function LeadsTab({ campaignId, totalSteps, launched, onSynced }: { campaignId: string; totalSteps: number; launched: boolean; onSynced: () => void }) {
  const [data, setData] = useState<Resp | null>(null);
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => {
    const p = new URLSearchParams({ status, q, page: String(page) });
    api<Resp>(`/api/campaigns/${campaignId}/leads?${p}`).then(setData);
  }, [campaignId, status, q, page]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function sync() {
    setSyncing(true);
    try {
      const { result } = await api<{ result: { added: number; invalid: number; duplicate: number; alreadyContacted: number } }>(`/api/campaigns/${campaignId}/action`, { body: { action: "sync" } });
      toast.success(`${result.added} new lead${result.added === 1 ? "" : "s"} imported`, {
        description:
          [result.alreadyContacted && `${result.alreadyContacted} already contacted before — won't be emailed`, result.invalid && `${result.invalid} rows with a missing/invalid email`]
            .filter(Boolean)
            .join(" · ") || undefined,
      });
      load();
      onSynced();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function retry() {
    const { retried } = await api<{ retried: number }>(`/api/campaigns/${campaignId}/action`, { body: { action: "retry_failed" } });
    toast.success(`${retried} lead${retried === 1 ? "" : "s"} queued again`);
    load();
  }

  if (!launched)
    return (
      <Card>
        <Empty icon={<Users className="size-5" />} title="Leads are imported on launch" description="Once you launch, every row with a valid email is imported from your sheet. New rows can be pulled in any time with “Sync sheet”." />
      </Card>
    );

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <Input placeholder="Search leads" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="pl-9" />
        </div>
        <div className="ml-auto flex gap-2">
          {!!data?.counts.failed && (
            <Button variant="secondary" size="sm" icon={<RotateCcw className="size-3.5" />} onClick={retry}>
              Retry failed
            </Button>
          )}
          <Button variant="secondary" size="sm" loading={syncing} icon={<RefreshCw className="size-3.5" />} onClick={sync}>
            Sync sheet
          </Button>
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => (setStatus(f), setPage(1))}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium capitalize transition",
              status === f ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-2 hover:text-text",
            )}
          >
            {f === "duplicate" ? "already contacted" : f.replace("_", " ")}
            <span className="text-xs text-faint tabular-nums">{data?.counts[f] || 0}</span>
          </button>
        ))}
      </div>
      {!data ? (
        <div className="grid h-40 place-items-center">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-xs text-faint">
                  <th className="px-5 py-2.5 font-medium">Lead</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Step</th>
                  <th className="px-3 py-2.5 font-medium">Sender</th>
                  <th className="px-3 py-2.5 font-medium">Last email</th>
                  <th className="px-3 py-2.5 font-medium">Next</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.leads.map((l) => (
                  <tr key={l.id} className="hover:bg-surface-2/40">
                    <td className="px-5 py-2.5">
                      <div className="font-medium">{l.email}</div>
                      <div className="text-xs text-faint">{[l.name, l.company].filter(Boolean).join(" · ") || "—"}</div>
                      {l.error && <div className="mt-0.5 line-clamp-1 text-xs text-danger">{l.error}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={l.status} />
                    </td>
                    <td className="px-3 py-2.5 text-muted tabular-nums">
                      {Math.min(l.step, totalSteps)}/{totalSteps}
                    </td>
                    <td className="max-w-[200px] truncate px-3 py-2.5 text-muted">{l.sender}</td>
                    <td className="px-3 py-2.5 text-muted">{l.repliedAt ? <span className="text-success">replied {timeAgo(l.repliedAt)}</span> : timeAgo(l.lastSentAt)}</td>
                    <td className="px-3 py-2.5 text-muted">{l.nextAt ? timeAgo(l.nextAt) : l.status === "pending" ? "queued" : "—"}</td>
                  </tr>
                ))}
                {!data.leads.length && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-faint">
                      No leads here.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {data.pages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-5 py-3 text-[13px] text-muted">
              <span>
                Page {data.page} of {data.pages} · {data.total} leads
              </span>
              <div className="flex gap-1">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} icon={<ChevronLeft className="size-4" />} />
                <Button variant="secondary" size="sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)} icon={<ChevronRight className="size-4" />} />
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
