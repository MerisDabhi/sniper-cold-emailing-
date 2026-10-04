"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronDown, Inbox as InboxIcon, MailOpen, RefreshCw, Search, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api, pollWhileVisible, timeAgo } from "@/lib/client";
import { LABELS, LABEL_META, type ReplyLabel } from "@/lib/labels";
import { Avatar, Badge, Button, cn, Empty, Spinner } from "@/components/ui";
import { ChannelIcon, type ChannelKind } from "@/components/Channel";

type Conversation = {
  id: string;
  contact: string;
  name: string;
  company: string;
  channel: ChannelKind;
  campaign: string;
  sender: string;
  subject: string;
  status: string;
  label: ReplyLabel;
  labelManual: boolean;
  unread: boolean;
  lastReplyAt: number;
  preview: string;
};
type List = { total: number; page: number; pages: number; counts: Record<string, number>; conversations: Conversation[] };
type Message = { id: string; fromMe: boolean; from: string; to: string; subject: string; date: number; text: string; quoted?: string };
type Thread = {
  lead: { id: string; contact: string; name: string; company: string; status: string; label: ReplyLabel; labelManual: boolean; data: Record<string, string> };
  channel: ChannelKind;
  campaign: string;
  sender: string;
  subject: string;
  messages: Message[];
  warning?: string;
};

const QUICK = ["Thanks for getting back to me! When would be a good time for a quick call?", "Sure — here are the details:", "No problem at all, thanks for letting me know."];

const when = (ts: number) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ts));

/** Reply snippets come from Gmail HTML-escaped and with the quoted original attached — tidy them for the list. */
function cleanPreview(text: string) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+On (Mon|Tue|Wed|Thu|Fri|Sat|Sun|\d|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[\s\S]*$/, "")
    .trim();
}

function LabelBadge({ label, className }: { label: ReplyLabel; className?: string }) {
  const meta = LABEL_META[label] || LABEL_META.replied;
  return (
    <Badge tone={meta.tone} dot className={className}>
      {meta.name}
    </Badge>
  );
}

