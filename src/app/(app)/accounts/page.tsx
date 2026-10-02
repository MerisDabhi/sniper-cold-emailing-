"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Inbox, Info, MoreHorizontal, Pause, Pencil, Play, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { api, fmt, timeAgo } from "@/lib/client";
import { Avatar, Badge, Button, Card, Empty, Input, Label, Modal, PageHeader, Progress, Spinner, Textarea } from "@/components/ui";

type Account = {
  id: string;
  email: string;
  name: string;
  picture?: string;
  status: "active" | "paused" | "error";
  error?: string;
  dailyLimit: number;
  signature: string;
  sentToday: number;
  totalSent: number;
  replies: number;
  campaigns: number;
  connectedAt: string;
};

function AccountsInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [max, setMax] = useState(25);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Account | null>(null);
  const [removing, setRemoving] = useState<Account | null>(null);
  const [menu, setMenu] = useState<string | null>(null);

  const load = useCallback(() => api<{ accounts: Account[]; max: number }>("/api/accounts").then((d) => (setAccounts(d.accounts), setMax(d.max))), []);

  useEffect(() => {
    load();
    const connected = sp.get("connected");
    const error = sp.get("error");
    if (connected) toast.success(`${connected} connected`);
    if (error) toast.error(error);
    if (connected || error) router.replace("/accounts");
  }, [load, sp, router]);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  async function patch(a: Account, body: Partial<Account>) {
    try {
      await api(`/api/accounts/${a.id}`, { method: "PATCH", body });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const connect = (hint?: string) => (window.location.href = `/api/auth/google/start?purpose=gmail${hint ? `&hint=${encodeURIComponent(hint)}` : ""}`);
  const list = (accounts || []).filter((a) => a.email.includes(q.toLowerCase()) || a.name.toLowerCase().includes(q.toLowerCase()));
  const full = (accounts?.length || 0) >= max;
  const capacity = (accounts || []).filter((a) => a.status === "active").reduce((s, a) => s + a.dailyLimit, 0);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Email inboxes"
        description={
          accounts ? (
            <>
              {accounts.length} of {max} Gmail inboxes connected · {fmt(capacity)} emails/day capacity
            </>
          ) : (
            "Your sending inboxes"
          )
        }
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => connect()} disabled={full}>
            Add Gmail account
          </Button>
        }
      />

      <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-[13px] text-muted">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        <span>
          On Google&apos;s screen, sign in with the inbox you want to add and <b className="text-text">tick both Gmail checkboxes</b>. For brand-new Gmail accounts start around
          20–30 emails/day and raise it slowly over a few weeks.
        </span>
      </div>

      <Card>
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <div className="relative max-w-xs flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <Input placeholder="Search inboxes" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
        </div>

        {!accounts ? (
          <div className="grid h-48 place-items-center">
            <Spinner />
          </div>
        ) : !accounts.length ? (
          <Empty
            icon={<Inbox className="size-5" />}
            title="No inboxes yet"
            description="Connect the Gmail accounts you want to send from. Campaign volume is split evenly between them."
            action={
              <Button icon={<Plus className="size-4" />} onClick={() => connect()}>
                Add Gmail account
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium text-faint">
                  <th className="px-5 py-2.5 font-medium">Inbox</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="w-56 px-3 py-2.5 font-medium">Sent (24h)</th>
                  <th className="px-3 py-2.5 text-right font-medium">Total sent</th>
                  <th className="px-3 py-2.5 text-right font-medium">Replies</th>
                  <th className="px-3 py-2.5 text-right font-medium">Campaigns</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map((a) => (
                  <tr key={a.id} className="group hover:bg-surface-2/50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar src={a.picture} name={a.name} />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{a.email}</div>
                          <div className="truncate text-xs text-faint">
                            {a.name} · added {timeAgo(a.connectedAt)}
                          </div>
                        </div>
                      </div>
                      {a.status === "error" && a.error && (
                        <div className="mt-2 flex items-start gap-1.5 text-xs text-danger">
                          <AlertTriangle className="mt-px size-3.5 shrink-0" />
                          <span className="line-clamp-2">{a.error}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {a.status === "active" ? (
                        <Badge tone="green">
                          <span className="pulse-dot size-1.5 rounded-full bg-current" /> Active
                        </Badge>
                      ) : a.status === "paused" ? (
                        <Badge tone="amber" dot>
                          Paused
                        </Badge>
                      ) : (
                        <Badge tone="red" dot>
                          Disconnected
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <Progress value={a.sentToday} max={a.dailyLimit} tone={a.sentToday >= a.dailyLimit ? "warning" : "primary"} />
                        <span className="shrink-0 text-xs text-muted tabular-nums">
                          {a.sentToday}/{a.dailyLimit}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmt(a.totalSent)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmt(a.replies)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{a.campaigns}</td>
                    <td className="relative px-3 py-3">
                      <button
                        onClick={(e) => (e.stopPropagation(), setMenu(menu === a.id ? null : a.id))}
                        className="rounded-md p-1.5 text-faint hover:bg-surface-2 hover:text-text"
                      >
                        <MoreHorizontal className="size-4" />
                      </button>
                      {menu === a.id && (
                        <div className="animate-fade-up absolute top-11 right-3 z-10 w-44 rounded-lg border border-border bg-surface p-1 shadow-pop" onClick={(e) => e.stopPropagation()}>
                          <MenuItem icon={<Pencil className="size-4" />} onClick={() => (setEditing(a), setMenu(null))}>
                            Edit settings
                          </MenuItem>
                          {a.status === "error" ? (
                            <MenuItem icon={<RefreshCw className="size-4" />} onClick={() => connect(a.email)}>
                              Reconnect
                            </MenuItem>
                          ) : a.status === "active" ? (
                            <MenuItem icon={<Pause className="size-4" />} onClick={() => (patch(a, { status: "paused" }), setMenu(null))}>
                              Pause sending
                            </MenuItem>
                          ) : (
                            <MenuItem icon={<Play className="size-4" />} onClick={() => (patch(a, { status: "active" }), setMenu(null))}>
                              Resume sending
                            </MenuItem>
                          )}
                          <MenuItem danger icon={<Trash2 className="size-4" />} onClick={() => (setRemoving(a), setMenu(null))}>
                            Remove
                          </MenuItem>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && <EditAccount account={editing} onClose={() => setEditing(null)} onSaved={load} />}

      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove inbox?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await api(`/api/accounts/${removing!.id}`, { method: "DELETE" });
                toast.success("Inbox removed");
                setRemoving(null);
                load();
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          <b className="text-text">{removing?.email}</b> will stop sending. Leads that haven&apos;t been contacted yet are moved to your other inboxes in the same campaigns.
        </p>
      </Modal>
    </div>
  );
}

function MenuItem({ icon, children, onClick, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] ${danger ? "text-danger hover:bg-danger-soft" : "hover:bg-surface-2"}`}>
      {icon}
      {children}
    </button>
  );
}

function EditAccount({ account, onClose, onSaved }: { account: Account; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(account.name);
  const [limit, setLimit] = useState(account.dailyLimit);
  const [signature, setSignature] = useState(account.signature);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api(`/api/accounts/${account.id}`, { method: "PATCH", body: { name, dailyLimit: limit, signature } });
      toast.success("Saved");
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={account.email}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={save}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label hint="shown as the sender name">From name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label hint="across all campaigns, rolling 24h">Daily sending limit</Label>
          <Input type="number" min={1} max={500} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
          <p className="mt-1.5 text-xs text-faint">Recommended: 20–50 for regular Gmail. Google&apos;s hard limit is ~500/day.</p>
        </div>
        <div>
          <Label hint="appended to every email">Signature</Label>
          <Textarea rows={4} value={signature} onChange={(e) => setSignature(e.target.value)} placeholder={"Meris Dabhi\nFounder, Example Co."} />
        </div>
      </div>
    </Modal>
  );
}

export default function AccountsPage() {
  return (
    <Suspense>
      <AccountsInner />
    </Suspense>
  );
}
