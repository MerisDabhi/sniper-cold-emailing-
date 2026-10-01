"use client";

import Link from "next/link";
import { Suspense, use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Cloud, FlaskConical, Loader2, Pause, Play, Rocket } from "lucide-react";
import { api, pollWhileVisible } from "@/lib/client";
import type { Campaign } from "@/lib/types";
import { Button, Input, Label, Modal, Select, Spinner, StatusBadge, cn } from "@/components/ui";
import { SheetTab } from "@/components/campaign/SheetTab";
import { SequenceTab } from "@/components/campaign/SequenceTab";
import { InboxesTab, OptionsTab, ScheduleTab } from "@/components/campaign/SettingsTabs";
import { AnalyticsTab } from "@/components/campaign/AnalyticsTab";
import { LeadsTab } from "@/components/campaign/LeadsTab";
import type { AccountLite, CampaignPatch, Detail, SheetInfo } from "@/components/campaign/types";

type Tab = "analytics" | "leads" | "sheet" | "sequence" | "schedule" | "inboxes" | "options";
const SETUP: { id: Tab; label: string }[] = [
  { id: "sheet", label: "Sheet & mapping" },
  { id: "sequence", label: "Sequence" },
  { id: "schedule", label: "Schedule" },
  { id: "inboxes", label: "Inboxes" },
  { id: "options", label: "Options" },
];

function complete(c: Campaign, tab: Tab) {
  switch (tab) {
    case "sheet":
      return !!c.sheet && !!c.mapping?.email;
    case "sequence":
      return !!c.steps[0]?.subject.trim() && c.steps.every((s) => s.body.trim());
    case "schedule":
      return c.schedule.days.length > 0 && c.schedule.endHour > c.schedule.startHour;
    case "inboxes":
      return c.accountIds.length > 0;
    default:
      return true;
  }
}

