"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  ServerCrash,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react";
import { api, fmt, pollWhileVisible, timeAgo } from "@/lib/client";
import { Badge, Button, Card, Empty, Input, Label, Modal, PageHeader, Progress, Spinner, cn } from "@/components/ui";
import { WhatsAppGlyph } from "@/components/Channel";

type WaAccount = {
  id: string;
  label: string;
  phone?: string;
  name?: string;
  status: "pending" | "qr" | "connected" | "disconnected" | "logged_out" | "remove_requested";
  paused: boolean;
  error?: string;
  dailyLimit: number;
  lastSeenAt?: string;
  connectedAt?: string;
  createdAt: string;
  sentToday: number;
  totalSent: number;
  replies: number;
  campaigns: number;
};
type Worker = { online: boolean; heartbeatAt?: string };

const phone = (a: { phone?: string }) => (a.phone ? `+${a.phone}` : "");

export default function WhatsAppPage() {
  const [accounts, setAccounts] = useState<WaAccount[] | null>(null);
  const [worker, setWorker] = useState<Worker>({ online: true });
  const [max, setMax] = useState(25);
  const [linking, setLinking] = useState<{ id?: string } | null>(null);
  const [editing, setEditing] = useState<WaAccount | null>(null);
  const [removing, setRemoving] = useState<WaAccount | null>(null);
  const [menu, setMenu] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<{ accounts: WaAccount[]; worker: Worker; max: number }>("/api/wa/accounts").then((d) => {
        setAccounts(d.accounts);
        setWorker(d.worker);
        setMax(d.max);
      }),
    [],
  );

  useEffect(() => {
    load();
    return pollWhileVisible(load, 15_000);
  }, [load]);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  async function patch(a: WaAccount, body: Record<string, unknown>) {
    try {
      await api(`/api/wa/accounts/${a.id}`, { method: "PATCH", body });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const live = (accounts || []).filter((a) => a.status === "connected");
  const capacity = live.filter((a) => !a.paused).reduce((s, a) => s + a.dailyLimit, 0);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            WhatsApp numbers
            <WorkerPill worker={worker} />
          </span>
        }
        description={
          accounts ? (
            <>
              {live.length} connected · {accounts.length} of {max} linked · {fmt(capacity)} messages/day capacity
            </>
          ) : (
            "Link WhatsApp numbers by scanning a QR code"
          )
        }
        actions={
          <Button
            className="bg-wa shadow-wa/20 hover:bg-wa hover:brightness-95"
            icon={<Plus className="size-4" />}
            onClick={() => setLinking({})}
            disabled={(accounts?.length || 0) >= max}
          >
            Link a number
          </Button>
        }
      />

      {!worker.online && <WorkerOffline />}

      <div className="mb-6 flex items-start gap-3 rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-[13px] text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-wa" />
        <span>
          WhatsApp is strict about unsolicited messages. Use numbers that have been active for a while, keep it to <b className="text-text">10–20 new
          chats per number per day</b>, personalize every message, and stop when someone says no — Sniper does the pacing, typing and STOP-handling for
          you.
        </span>
      </div>

      {!accounts ? (
        <div className="grid h-48 place-items-center">
          <Spinner />
        </div>
      ) : !accounts.length ? (
        <Card>
          <Empty
            icon={<WhatsAppGlyph className="size-5 text-wa" />}
            title="Link your first WhatsApp number"
            description="Scan a QR code from WhatsApp → Linked devices, exactly like WhatsApp Web. Your phone stays the main device."
            action={
              <Button className="bg-wa hover:bg-wa hover:brightness-95" icon={<QrCode className="size-4" />} onClick={() => setLinking({})}>
                Link a number
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {accounts.map((a) => (
            <NumberCard
              key={a.id}
              a={a}
              menuOpen={menu === a.id}
              onMenu={() => setMenu(menu === a.id ? null : a.id)}
              onPause={() => (patch(a, { paused: !a.paused }), setMenu(null))}
              onEdit={() => (setEditing(a), setMenu(null))}
              onQr={() => setLinking({ id: a.id })}
              onRemove={() => (setRemoving(a), setMenu(null))}
            />
          ))}
          {accounts.length < max && (
            <button
              onClick={() => setLinking({})}
              className="group flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border text-muted transition hover:border-wa/50 hover:bg-wa-soft/40 hover:text-wa"
            >
              <span className="grid size-11 place-items-center rounded-xl bg-surface-2 transition group-hover:bg-wa-soft">
                <Plus className="size-5" />
              </span>
              <span className="text-sm font-medium">Link another number</span>
            </button>
          )}
        </div>
      )}

      {linking && (
        <LinkModal
          existingId={linking.id}
          workerOnline={worker.online}
          onClose={() => {
            setLinking(null);
            load();
          }}
        />
      )}
      {editing && <EditNumber account={editing} onClose={() => setEditing(null)} onSaved={load} />}
      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove this number?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                const r = await api<{ removed: string }>(`/api/wa/accounts/${removing!.id}`, { method: "DELETE" });
                toast.success(r.removed === "now" ? "Number removed — also unlink it in WhatsApp → Linked devices" : "Unlinking…");
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
          <b className="text-text">{phone(removing || {}) || removing?.label || "This number"}</b> will be unlinked and stop sending. Leads it hasn&apos;t
          contacted yet move to your other numbers in the same campaigns.
        </p>
      </Modal>
    </div>
  );
}

