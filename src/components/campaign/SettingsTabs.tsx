"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Clock, FileSpreadsheet, Inbox, Info, Plus, Timer } from "lucide-react";
import type { Campaign } from "@/lib/types";
import { Avatar, Badge, Button, Card, CardHeader, Empty, Input, Label, Select, Switch, Textarea, cn } from "../ui";
import type { AccountLite, CampaignPatch } from "./types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hourLabel = (h: number) => (h === 0 || h === 24 ? "12 AM" : h === 12 ? "12 PM" : h < 12 ? `${h} AM` : `${h - 12} PM`);

function timezones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
}

// ─── Schedule ──────────────────────────────────────────────────────────────

export function ScheduleTab({ c, onChange }: { c: Campaign; onChange: (p: CampaignPatch) => void }) {
  const s = c.schedule;
  const set = (p: Partial<Campaign["schedule"]>) => onChange({ schedule: { ...s, ...p } });
  const tzs = useMemo(timezones, []);
  const inboxes = Math.max(1, c.accountIds.length);
  const perInbox = Math.ceil(c.dailyLimit / inboxes);

  // Simulate one inbox's day so the pacing is tangible.
  const sim = useMemo(() => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const times: number[] = [];
    let t = s.startHour * 3600 + rnd() * 60;
    for (let i = 0; i < perInbox && t < s.endHour * 3600; i++) {
      times.push(t);
      t += s.minGapSec + rnd() * (s.maxGapSec - s.minGapSec);
    }
    return times;
  }, [perInbox, s.startHour, s.endHour, s.minGapSec, s.maxGapSec]);
  const fmtT = (sec: number) => {
    const h = Math.floor(sec / 3600),
      m = Math.floor((sec % 3600) / 60);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  };
  const windowSec = (s.endHour - s.startHour) * 3600;
  const capacityPerInbox = Math.floor(windowSec / ((s.minGapSec + s.maxGapSec) / 2));

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <Card>
          <CardHeader title="Sending window" description="Emails only go out during these hours, in the chosen timezone." />
          <div className="space-y-5 p-5">
            <div>
              <Label>Days</Label>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d, i) => {
                  const on = s.days.includes(i);
                  return (
                    <button
                      key={d}
                      onClick={() => set({ days: on ? s.days.filter((x) => x !== i) : [...s.days, i].sort() })}
                      className={cn(
                        "h-9 w-12 rounded-lg border text-[13px] font-medium transition",
                        on ? "border-primary bg-primary text-white" : "border-border-strong bg-surface text-muted hover:text-text",
                      )}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label>From</Label>
                <Select value={s.startHour} onChange={(e) => set({ startHour: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>To</Label>
                <Select value={s.endHour} onChange={(e) => set({ endHour: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Timezone</Label>
                <Select value={s.timezone} onChange={(e) => set({ timezone: e.target.value })}>
                  {tzs.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </Select>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Volume & pacing" description="Behave like a person: one email at a time from each inbox, with a random pause in between." />
          <div className="grid gap-5 p-5 sm:grid-cols-3">
            <div>
              <Label hint="all inboxes">Emails per day</Label>
              <Input type="number" min={1} value={c.dailyLimit} onChange={(e) => onChange({ dailyLimit: Math.max(1, Number(e.target.value) || 1) })} />
            </div>
            <div>
              <Label hint="seconds">Min gap</Label>
              <Input type="number" min={20} value={s.minGapSec} onChange={(e) => set({ minGapSec: Number(e.target.value) || 60 })} />
            </div>
            <div>
              <Label hint="seconds">Max gap</Label>
              <Input type="number" min={20} value={s.maxGapSec} onChange={(e) => set({ maxGapSec: Number(e.target.value) || 180 })} />
            </div>
          </div>
          <div className="mx-5 mb-5 flex items-start gap-2.5 rounded-lg bg-primary-soft/70 px-4 py-3 text-[13px]">
            <Info className="mt-0.5 size-4 shrink-0 text-primary" />
            <span className="text-muted">
              <b className="text-text">{c.dailyLimit}</b> emails/day across <b className="text-text">{inboxes}</b> inbox{inboxes === 1 ? "" : "es"} ={" "}
              <b className="text-text">{perInbox} per inbox</b>. Each inbox waits {Math.round(s.minGapSec / 60 * 10) / 10}–{Math.round(s.maxGapSec / 60 * 10) / 10} min between emails. Follow-ups
              count toward the same daily total.
            </span>
          </div>
          {perInbox > capacityPerInbox && (
            <div className="mx-5 mb-5 flex items-start gap-2.5 rounded-lg bg-warning-soft px-4 py-3 text-[13px] text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              With this window and gap, one inbox can only send ~{capacityPerInbox} emails/day. Widen the window, shorten the gap or add inboxes.
            </div>
          )}
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader title="A day in one inbox" description="Simulated send times" />
        <div className="p-5">
          <ol className="relative space-y-0 border-l border-border pl-5">
            {sim.slice(0, 8).map((t, i) => (
              <li key={i} className="relative pb-4">
                <span className="absolute top-1 -left-[25px] size-2.5 rounded-full border-2 border-surface bg-primary" />
                <div className="flex items-center justify-between text-[13px]">
                  <span className="font-medium">Email {i + 1}</span>
                  <span className="text-muted tabular-nums">{fmtT(t)}</span>
                </div>
                {i > 0 && <div className="text-xs text-faint">+{Math.round((t - sim[i - 1]) / 6) / 10} min</div>}
              </li>
            ))}
          </ol>
          {sim.length > 8 && (
            <div className="flex items-center gap-2 border-t border-border pt-3 text-[13px] text-muted">
              <Timer className="size-4" /> … {sim.length - 8} more, last at <b className="text-text">{fmtT(sim[sim.length - 1])}</b>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ─── Inboxes ───────────────────────────────────────────────────────────────

export function InboxesTab({ c, accounts, onChange }: { c: Campaign; accounts: AccountLite[]; onChange: (p: CampaignPatch) => void }) {
  const selected = new Set(c.accountIds);
  const chosen = accounts.filter((a) => selected.has(a.id));
  const perInbox = Math.ceil(c.dailyLimit / Math.max(1, chosen.filter((a) => a.status === "active").length || chosen.length));
  const toggle = (id: string) => onChange({ accountIds: selected.has(id) ? c.accountIds.filter((x) => x !== id) : [...c.accountIds, id] });
  const allOn = accounts.length > 0 && accounts.every((a) => selected.has(a.id));

  if (!accounts.length)
    return (
      <Card>
        <Empty
          icon={<Inbox className="size-5" />}
          title="No inboxes connected"
          description="Connect at least one Gmail account to send this campaign."
          action={
            <Link href="/accounts">
              <Button icon={<Plus className="size-4" />}>Add Gmail account</Button>
            </Link>
          }
        />
      </Card>
    );

  return (
    <Card>
      <CardHeader
        title="Sending inboxes"
        description={`${chosen.length} selected · ${c.dailyLimit}/day split into ~${perInbox} per inbox. Leads are assigned evenly and every follow-up comes from the same inbox.`}
        action={
          <Button variant="secondary" size="sm" onClick={() => onChange({ accountIds: allOn ? [] : accounts.map((a) => a.id) })}>
            {allOn ? "Deselect all" : "Select all"}
          </Button>
        }
      />
      <ul className="divide-y divide-border">
        {accounts.map((a) => {
          const on = selected.has(a.id);
          const over = on && perInbox > a.dailyLimit;
          return (
            <li key={a.id}>
              <label className={cn("flex cursor-pointer items-center gap-3.5 px-5 py-3 transition", on ? "bg-primary-soft/30" : "hover:bg-surface-2/50")}>
                <input type="checkbox" checked={on} onChange={() => toggle(a.id)} className="size-4 accent-[var(--primary)]" />
                <Avatar src={a.picture} name={a.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{a.email}</div>
                  <div className="text-xs text-faint">
                    Limit {a.dailyLimit}/day · {a.sentToday} sent in last 24h
                  </div>
                </div>
                {over && <Badge tone="amber">Capped at {a.dailyLimit}/day</Badge>}
                {a.status !== "active" ? <Badge tone={a.status === "error" ? "red" : "amber"}>{a.status}</Badge> : on && <CheckCircle2 className="size-4 text-primary" />}
              </label>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ─── Options ───────────────────────────────────────────────────────────────

export function OptionsTab({ c, onChange, isPublic, sheetWrite }: { c: Campaign; onChange: (p: CampaignPatch) => void; isPublic: boolean; sheetWrite: boolean }) {
  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader title="Google Sheet status" description="Write each lead's progress back into your sheet, next to their row." />
        {!sheetWrite && (
          <div className="mx-5 mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-warning-soft px-4 py-3 text-[13px] text-warning">
            <AlertTriangle className="size-4 shrink-0" />
            <span className="flex-1">Sniper only has read access to your sheets. Reconnect Google Sheets to allow status updates.</span>
            <a href="/api/auth/google/start?purpose=owner">
              <Button size="sm" variant="secondary">
                Reconnect
              </Button>
            </a>
          </div>
        )}
        <div className="divide-y divide-border">
          <Row title="Update status column" text="Queued → Sent · step 1/2 · Oct 2, 14:05 → Replied / Bounced / Unsubscribed / Skipped (already contacted).">
            <Switch checked={c.sheetStatus} onChange={(v) => onChange({ sheetStatus: v })} />
          </Row>
          {c.sheetStatus && (
            <div className="px-5 py-4">
              <Label hint="created automatically if it doesn't exist">Column name</Label>
              <div className="relative max-w-xs">
                <FileSpreadsheet className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-success" />
                <Input className="pl-9" value={c.sheetStatusColumn} onChange={(e) => onChange({ sheetStatusColumn: e.target.value })} placeholder="Outreach Status" />
              </div>
            </div>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader title="Behaviour" />
        <div className="divide-y divide-border">
          <Row title="Stop sequence on reply" text="When a lead replies, no further follow-ups are sent to them.">
            <Switch checked={c.stopOnReply} onChange={(v) => onChange({ stopOnReply: v })} />
          </Row>
          <Row
            title="Track opens"
            text={
              isPublic
                ? "Adds an invisible 1×1 image. Turning this off slightly improves deliverability."
                : "Needs the app to run on a public URL (set APP_URL). Unavailable on localhost."
            }
          >
            <Switch checked={c.trackOpens && isPublic} disabled={!isPublic} onChange={(v) => onChange({ trackOpens: v })} />
          </Row>
        </div>
      </Card>
      <Card>
        <CardHeader title="Unsubscribe" description="A polite opt-out line keeps you compliant and protects your sender reputation." />
        <div className="divide-y divide-border">
          <Row title="Add opt-out line" text={isPublic ? "Appended to every email together with a one-click unsubscribe link." : "Replies containing “unsubscribe” or “remove me” are detected automatically."}>
            <Switch checked={c.unsubscribeFooter} onChange={(v) => onChange({ unsubscribeFooter: v })} />
          </Row>
          {c.unsubscribeFooter && (
            <div className="px-5 py-4">
              <Label>Opt-out text</Label>
              <Textarea rows={2} value={c.unsubscribeText} onChange={(e) => onChange({ unsubscribeText: e.target.value })} />
            </div>
          )}
        </div>
      </Card>
      <div className="flex items-start gap-2.5 text-xs text-faint">
        <Clock className="mt-px size-3.5 shrink-0" /> Replies, bounces and unsubscribes are checked in each inbox every 3 minutes.
      </div>
    </div>
  );
}

function Row({ title, text, children }: { title: string; text: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-[13px] text-muted">{text}</div>
      </div>
      {children}
    </div>
  );
}
