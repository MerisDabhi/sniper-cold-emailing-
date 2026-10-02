"use client";

import { useMemo, useRef, useState } from "react";
import { Clock, Eye, Plus, Sparkles, Trash2 } from "lucide-react";
import { WhatsAppPreview } from "../Channel";
import type { Campaign, SequenceStep } from "@/lib/types";
import { leadVariables, render, textToHtml, variableKeys } from "@/lib/template";
import { Badge, Button, Card, Input, Label, Textarea, cn } from "../ui";
import type { AccountLite, CampaignPatch, SheetInfo } from "./types";

const uid = () => "s_" + Math.random().toString(36).slice(2, 10);

export function SequenceTab({ c, sheet, accounts, onChange }: { c: Campaign; sheet: SheetInfo | null; accounts: AccountLite[]; onChange: (p: CampaignPatch) => void }) {
  const [active, setActive] = useState(0);
  const [previewRow, setPreviewRow] = useState(0);
  const [focus, setFocus] = useState<"subject" | "body">("body");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const steps = c.steps;
  const step = steps[Math.min(active, steps.length - 1)];
  const idx = steps.indexOf(step);

  const headers = sheet?.headers || c.sheet?.headers || [];
  const vars = useMemo(() => [...variableKeys(headers), "sender_name", "sender_first_name"], [headers]);

  const sender = accounts.find((a) => c.accountIds.includes(a.id)) || accounts[0];
  const sampleVars = useMemo((): Record<string, string> => {
    const row = sheet?.sample[previewRow];
    const base: Record<string, string> = row ? leadVariables(row, c.mapping) : { first_name: "Alex", last_name: "Taylor", company: "Acme Inc", email: "alex@acme.com" };
    return { ...base, sender_name: sender?.name || "You", sender_first_name: (sender?.name || "You").split(" ")[0], sender_email: sender?.email || "" };
  }, [sheet, previewRow, c.mapping, sender]);

  function update(patch: Partial<SequenceStep>) {
    onChange({ steps: steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)) });
  }

  function insert(v: string) {
    const token = `{{${v}}}`;
    const el = focus === "subject" ? subjectRef.current : bodyRef.current;
    const field = focus === "subject" ? "subject" : "body";
    const value = step[field];
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    update({ [field]: value.slice(0, start) + token + value.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function addStep() {
    onChange({ steps: [...steps, { id: uid(), delayDays: 3, subject: "", body: "" }] });
    setActive(steps.length);
  }

  function removeStep(i: number) {
    onChange({ steps: steps.filter((_, j) => j !== i) });
    setActive(Math.max(0, i - 1));
  }

  const isThreaded = idx > 0 && !step.subject.trim();
  const firstSubject = render(steps[0]?.subject || "", sampleVars, "preview" + steps[0]?.id);
  const previewSubject = isThreaded ? `Re: ${firstSubject}` : render(step.subject, sampleVars, "preview" + step.id);
  const previewBody = render(step.body, sampleVars, "preview" + step.id);
  const wa = c.channel === "whatsapp";
  const accent = wa ? "border-wa bg-wa-soft/60 ring-wa/10" : "border-primary bg-primary-soft/60 ring-primary/10";
  // WhatsApp preview: the whole conversation so far, like the lead would see it.
  const waMessages = steps.slice(0, idx + 1).map((s, i) => {
    let text = render(s.body, sampleVars, "preview" + s.id).trim();
    if (i === 0 && c.unsubscribeFooter && c.unsubscribeText.trim()) text += `\n\n${render(c.unsubscribeText, sampleVars).trim()}`;
    const day = steps.slice(1, i + 1).reduce((n, x) => n + x.delayDays, 0);
    return { text, label: i === 0 ? "Today" : `${day} day${day === 1 ? "" : "s"} later, if no reply` };
  });
  const contactName = [sampleVars.first_name, sampleVars.last_name].filter(Boolean).join(" ") || sampleVars.phone || "Lead";

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      {/* Step rail */}
      <div className="space-y-0">
        {steps.map((s, i) => (
          <div key={s.id}>
            {i > 0 && (
              <div className="flex items-center gap-2 py-2 pl-5 text-xs text-faint">
                <div className="h-5 border-l border-dashed border-border-strong" />
                <Clock className="size-3" /> Wait {s.delayDays} day{s.delayDays === 1 ? "" : "s"}
              </div>
            )}
            <button
              onClick={() => setActive(i)}
              className={cn(
                "group w-full rounded-xl border p-3.5 text-left transition-all",
                i === idx ? cn(accent, "shadow-card ring-3") : "border-border bg-surface hover:border-border-strong",
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn("text-xs font-semibold", i === idx ? (wa ? "text-wa" : "text-primary") : "text-muted")}>
                  {i === 0 ? "First message" : `Follow-up ${i}`}
                </span>
                {!wa && i > 0 && !s.subject.trim() && <Badge tone="violet">Same thread</Badge>}
              </div>
              {wa ? (
                <div className="mt-1 line-clamp-3 text-[13px] text-muted">{s.body || "Empty"}</div>
              ) : (
                <>
                  <div className="mt-1 truncate text-[13px] font-medium">{s.subject || (i > 0 ? "Re: (previous subject)" : "No subject")}</div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-faint">{s.body || "Empty"}</div>
                </>
              )}
            </button>
          </div>
        ))}
        <Button variant="secondary" className="mt-3 w-full" icon={<Plus className="size-4" />} onClick={addStep} disabled={steps.length >= 10}>
          Add follow-up
        </Button>
      </div>

      {/* Editor + preview */}
      <div className="grid gap-6 2xl:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold">Step {idx + 1}</h3>
            {idx > 0 && (
              <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" />} onClick={() => removeStep(idx)}>
                Remove
              </Button>
            )}
          </div>

          {idx > 0 && (
            <div className="mb-4">
              <Label hint="after the previous step, if no reply">Wait</Label>
              <div className="flex items-center gap-2">
                <Input type="number" min={1} max={60} className="w-24" value={step.delayDays} onChange={(e) => update({ delayDays: Math.max(1, Number(e.target.value) || 1) })} />
                <span className="text-sm text-muted">days</span>
              </div>
            </div>
          )}

          {!wa && (
          <div className="mb-4">
            <Label hint={idx > 0 ? "leave empty to reply in the same thread" : undefined}>Subject</Label>
            <Input
              ref={subjectRef}
              value={step.subject}
              onFocus={() => setFocus("subject")}
              onChange={(e) => update({ subject: e.target.value })}
              placeholder={idx > 0 ? "Re: (keeps the conversation in one thread)" : "Quick question about {{company}}"}
            />
          </div>
          )}

          <div>
            <Label hint={wa ? `${step.body.length} characters · keep it short and personal` : undefined}>{wa ? "Message" : "Body"}</Label>
            <Textarea
              ref={bodyRef}
              rows={wa ? 9 : 13}
              value={step.body}
              onFocus={() => setFocus("body")}
              onChange={(e) => update({ body: e.target.value })}
              placeholder={wa ? "Hi {{first_name}} 👋 …" : "Hi {{first_name}},\n\n…"}
              className="font-[inherit] text-[14px]"
            />
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
              <Sparkles className="size-3.5 text-primary" /> Insert variable into {focus}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {vars.map((v) => (
                <button
                  key={v}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(v)}
                  className="rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-[11px] text-muted transition hover:border-primary/40 hover:bg-primary-soft hover:text-primary"
                >
                  {v}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-faint">
              Fallback: <code className="text-muted">{"{{first_name|there}}"}</code> · Spintax (random pick per lead): <code className="text-muted">{"{Hi|Hey|Hello}"}</code>
              {wa && (
                <>
                  {" "}
                  · WhatsApp formatting: <code className="text-muted">*bold*</code> <code className="text-muted">_italic_</code>. Varying your wording with
                  spintax keeps messages from looking automated.
                </>
              )}
            </p>
          </div>
        </Card>

        {wa ? (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Eye className="size-4 text-muted" /> What the lead sees
              </span>
              {sheet && sheet.sample.length > 1 && (
                <div className="flex items-center gap-1">
                  {sheet.sample.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setPreviewRow(i)}
                      className={cn("size-6 rounded-md text-xs font-medium", i === previewRow ? "bg-wa text-white" : "text-muted hover:bg-surface-2")}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <WhatsAppPreview contactName={contactName} messages={waMessages} typing />
            <p className="mt-3 text-center text-xs text-faint">Sniper shows “typing…” for as long as a person would take to type each message.</p>
          </div>
        ) : (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Eye className="size-4 text-muted" /> Preview
            </span>
            {sheet && sheet.sample.length > 1 && (
              <div className="flex items-center gap-1">
                {sheet.sample.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setPreviewRow(i)}
                    className={cn("size-6 rounded-md text-xs font-medium", i === previewRow ? "bg-primary text-white" : "text-muted hover:bg-surface-2")}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2 border-b border-border px-5 py-3 text-[13px]">
            <div className="flex gap-2">
              <span className="w-14 text-faint">From</span>
              <span className="truncate">
                {sampleVars.sender_name} <span className="text-faint">&lt;{sampleVars.sender_email || "your inbox"}&gt;</span>
              </span>
            </div>
            <div className="flex gap-2">
              <span className="w-14 text-faint">To</span>
              <span className="truncate">{sampleVars.email || "lead@company.com"}</span>
            </div>
            <div className="flex gap-2">
              <span className="w-14 text-faint">Subject</span>
              <span className="truncate font-medium">{previewSubject || <span className="text-faint">—</span>}</span>
            </div>
          </div>
          <div className="bg-white px-5 py-5 dark:bg-[#f9fafb]">
            {previewBody ? (
              <div dangerouslySetInnerHTML={{ __html: textToHtml(previewBody) }} />
            ) : (
              <p className="text-sm text-gray-400">Start writing to see a preview…</p>
            )}
            {c.unsubscribeFooter && c.unsubscribeText && (
              <p className="mt-4 text-xs text-gray-500" style={{ fontFamily: "Arial, sans-serif" }}>
                {render(c.unsubscribeText, sampleVars)}
              </p>
            )}
          </div>
        </Card>
        )}
      </div>
    </div>
  );
}
