// Sniper mobile API — runs on Supabase Edge Functions, so the phone app works without the laptop.
// Routes (under /functions/v1/mobile):
//   POST /login                    { username, password } → { token }
//   GET  /me                       workspace info
//   GET  /analytics?channel&tz     dashboard numbers
//   GET  /conversations?filter&q&page
//   GET  /thread/:leadId
//   POST /thread/:leadId/reply     { text }
//   POST /thread/:leadId/label     { label }  ("" = back to automatic)
//   POST /thread/:leadId/read      { read }
//   GET  /notifications?since=ms   new replies, for phone notifications
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  accessToken,
  errorMessage,
  fail,
  id,
  json,
  leadLabel,
  leadName,
  readThread,
  sb,
  secret,
  sendGmail,
  signToken,
  verifyPassword,
  verifyToken,
} from "../_shared/core.ts";

const DAY = 86_400_000;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const at = parts.indexOf("mobile");
  const route = at >= 0 ? parts.slice(at + 1) : parts;
  try {
    if (req.method === "POST" && route[0] === "login") return await login(req);
    const user = await verifyToken(req);
    if (!user) return fail("Not signed in", 401);

    if (req.method === "GET" && route[0] === "me") return await me();
    if (req.method === "GET" && route[0] === "analytics") return await analytics(url);
    if (req.method === "GET" && route[0] === "conversations") return await conversations(url);
    if (req.method === "GET" && route[0] === "notifications") return await notifications(url);
    if (route[0] === "thread" && route[1]) {
      if (req.method === "GET" && route.length === 2) return await thread(route[1]);
      if (req.method === "POST" && route[2] === "reply") return await reply(route[1], req);
      if (req.method === "POST" && route[2] === "label") return await setLabel(route[1], req);
      if (req.method === "POST" && route[2] === "read") return await setRead(route[1], req);
    }
    return fail("Not found", 404);
  } catch (err) {
    console.error(err);
    return fail(errorMessage(err), 500);
  }
});

// ─── Login (same username/password as the web app, with lockout) ───────────

async function login(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "mobile";
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const [perIp, global] = await Promise.all([
    sb().from("login_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).gte("at", since),
    sb().from("login_attempts").select("id", { count: "exact", head: true }).gte("at", since),
  ]);
  if ((perIp.count ?? 0) >= 10 || (global.count ?? 0) >= 50) return fail("Too many failed attempts. Try again in 15 minutes.", 429);

  const { username, password } = await req.json().catch(() => ({}));
  const okUser = typeof username === "string" && username.trim().toLowerCase() === (await secret("app_username")).toLowerCase();
  const ok = okUser && typeof password === "string" && verifyPassword(password, await secret("app_password_hash"));
  if (!ok) {
    await sb().from("login_attempts").insert({ ip });
    await new Promise((r) => setTimeout(r, 800));
    return fail("Wrong username or password", 401);
  }
  await sb().from("login_attempts").delete().eq("ip", ip);
  return json({ token: await signToken(username.trim()) });
}

async function me() {
  const { data } = await sb().from("owner").select("email, name").maybeSingle();
  return json({ owner: data });
}

// ─── Analytics ─────────────────────────────────────────────────────────────

type Rollup = Record<string, number | string>;

function summarize(rows: Rollup[]) {
  const sum = (k: string) => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0);
  const contacted = sum("contacted");
  const pct = (n: number) => (contacted ? Math.round((n / contacted) * 1000) / 10 : 0);
  return {
    leads: sum("leads"),
    sent: sum("sent"),
    contacted,
    replied: sum("replied"),
    opened: sum("opened"),
    bounced: sum("bounced"),
    unsubscribed: sum("unsubscribed"),
    replyRate: pct(sum("replied")),
    openRate: pct(sum("opened")),
    bounceRate: pct(sum("bounced")),
    unsubRate: pct(sum("unsubscribed")),
  };
}