function CampaignInner({ id }: { id: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [c, setC] = useState<Campaign | null>(null);
  const [accounts, setAccounts] = useState<AccountLite[]>([]);
  const [sheet, setSheet] = useState<SheetInfo | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [sheetWrite, setSheetWrite] = useState(true);
  const [ownerEmail, setOwnerEmail] = useState("");
  const [tab, setTab] = useState<Tab | null>((sp.get("tab") as Tab) || null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [launching, setLaunching] = useState(false);
  const [confirmLaunch, setConfirmLaunch] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const pending = useRef<CampaignPatch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadDetail = useCallback(async () => {
    const d = await api<Detail>(`/api/campaigns/${id}`);
    setDetail(d);
    return d;
  }, [id]);

  useEffect(() => {
    (async () => {
      try {
        const [d, acc, me] = await Promise.all([
          loadDetail(),
          api<{ accounts: AccountLite[] }>("/api/accounts"),
          api<{ isPublic: boolean; sheetWrite: boolean; owner: { email: string } | null }>("/api/me"),
        ]);
        setC(d.campaign);
        setAccounts(acc.accounts);
        setIsPublic(me.isPublic);
        setSheetWrite(me.sheetWrite);
        setOwnerEmail(me.owner?.email || "");
        setTab((t) => t || (d.campaign.status === "draft" ? "sheet" : "analytics"));
        if (d.campaign.sheet) {
          api<SheetInfo>("/api/sheets/inspect", { body: { url: d.campaign.sheet.url, tab: d.campaign.sheet.tab } })
            .then(setSheet)
            .catch(() => {});
        }
      } catch (e) {
        toast.error((e as Error).message);
        router.replace("/campaigns");
      }
    })();
  }, [loadDetail, router]);

  // Live refresh of stats while the campaign is running.
  useEffect(() => {
    if (c?.status !== "active") return;
    return pollWhileVisible(loadDetail, 30_000);
  }, [c?.status, loadDetail]);

  const flush = useCallback(async () => {
    const body = pending.current;
    pending.current = {};
    if (!Object.keys(body).length) return;
    setSaveState("saving");
    try {
      await api(`/api/campaigns/${id}`, { method: "PATCH", body });
      setSaveState("saved");
    } catch (e) {
      toast.error((e as Error).message);
      setSaveState("idle");
    }
  }, [id]);

  const onChange = useCallback(
    (p: CampaignPatch) => {
      setC((prev) => (prev ? { ...prev, ...p } : prev));
      pending.current = { ...pending.current, ...p };
      setSaveState("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 600);
    },
    [flush],
  );

  async function action(a: "launch" | "pause" | "resume") {
    if (timer.current) clearTimeout(timer.current);
    await flush();
    setLaunching(true);
    try {
      const res = await api<{ campaign: Campaign; result?: { added: number; invalid: number; duplicate: number; alreadyContacted: number } }>(`/api/campaigns/${id}/action`, { body: { action: a } });
      setC(res.campaign);
      if (a === "launch") {
        toast.success("Campaign launched 🚀", {
          description: `${(res.result?.added ?? 0) - (res.result?.alreadyContacted ?? 0)} leads queued${res.result?.alreadyContacted ? `, ${res.result.alreadyContacted} already contacted before (skipped)` : ""}${res.result?.invalid ? `, ${res.result.invalid} invalid emails skipped` : ""}. First emails go out within a minute.`,
        });
        setTab("analytics");
      } else toast.success(a === "pause" ? "Campaign paused" : "Campaign resumed");
      setConfirmLaunch(false);
      loadDetail();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLaunching(false);
    }
  }

  if (!c || !detail || !tab)
    return (
      <div className="grid h-[60vh] place-items-center">
        <Spinner />
      </div>
    );

  const draft = c.status === "draft";
  const tabs: { id: Tab; label: string }[] = draft
    ? SETUP
    : [{ id: "analytics", label: "Analytics" }, { id: "leads", label: "Leads" }, ...SETUP];
  const setupIdx = SETUP.findIndex((s) => s.id === tab);
  const ready = SETUP.every((s) => complete(c, s.id));
  const perInbox = Math.ceil(c.dailyLimit / Math.max(1, c.accountIds.length));

  return (
    <div className="animate-fade-up">
      <Link href="/campaigns" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-text">
        <ArrowLeft className="size-4" /> Campaigns
      </Link>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <input
          value={c.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="min-w-0 flex-1 rounded-md bg-transparent px-1 -mx-1 text-[22px] font-semibold tracking-tight outline-none hover:bg-surface-2 focus:bg-surface-2"
        />
        <StatusBadge status={c.status} />
        <span className="flex w-16 items-center gap-1 text-xs text-faint">
          {saveState === "saving" ? (
            <>
              <Loader2 className="size-3 animate-spin" /> Saving
            </>
          ) : saveState === "saved" ? (
            <>
              <Cloud className="size-3" /> Saved
            </>
          ) : null}
        </span>
        <Button variant="secondary" icon={<FlaskConical className="size-4" />} onClick={() => setTestOpen(true)}>
          Send test
        </Button>
        {draft ? (
          <Button icon={<Rocket className="size-4" />} disabled={!ready} onClick={() => setConfirmLaunch(true)}>
            Launch
          </Button>
        ) : c.status === "active" ? (
          <Button variant="secondary" loading={launching} icon={<Pause className="size-4" />} onClick={() => action("pause")}>
            Pause
          </Button>
        ) : (
          <Button variant="success" loading={launching} icon={<Play className="size-4" />} onClick={() => action("resume")}>
            Resume
          </Button>
        )}
      </div>

      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t, i) => {
          const done = draft && complete(c, t.id) && t.id !== "options";
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition",
                tab === t.id ? "border-primary text-text" : "border-transparent text-muted hover:text-text",
              )}
            >
              {draft && (
                <span
                  className={cn(
                    "grid size-5 place-items-center rounded-full text-[11px] font-semibold",
                    done ? "bg-success text-white" : tab === t.id ? "bg-primary text-white" : "bg-surface-2 text-muted",
                  )}
                >
                  {done ? <Check className="size-3" /> : i + 1}
                </span>
              )}
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "analytics" && <AnalyticsTab d={detail} />}
      {tab === "leads" && <LeadsTab campaignId={id} totalSteps={c.steps.length} launched={!draft} onSynced={loadDetail} />}
      {tab === "sheet" && <SheetTab c={c} sheet={sheet} setSheet={setSheet} onChange={onChange} locked={!draft} />}
      {tab === "sequence" && <SequenceTab c={c} sheet={sheet} accounts={accounts} onChange={onChange} />}
      {tab === "schedule" && <ScheduleTab c={c} onChange={onChange} />}
      {tab === "inboxes" && <InboxesTab c={c} accounts={accounts} onChange={onChange} />}
      {tab === "options" && <OptionsTab c={c} onChange={onChange} isPublic={isPublic} sheetWrite={sheetWrite} />}

      {draft && setupIdx >= 0 && (
        <div className="mt-8 flex items-center justify-between border-t border-border pt-5">
          <Button variant="ghost" disabled={setupIdx === 0} icon={<ArrowLeft className="size-4" />} onClick={() => setTab(SETUP[setupIdx - 1].id)}>
            Back
          </Button>
          {setupIdx < SETUP.length - 1 ? (
            <Button onClick={() => setTab(SETUP[setupIdx + 1].id)}>
              Next: {SETUP[setupIdx + 1].label} <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button icon={<Rocket className="size-4" />} disabled={!ready} onClick={() => setConfirmLaunch(true)}>
              Review & launch
            </Button>
          )}
        </div>
      )}

      <Modal
        open={confirmLaunch}
        onClose={() => setConfirmLaunch(false)}
        title="Launch campaign"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmLaunch(false)}>
              Cancel
            </Button>
            <Button loading={launching} icon={<Rocket className="size-4" />} onClick={() => action("launch")}>
              Launch now
            </Button>
          </>
        }
      >
        <ul className="space-y-3 text-sm">
          {[
            `Import ${sheet ? sheet.rowCount : "all"} rows from “${c.sheet?.title}” (${c.sheet?.tab})`,
            `${c.steps.length}-step sequence, stops when a lead replies${c.stopOnReply ? "" : " (disabled)"}`,
            "Anyone already cold-emailed by any campaign is skipped automatically",
            c.sheetStatus ? `Progress is written to the “${c.sheetStatusColumn}” column of your sheet` : "Sheet status updates are off",
            `${c.dailyLimit} emails/day across ${c.accountIds.length} inbox${c.accountIds.length === 1 ? "" : "es"} (~${perInbox} each)`,
            `One email at a time per inbox, ${Math.round(c.schedule.minGapSec / 60 * 10) / 10}–${Math.round(c.schedule.maxGapSec / 60 * 10) / 10} min apart`,
            `${c.schedule.startHour}:00–${c.schedule.endHour}:00 ${c.schedule.timezone}`,
          ].map((t) => (
            <li key={t} className="flex gap-2.5">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              <span className="text-muted">{t}</span>
            </li>
          ))}
        </ul>
      </Modal>

      {testOpen && <TestModal campaign={c} defaultTo={ownerEmail} onClose={() => setTestOpen(false)} beforeSend={flush} />}
    </div>
  );
}

function TestModal({ campaign, defaultTo, onClose, beforeSend }: { campaign: Campaign; defaultTo: string; onClose: () => void; beforeSend: () => Promise<void> }) {
  const [to, setTo] = useState(defaultTo);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try {
      await beforeSend();
      const r = await api<{ sentTo: string; from: string }>(`/api/campaigns/${campaign.id}/action`, { body: { action: "test", to, step } });
      toast.success(`Test sent to ${r.sentTo}`, { description: `From ${r.from}, using the first row of your sheet.` });
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Send a test email"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={send}>
            Send test
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label>Send to</Label>
          <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <Label>Step</Label>
          <Select value={step} onChange={(e) => setStep(Number(e.target.value))}>
            {campaign.steps.map((s, i) => (
              <option key={s.id} value={i}>
                Step {i + 1} {s.subject ? `— ${s.subject.slice(0, 40)}` : ""}
              </option>
            ))}
          </Select>
        </div>
        <p className="text-xs text-faint">Variables are filled from the first row of your sheet. Test emails don&apos;t count toward analytics.</p>
      </div>
    </Modal>
  );
}

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <CampaignInner id={id} />
    </Suspense>
  );
}