function WorkerPill({ worker }: { worker: Worker }) {
  return worker.online ? (
    <Badge tone="green" className="font-normal">
      <span className="pulse-dot size-1.5 rounded-full bg-current" /> Worker online
    </Badge>
  ) : (
    <Badge tone="amber" dot className="font-normal">
      Worker offline
    </Badge>
  );
}

function WorkerOffline() {
  return (
    <Card className="mb-6 flex flex-wrap items-start gap-4 border-warning/30 bg-warning-soft/40 p-5">
      <div className="grid size-10 place-items-center rounded-xl bg-warning-soft text-warning">
        <ServerCrash className="size-5" />
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-semibold">The WhatsApp worker isn&apos;t running</div>
        <p className="mt-1 text-muted">
          WhatsApp needs an always-on connection, which Vercel can&apos;t keep. It runs automatically with <code className="font-mono text-text">npm run dev</code>{" "}
          on your computer, or deploy the worker (<code className="font-mono text-text">npm run worker</code>) on Railway, Render or a VPS. QR codes and
          sending start as soon as it&apos;s online.
        </p>
      </div>
    </Card>
  );
}

const STATUS: Record<WaAccount["status"], { label: string; tone: "green" | "amber" | "red" | "gray" | "blue" }> = {
  connected: { label: "Connected", tone: "green" },
  pending: { label: "Starting…", tone: "blue" },
  qr: { label: "Waiting for scan", tone: "blue" },
  disconnected: { label: "Disconnected", tone: "amber" },
  logged_out: { label: "Not linked", tone: "red" },
  remove_requested: { label: "Removing…", tone: "gray" },
};