async function analytics(url: URL) {
  const channel = url.searchParams.get("channel");
  let tz = url.searchParams.get("tz") || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  const now = Date.now();
  const [{ data: campaigns }, { data: rollup }, { data: accounts }, { data: wa }] = await Promise.all([
    sb().from("campaigns").select("id, channel, status"),
    sb().from("lead_rollup").select("*"),
    sb().from("accounts").select("id, email, name, status, daily_limit"),
    sb().from("wa_accounts").select("id, label, phone, name, status, paused, daily_limit"),
  ]);
  const chosen = (campaigns || []).filter((c) => !channel || c.channel === channel);
  const ids = new Set(chosen.map((c) => c.id));
  const { data: events } = ids.size
    ? await sb().from("events").select("type, at, account_id").in("campaign_id", [...ids]).gte("at", now - 31 * DAY).limit(20000)
    : { data: [] as { type: string; at: number; account_id: string }[] };

  const sentByAccount = new Map<string, number>();
  for (const e of events || []) if (e.type === "sent" && e.at > now - DAY) sentByAccount.set(e.account_id, (sentByAccount.get(e.account_id) || 0) + 1);

  // Day buckets in the phone's timezone.
  const dayKey = (ts: number) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
  const daily: { date: string; label: string; sent: number; replies: number }[] = [];
  const index = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    const ts = now - i * DAY;
    const key = dayKey(ts);
    if (index.has(key)) continue;
    index.set(key, daily.length);
    daily.push({ date: key, label: new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(new Date(ts)), sent: 0, replies: 0 });
  }
  for (const e of events || []) {
    const i = index.get(dayKey(e.at));
    if (i === undefined) continue;
    if (e.type === "sent") daily[i].sent++;
    else if (e.type === "reply") daily[i].replies++;
  }

  const senders = [
    ...(channel === "whatsapp" ? [] : (accounts || []).map((a) => ({
      id: a.id,
      email: a.email,
      name: a.name,
      channel: "email",
      status: a.status,
      dailyLimit: a.daily_limit,
      sentToday: sentByAccount.get(a.id) || 0,
    }))),
    ...(channel === "email" ? [] : (wa || []).map((a) => ({
      id: a.id,
      email: a.phone ? `+${a.phone}` : a.label || "WhatsApp",
      name: a.name || a.label,
      channel: "whatsapp",
      status: a.status === "connected" ? (a.paused ? "paused" : "active") : "error",
      dailyLimit: a.daily_limit,
      sentToday: sentByAccount.get(a.id) || 0,
    }))),
  ];
  return json({
    totals: summarize((rollup || []).filter((r) => ids.has(r.campaign_id as string))),
    sentToday: (events || []).filter((e) => e.type === "sent" && e.at > now - DAY).length,
    capacity: senders.filter((s) => s.status === "active").reduce((n, s) => n + (s.dailyLimit || 0), 0),
    daily,
    accounts: senders,
  });
}

// ─── Conversations ─────────────────────────────────────────────────────────

const LABELS = ["interested", "meeting_booked", "not_interested", "out_of_office", "auto_reply", "wrong_person", "replied"];
const isUnread = (l: { last_reply_at?: number | null; read_at?: number | null }) => !!l.last_reply_at && Number(l.last_reply_at) > Number(l.read_at || 0);