export default function InboxPage() {
  const [filter, setFilter] = useState<"all" | "unread" | ReplyLabel>("all");
  const [q, setQ] = useState("");
  const [list, setList] = useState<List | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [labelMenu, setLabelMenu] = useState(false);
  const seenUnread = useRef<Set<string> | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (filter === "unread") p.set("unread", "1");
    else if (filter !== "all") p.set("label", filter);
    if (q.trim()) p.set("q", q.trim());
    return p.toString();
  }, [filter, q]);

  const loadList = useCallback(async () => {
    try {
      const data = await api<List>(`/api/inbox/conversations?${query}`);
      setList(data);
      // Announce replies that arrived while the page was open.
      const unread = data.conversations.filter((c) => c.unread);
      if (seenUnread.current) {
        for (const c of unread) {
          if (!seenUnread.current.has(c.id + c.lastReplyAt)) toast.success(`New reply from ${c.name || c.contact}`, { description: cleanPreview(c.preview).slice(0, 90) || undefined });
        }
      }
      seenUnread.current = new Set(unread.map((c) => c.id + c.lastReplyAt));
    } catch (err) {
      if (!list) toast.error((err as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const loadThread = useCallback(async (id: string, quiet = false) => {
    if (!quiet) setThreadLoading(true);
    try {
      const data = await api<Thread>(`/api/inbox/thread/${id}`);
      setThread((prev) => (quiet && prev && prev.lead.id !== id ? prev : data));
    } catch (err) {
      if (!quiet) toast.error((err as Error).message);
    } finally {
      if (!quiet) setThreadLoading(false);
    }
  }, []);

  // Live list: refresh every 8 seconds while the tab is visible.
  useEffect(() => {
    seenUnread.current = null;
    const t = setTimeout(loadList, q ? 300 : 0);
    const stop = pollWhileVisible(loadList, 8000);
    return () => {
      clearTimeout(t);
      stop();
    };
  }, [loadList, q]);

  // Live conversation: refresh the open one every 15 seconds.
  useEffect(() => {
    if (!selected) return;
    setThread(null);
    setDraft("");
    loadThread(selected).then(loadList);
    return pollWhileVisible(() => loadThread(selected, true), 15000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, loadThread]);

  const messageCount = thread?.messages.length || 0;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messageCount, selected]);

  async function setLabel(label: ReplyLabel | "") {
    if (!thread) return;
    setLabelMenu(false);
    try {
      await api(`/api/inbox/thread/${thread.lead.id}`, { method: "PATCH", body: { label } });
      if (label) setThread({ ...thread, lead: { ...thread.lead, label, labelManual: true } });
      else await loadThread(thread.lead.id, true);
      loadList();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function markUnread() {
    if (!thread) return;
    await api(`/api/inbox/thread/${thread.lead.id}`, { method: "PATCH", body: { read: false } }).catch(() => {});
    setSelected(null);
    setThread(null);
    loadList();
  }

  async function send() {
    if (!thread || !draft.trim() || sending) return;
    setSending(true);
    try {
      await api(`/api/inbox/thread/${thread.lead.id}/reply`, { body: { text: draft.trim() } });
      setDraft("");
      toast.success("Reply sent");
      await loadThread(thread.lead.id, true);
      loadList();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  const counts = list?.counts || {};
  const chips: { key: "all" | "unread" | ReplyLabel; name: string }[] = [
    { key: "all", name: "All" },
    { key: "unread", name: "Unread" },
    ...LABELS.filter((l) => counts[l]).map((l) => ({ key: l, name: LABEL_META[l].name })),
  ];
  const firstName = thread?.lead.data.first_name || thread?.lead.name.split(" ")[0] || "";

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-[480px] flex-col lg:h-[calc(100dvh-4rem)]">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Inbox</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            Live — replies from every inbox and WhatsApp number, labelled automatically.
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={<RefreshCw className="size-3.5" />} onClick={loadList}>
          Refresh
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-surface shadow-card">
        {/* Conversation list */}
        <div className={cn("flex w-full min-w-0 flex-col border-border md:w-[360px] md:shrink-0 md:border-r", selected && "hidden md:flex")}>
          <div className="space-y-2.5 border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, company, email…"
                className="h-9 w-full rounded-lg border border-border-strong bg-surface pr-3 pl-9 text-sm placeholder:text-faint focus:border-primary focus:ring-3 focus:ring-primary/15 focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setFilter(c.key)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                    filter === c.key ? "border-primary bg-primary-soft text-primary" : "border-border text-muted hover:bg-surface-2 hover:text-text",
                  )}
                >
                  {c.name}
                  <span className={cn("tabular-nums", filter === c.key ? "text-primary/70" : "text-faint")}>{counts[c.key] || 0}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!list ? (
              <div className="grid h-40 place-items-center">
                <Spinner />
              </div>
            ) : list.conversations.length === 0 ? (
              <div className="px-6 py-14 text-center text-sm text-faint">
                {q || filter !== "all" ? "No conversations match." : "No replies yet. When a lead answers, the conversation appears here."}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {list.conversations.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => setSelected(c.id)}
                      className={cn("flex w-full gap-3 px-3.5 py-3 text-left transition-colors hover:bg-surface-2", selected === c.id && "bg-primary-soft/60 hover:bg-primary-soft/60")}
                    >
                      <div className="relative shrink-0 self-start">
                        <Avatar name={c.name || c.contact} size={36} />
                        <span className="absolute -right-1 -bottom-1 rounded-full ring-2 ring-surface">
                          <ChannelIcon channel={c.channel} size="sm" className="!size-4 !rounded-full [&_svg]:!size-2.5" />
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className={cn("truncate text-sm", c.unread ? "font-semibold" : "font-medium")}>{c.name || c.contact}</span>
                          <span className={cn("ml-auto shrink-0 text-[11px]", c.unread ? "font-medium text-primary" : "text-faint")}>{timeAgo(c.lastReplyAt)}</span>
                        </div>
                        <div className="truncate text-xs text-faint">{c.company || c.contact}</div>
                        <div className={cn("mt-1 line-clamp-2 text-[13px] leading-snug", c.unread ? "text-text" : "text-muted")}>{cleanPreview(c.preview) || c.subject || "—"}</div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <LabelBadge label={c.label} className="!px-1.5 !py-0 !text-[11px]" />
                          {c.unread && <span className="ml-auto size-2 rounded-full bg-primary" />}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Conversation */}
        <div className={cn("min-w-0 flex-1 flex-col", selected ? "flex" : "hidden md:flex")}>
          {!selected ? (
            <div className="grid flex-1 place-items-center">
              <Empty icon={<InboxIcon className="size-6" />} title="Select a conversation" description="Read the whole thread and reply without leaving Sniper." />
            </div>
          ) : !thread || threadLoading ? (
            <div className="grid flex-1 place-items-center">
              <Spinner />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                <button className="rounded-md p-1 text-muted hover:bg-surface-2 md:hidden" onClick={() => setSelected(null)}>
                  <ArrowLeft className="size-5" />
                </button>
                <Avatar name={thread.lead.name || thread.lead.contact} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {thread.lead.name || thread.lead.contact}
                    {thread.lead.company && <span className="font-normal text-muted"> · {thread.lead.company}</span>}
                  </div>
                  <div className="truncate text-xs text-faint">
                    {thread.lead.contact} · {thread.campaign} · via {thread.sender}
                  </div>
                </div>
                <div className="relative">
                  <button onClick={() => setLabelMenu((m) => !m)} className="flex items-center gap-1 rounded-lg p-1 hover:bg-surface-2">
                    <LabelBadge label={thread.lead.label} />
                    <ChevronDown className="size-3.5 text-faint" />
                  </button>
                  {labelMenu && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setLabelMenu(false)} />
                      <div className="animate-fade-up absolute top-full right-0 z-20 mt-1 w-52 rounded-lg border border-border bg-surface p-1 shadow-pop">
                        {LABELS.map((l) => (
                          <button key={l} onClick={() => setLabel(l)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2">
                            <LabelBadge label={l} />
                            {thread.lead.label === l && <Check className="ml-auto size-3.5 text-primary" />}
                          </button>
                        ))}
                        <div className="my-1 border-t border-border" />
                        <button onClick={() => setLabel("")} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted hover:bg-surface-2">
                          <Sparkles className="size-3.5" /> Label automatically
                          {!thread.lead.labelManual && <Check className="ml-auto size-3.5 text-primary" />}
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <button title="Mark as unread" onClick={markUnread} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text">
                  <MailOpen className="size-4" />
                </button>
              </div>

              <div className={cn("min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4", thread.channel === "whatsapp" ? "bg-wa-chat" : "bg-bg")}>
                {thread.warning && <div className="rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning">{thread.warning}</div>}
                {thread.subject && thread.channel === "email" && <div className="text-center text-xs font-medium text-faint">{thread.subject}</div>}
                {thread.messages.length === 0 && !thread.warning && <div className="py-10 text-center text-sm text-faint">No messages to show.</div>}
                {thread.messages.map((m) => (
                  <div key={m.id} className={cn("flex", m.fromMe ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm shadow-card lg:max-w-[70%]",
                        m.fromMe
                          ? thread.channel === "whatsapp"
                            ? "rounded-br-md bg-wa-bubble text-text"
                            : "rounded-br-md bg-primary text-white"
                          : "rounded-bl-md border border-border bg-surface",
                      )}
                    >
                      <div className="leading-relaxed break-words whitespace-pre-wrap">{m.text}</div>
                      {m.quoted && (
                        <details className={cn("mt-1.5 text-xs", m.fromMe && thread.channel === "email" ? "text-white/70" : "text-faint")}>
                          <summary className="cursor-pointer select-none">Show quoted text</summary>
                          <div className="mt-1 break-words whitespace-pre-wrap">{m.quoted}</div>
                        </details>
                      )}
                      <div className={cn("mt-1 text-right text-[11px]", m.fromMe && thread.channel === "email" ? "text-white/70" : "text-faint")}>{when(m.date)}</div>
                    </div>
                  </div>
                ))}
                <div ref={bottom} />
              </div>

              <div className="border-t border-border p-3">
                <div className="mb-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
                  {QUICK.map((t) => (
                    <button
                      key={t}
                      onClick={() => setDraft((firstName ? `Hi ${firstName},\n\n` : "") + t)}
                      className="max-w-[240px] shrink-0 truncate rounded-full border border-border px-2.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text"
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
                    }}
                    rows={Math.min(8, Math.max(2, draft.split("\n").length))}
                    placeholder="Write a reply…  Ctrl + Enter to send"
                    className="min-h-[44px] flex-1 resize-none [scrollbar-width:thin] rounded-lg border border-border-strong bg-surface px-3 py-2.5 text-sm leading-relaxed placeholder:text-faint focus:border-primary focus:ring-3 focus:ring-primary/15 focus:outline-none"
                  />
                  <Button onClick={send} loading={sending} disabled={!draft.trim()} variant={thread.channel === "whatsapp" ? "success" : "primary"} icon={<Send className="size-4" />}>
                    Send
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