function NumberCard({
  a,
  menuOpen,
  onMenu,
  onPause,
  onEdit,
  onQr,
  onRemove,
}: {
  a: WaAccount;
  menuOpen: boolean;
  onMenu: () => void;
  onPause: () => void;
  onEdit: () => void;
  onQr: () => void;
  onRemove: () => void;
}) {
  const st = a.status === "connected" && a.paused ? { label: "Paused", tone: "amber" as const } : STATUS[a.status];
  const connected = a.status === "connected";
  return (
    <Card className="group relative flex flex-col p-5 transition hover:shadow-pop">
      <div className="flex items-start gap-3">
        <div className={cn("relative grid size-11 shrink-0 place-items-center rounded-full bg-wa-soft text-wa", connected && !a.paused && "ring-pulse")}>
          <WhatsAppGlyph className="size-5" />
          <span
            className={cn(
              "absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-2 border-surface",
              connected ? (a.paused ? "bg-warning" : "bg-wa") : a.status === "qr" || a.status === "pending" ? "bg-primary" : "bg-danger",
            )}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{a.label || a.name || "WhatsApp number"}</div>
          <div className="truncate text-sm text-muted">{phone(a) || "Not linked yet"}</div>
        </div>
        <div className="relative">
          <button
            onClick={(e) => (e.stopPropagation(), onMenu())}
            className="rounded-md p-1.5 text-faint hover:bg-surface-2 hover:text-text"
            aria-label="Number actions"
          >
            <MoreHorizontal className="size-4" />
          </button>
          {menuOpen && (
            <div className="animate-fade-up absolute top-9 right-0 z-10 w-44 rounded-lg border border-border bg-surface p-1 shadow-pop" onClick={(e) => e.stopPropagation()}>
              <MenuItem icon={<Pencil className="size-4" />} onClick={onEdit}>
                Edit
              </MenuItem>
              {connected ? (
                <MenuItem icon={a.paused ? <Play className="size-4" /> : <Pause className="size-4" />} onClick={onPause}>
                  {a.paused ? "Resume sending" : "Pause sending"}
                </MenuItem>
              ) : (
                <MenuItem icon={<QrCode className="size-4" />} onClick={onQr}>
                  Show QR code
                </MenuItem>
              )}
              <MenuItem danger icon={<Trash2 className="size-4" />} onClick={onRemove}>
                Remove
              </MenuItem>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Badge tone={st.tone} dot>
          {st.label}
        </Badge>
        {connected && a.lastSeenAt && <span className="text-xs text-faint">active {timeAgo(a.lastSeenAt)}</span>}
      </div>

      {a.error && !connected && (
        <div className="mt-3 flex items-start gap-1.5 text-xs text-danger">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span className="line-clamp-2">{a.error}</span>
        </div>
      )}

      <div className="mt-auto pt-5">
        <div className="mb-1.5 flex justify-between text-xs">
          <span className="text-muted">Sent in the last 24h</span>
          <span className="font-medium tabular-nums">
            {a.sentToday}/{a.dailyLimit}
          </span>
        </div>
        <Progress value={a.sentToday} max={a.dailyLimit} tone={a.sentToday >= a.dailyLimit ? "warning" : "success"} />
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
          {[
            ["Sent", a.totalSent],
            ["Replies", a.replies],
            ["Campaigns", a.campaigns],
          ].map(([l, v]) => (
            <div key={l as string}>
              <div className="text-sm font-semibold tabular-nums">{fmt(v as number)}</div>
              <div className="text-[11px] text-faint">{l}</div>
            </div>
          ))}
        </div>
        {!connected && a.status !== "remove_requested" && (
          <Button variant="secondary" size="sm" className="mt-4 w-full" icon={<QrCode className="size-4" />} onClick={onQr}>
            {a.status === "qr" || a.status === "pending" ? "Open QR code" : "Show QR code"}
          </Button>
        )}
      </div>
    </Card>
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

// ─── Link flow ─────────────────────────────────────────────────────────────

type LiveAccount = { id: string; label: string; phone?: string; name?: string; status: WaAccount["status"]; qr?: string; error?: string };

function LinkModal({ existingId, workerOnline, onClose }: { existingId?: string; workerOnline: boolean; onClose: () => void }) {
  const [id, setId] = useState<string | undefined>(existingId);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [acc, setAcc] = useState<LiveAccount | null>(null);
  const [online, setOnline] = useState(workerOnline);
  const [svg, setSvg] = useState("");
  const asked = useRef(false);

  // Re-opening an existing number: ask the worker for a fresh QR code if it isn't connected.
  useEffect(() => {
    if (!existingId || asked.current) return;
    asked.current = true;
    api(`/api/wa/accounts/${existingId}`, { method: "PATCH", body: { reconnect: true } }).catch(() => {});
  }, [existingId]);

  useEffect(() => {
    if (!id) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api<{ account: LiveAccount; worker: Worker }>(`/api/wa/accounts/${id}`);
        if (stop) return;
        setAcc(r.account);
        setOnline(r.worker.online);
      } catch {}
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [id]);

  useEffect(() => {
    if (!acc?.qr) return setSvg("");
    QRCode.toString(acc.qr, { type: "svg", margin: 1, color: { dark: "#111b21", light: "#ffffff" } }).then(setSvg);
  }, [acc?.qr]);

  async function create() {
    setCreating(true);
    try {
      const r = await api<{ id: string }>("/api/wa/accounts", { body: { label } });
      setId(r.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  const done = acc?.status === "connected";
  const expired = acc?.status === "logged_out" || acc?.status === "disconnected";

  return (
    <Modal open onClose={onClose} title={done ? "Number linked" : "Link a WhatsApp number"} wide>
      {!id ? (
        <div className="space-y-4">
          <div>
            <Label hint="only you see this">Name for this number</Label>
            <Input autoFocus placeholder="e.g. Sales line, Meris personal" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
          </div>
          {!online && (
            <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-[13px] text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> The WhatsApp worker is offline, so no QR code can be shown yet. Start it first.
            </p>
          )}
          <div className="flex justify-end">
            <Button className="bg-wa hover:bg-wa hover:brightness-95" loading={creating} onClick={create} icon={<QrCode className="size-4" />}>
              Get QR code
            </Button>
          </div>
        </div>
      ) : done ? (
        <div className="flex flex-col items-center py-6 text-center">
          <div className="grid size-16 place-items-center rounded-full bg-wa-soft text-wa">
            <CheckCircle2 className="size-8" />
          </div>
          <div className="mt-4 text-lg font-semibold">{acc?.name || acc?.label || "Connected"}</div>
          <div className="text-muted">{phone(acc || {})}</div>
          <p className="mt-3 max-w-sm text-sm text-muted">This number is ready. Add it to a WhatsApp campaign from the campaign&apos;s Senders tab.</p>
          <Button className="mt-6" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <div className="grid items-center gap-6 sm:grid-cols-[1fr_auto]">
          <ol className="space-y-4 text-sm">
            {[
              <>Open <b>WhatsApp</b> on the phone you want to link</>,
              <>
                Tap <b>⋮ Menu</b> (Android) or <b>Settings</b> (iPhone) → <b>Linked devices</b>
              </>,
              <>
                Tap <b>Link a device</b> and point your phone at this QR code
              </>,
            ].map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-wa-soft text-xs font-semibold text-wa">{i + 1}</span>
                <span className="pt-0.5 text-muted">{t}</span>
              </li>
            ))}
            <li className="flex items-center gap-2 pt-2 text-xs text-faint">
              <Smartphone className="size-3.5" /> Your phone stays the main device; messages also appear there.
            </li>
          </ol>
          <div className="relative mx-auto grid size-[236px] place-items-center rounded-2xl border border-border bg-white p-3 shadow-card">
            {svg && !expired ? (
              <div className="size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
            ) : expired ? (
              <div className="flex flex-col items-center gap-3 px-4 text-center">
                <span className="text-sm text-gray-600">{acc?.error || "QR code expired"}</span>
                <Button
                  size="sm"
                  icon={<RefreshCw className="size-3.5" />}
                  onClick={() => api(`/api/wa/accounts/${id}`, { method: "PATCH", body: { reconnect: true } })}
                >
                  New QR code
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-center text-xs text-gray-500">
                <Loader2 className="size-6 animate-spin" />
                {online ? "Generating QR code…" : "Waiting for the WhatsApp worker…"}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function EditNumber({ account, onClose, onSaved }: { account: WaAccount; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(account.label);
  const [limit, setLimit] = useState(account.dailyLimit);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await api(`/api/wa/accounts/${account.id}`, { method: "PATCH", body: { label, dailyLimit: limit } });
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
      title={phone(account) || account.label || "WhatsApp number"}
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
          <Label hint="used as {{sender_name}} if WhatsApp has no profile name">Name</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div>
          <Label hint="new + follow-up messages, rolling 24h">Daily limit</Label>
          <Input type="number" min={1} max={200} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
          <p className="mt-1.5 text-xs text-faint">Start at 10–15 for a number that hasn&apos;t done outreach before, and raise slowly.</p>
        </div>
      </div>
    </Modal>
  );
}