async function conversations(url: URL) {
  const filter = url.searchParams.get("filter") === "replies" ? "replies" : "sent";
  const label = url.searchParams.get("label") || "";
  const q = (url.searchParams.get("q") || "").replace(/[,()*%\\:"']/g, " ").trim().slice(0, 80);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const size = 30;
  let query = sb().from("leads").select("*", { count: "exact" }).gt("step_index", 0);
  query = filter === "replies"
    ? query.not("replied_at", "is", null).order("last_reply_at", { ascending: false, nullsFirst: false })
    : query.order("last_sent_at", { ascending: false, nullsFirst: false });
  if (LABELS.includes(label)) query = query.eq("label", label);
  if (q) {
    query = query.or(["email", "phone", "first_subject", "data->>first_name", "data->>last_name", "data->>company"].map((f) => `${f}.ilike.*${q}*`).join(","));
  }
  const { data: leads, count, error } = await query.range((page - 1) * size, page * size - 1);
  if (error) return fail(error.message, 500);
  // How many conversations carry each label, for the filter chips.
  const { data: labelled } = await sb().from("leads").select("label, last_reply_at, read_at").not("replied_at", "is", null).limit(5000);
  const counts: Record<string, number> = { all: 0, unread: 0 };
  for (const l of labelled || []) {
    counts.all++;
    if (isUnread(l)) counts.unread++;
    const key = l.label || "replied";
    counts[key] = (counts[key] || 0) + 1;
  }

  const replied = (leads || []).filter((l) => l.replied_at).map((l) => l.id);
  const [{ data: replies }, { data: campaigns }, { data: accounts }, { data: wa }] = await Promise.all([
    replied.length
      ? sb().from("events").select("lead_id, detail, at").eq("type", "reply").in("lead_id", replied).order("at", { ascending: false })
      : Promise.resolve({ data: [] as { lead_id: string; detail: string | null }[] }),
    sb().from("campaigns").select("id, name, channel"),
    sb().from("accounts").select("id, email"),
    sb().from("wa_accounts").select("id, phone, label"),
  ]);
  const lastReply = new Map<string, string>();
  for (const r of replies || []) if (!lastReply.has(r.lead_id)) lastReply.set(r.lead_id, r.detail || "");
  const campaign = new Map((campaigns || []).map((c) => [c.id, c]));
  const sender = new Map<string, string>([
    ...(accounts || []).map((a) => [a.id, a.email] as [string, string]),
    ...(wa || []).map((a) => [a.id, a.phone ? `+${a.phone}` : a.label] as [string, string]),
  ]);
  const total = count ?? 0;
  return json({
    total,
    page,
    pages: Math.max(1, Math.ceil(total / size)),
    counts,
    conversations: (leads || []).map((l) => ({
      label: l.replied_at ? l.label || "replied" : "",
      unread: isUnread(l),
      lastReplyAt: l.last_reply_at,
      id: l.id,
      contact: leadLabel(l),
      name: leadName(l.data),
      company: l.data?.company || "",
      channel: campaign.get(l.campaign_id)?.channel || "email",
      campaign: campaign.get(l.campaign_id)?.name || "",
      sender: sender.get(l.account_id) || "",
      subject: l.first_subject || "",
      status: l.status,
      step: l.step_index,
      lastSentAt: l.last_sent_at,
      repliedAt: l.replied_at,
      preview: lastReply.get(l.id) || "",
    })),
  });
}

// ─── One conversation ──────────────────────────────────────────────────────

async function loadLead(leadId: string) {
  const { data: lead } = await sb().from("leads").select("*").eq("id", leadId).maybeSingle();
  if (!lead) return null;
  const { data: campaign } = await sb().from("campaigns").select("name, channel").eq("id", lead.campaign_id).maybeSingle();
  return { lead, campaign };
}

async function thread(leadId: string) {
  const found = await loadLead(leadId);
  if (!found) return fail("Conversation not found", 404);
  const { lead, campaign } = found;
  const channel = campaign?.channel || "email";
  let messages: unknown[] = [];
  let sender = "";
  let warning: string | undefined;

  if (channel === "email") {
    const { data: account } = await sb().from("accounts").select("id, email, tokens").eq("id", lead.account_id).maybeSingle();
    sender = account?.email || "";
    if (account && lead.thread_id) {
      try {
        messages = await readThread(await accessToken("accounts", account.id, account.tokens), lead.thread_id, account.email);
      } catch (err) {
        warning = `Couldn't load the Gmail thread: ${errorMessage(err)}`;
      }
    }
  } else {
    const { data: wa } = await sb().from("wa_accounts").select("phone, label").eq("id", lead.account_id).maybeSingle();
    sender = wa?.phone ? `+${wa.phone}` : wa?.label || "";
    const { data: events } = await sb().from("events").select("id, type, at, detail").eq("lead_id", lead.id).in("type", ["sent", "reply", "manual"]).order("at");
    messages = (events || []).map((e) => ({
      id: e.id,
      fromMe: e.type !== "reply",
      from: e.type !== "reply" ? sender : leadLabel(lead),
      to: e.type !== "reply" ? leadLabel(lead) : sender,
      subject: "",
      date: e.at,
      text: e.detail || "",
    }));
  }
  // Opening a conversation marks it as read.
  if (isUnread(lead)) await sb().from("leads").update({ read_at: Date.now() }).eq("id", lead.id);
  return json({
    lead: {
      id: lead.id,
      contact: leadLabel(lead),
      name: leadName(lead.data),
      company: lead.data?.company || "",
      status: lead.status,
      repliedAt: lead.replied_at,
      label: lead.replied_at ? lead.label || "replied" : "",
    },
    channel,
    campaign: campaign?.name || "",
    sender,
    subject: lead.first_subject || "",
    messages,
    warning,
  });
}

async function setLabel(leadId: string, req: Request) {
  const { label } = await req.json().catch(() => ({}));
  if (label && !LABELS.includes(label)) return fail("Unknown label");
  // An empty label hands the conversation back to automatic labelling.
  const patch = label ? { label, label_manual: true } : { label_manual: false };
  const { error } = await sb().from("leads").update(patch).eq("id", leadId);
  if (error) return fail(error.message, 500);
  return json({ label: label || null });
}

async function setRead(leadId: string, req: Request) {
  const { read } = await req.json().catch(() => ({}));
  const { error } = await sb().from("leads").update({ read_at: read === false ? 0 : Date.now() }).eq("id", leadId);
  if (error) return fail(error.message, 500);
  return json({ read: read !== false });
}

async function reply(leadId: string, req: Request) {
  const { text: raw } = await req.json().catch(() => ({}));
  const text = String(raw || "").trim();
  if (!text) return fail("Write a message first");
  if (text.length > 10_000) return fail("That message is too long");
  const found = await loadLead(leadId);
  if (!found) return fail("Conversation not found", 404);
  const { lead, campaign } = found;

  if (campaign?.channel === "whatsapp") {
    const { data: wa } = await sb().from("wa_accounts").select("id, status").eq("id", lead.account_id).maybeSingle();
    if (!wa || wa.status !== "connected") return fail("This WhatsApp number isn't connected right now");
    const { data: lease } = await sb().from("workers").select("lease_until").eq("name", "whatsapp").maybeSingle();
    if (!lease || new Date(lease.lease_until).getTime() < Date.now()) return fail("The WhatsApp worker is offline, so WhatsApp messages can't be sent right now.");
    const cmdId = id("cmd_");
    const { error } = await sb().from("wa_commands").insert({ id: cmdId, account_id: wa.id, type: "test", payload: { to: `+${lead.phone}`, text } });
    if (error) return fail(error.message, 500);
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const { data: cmd } = await sb().from("wa_commands").select("status, result").eq("id", cmdId).single();
      if (cmd?.status === "failed") return fail(cmd.result || "Sending failed");
      if (cmd?.status === "done") break;
    }
    // WhatsApp history isn't readable later, so keep what you wrote for the conversation view.
    await sb().from("events").insert({ id: id("e_"), type: "manual", at: Date.now(), campaign_id: lead.campaign_id, account_id: wa.id, lead_id: lead.id, email: leadLabel(lead), detail: text.slice(0, 4000) });
  } else {
    const { data: account } = await sb().from("accounts").select("id, email, name, signature, tokens").eq("id", lead.account_id).maybeSingle();
    if (!account) return fail("The inbox that emailed this lead is no longer connected");
    if (!lead.email) return fail("This lead has no email address");
    const token = await accessToken("accounts", account.id, account.tokens);
    const messages = lead.thread_id ? await readThread(token, lead.thread_id, account.email) : [];
    const last = messages[messages.length - 1];
    const base = String(lead.first_subject || messages[0]?.subject || "").replace(/^(re:\s*)+/i, "");
    const full = account.signature?.trim() ? `${text}\n\n${account.signature.trim()}` : text;
    await sendGmail(token, {
      fromName: account.name || account.email,
      fromEmail: account.email,
      to: lead.email,
      subject: base ? `Re: ${base}` : "Re:",
      text: full,
      threadId: lead.thread_id || undefined,
      inReplyTo: last?.messageIdHeader,
    });
  }
  // You're talking to them yourself now — stop automatic follow-ups.
  await sb().from("leads").update({ status: "completed" }).eq("id", lead.id).in("status", ["pending", "in_progress"]);
  await sb().from("leads").update({ read_at: Date.now() }).eq("id", lead.id);
  return json({ sent: true });
}

// ─── Notifications ─────────────────────────────────────────────────────────

async function notifications(url: URL) {
  const since = Math.max(0, Number(url.searchParams.get("since")) || Date.now() - DAY);
  const { data: events } = await sb().from("events").select("id, at, lead_id, campaign_id, email, detail").eq("type", "reply").gt("at", since).order("at", { ascending: false }).limit(50);
  const leadIds = (events || []).map((e) => e.lead_id).filter(Boolean);
  const [{ data: leads }, { data: campaigns }] = await Promise.all([
    leadIds.length ? sb().from("leads").select("id, data, label").in("id", leadIds) : Promise.resolve({ data: [] as { id: string; data: Record<string, string>; label: string | null }[] }),
    sb().from("campaigns").select("id, name, channel"),
  ]);
  const lead = new Map((leads || []).map((l) => [l.id, l]));
  const campaign = new Map((campaigns || []).map((c) => [c.id, c]));
  return json({
    now: Date.now(),
    replies: (events || []).map((e) => ({
      id: e.id,
      at: e.at,
      leadId: e.lead_id,
      contact: e.email,
      name: leadName(lead.get(e.lead_id)?.data || null),
      company: lead.get(e.lead_id)?.data?.company || "",
      label: lead.get(e.lead_id)?.label || "replied",
      channel: campaign.get(e.campaign_id)?.channel || "email",
      campaign: campaign.get(e.campaign_id)?.name || "",
      text: e.detail || "",
    })),
  });
}
