import "server-only";
import { db, fetchLeads, id, pushEvent, sb, token } from "./db";
import { checkThread, errorMessage, findSentTo, getSheetRows, isAuthError, sendGmail } from "./google";
import { publicUrl } from "./url";
import { EMAIL_RE, leadVariables, render, textToHtml } from "./template";
import { alreadyContacted, claimContact, claimStep, recordStepMessage, releaseContact, releaseStep, syncClaimedLead } from "./dedupe";
import { leadMatch, queueSheetStatus, stamp } from "./sheetSync";
import { contactKey, formatPhone, normalizePhone } from "./phone";
import type { Campaign, Channel, GmailAccount, Lead } from "./types";

const DAY = 86_400_000;

// ─── Time helpers ──────────────────────────────────────────────────────────

function zoned(ts: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ts));
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { weekday, hour: Number(get("hour")), day: `${get("year")}-${get("month")}-${get("day")}` };
}

export function inWindow(c: Campaign, now = Date.now()) {
  const z = zoned(now, c.schedule.timezone);
  return c.schedule.days.includes(z.weekday) && z.hour >= c.schedule.startHour && z.hour < c.schedule.endHour;
}

export function dayKey(ts: number, tz: string) {
  return zoned(ts, tz).day;
}

export const rand = (min: number, max: number) => min + Math.random() * Math.max(0, max - min);

/** How a lead is shown in logs, events and the UI. */
export const leadLabel = (lead: Pick<Lead, "email" | "phone">) => (lead.phone ? formatPhone(lead.phone) : lead.email || "");

// ─── Quotas ────────────────────────────────────────────────────────────────

/** Messages sent by an inbox / WhatsApp number in the last 24h (all campaigns) — the hard cap. */
export function accountSentLast24h(accountId: string, now = Date.now()) {
  let n = 0;
  const ev = db().events;
  for (let i = ev.length - 1; i >= 0 && ev[i].at > now - DAY; i--) if (ev[i].type === "sent" && ev[i].accountId === accountId) n++;
  return n;
}

/** Messages a campaign sent today (campaign timezone), optionally for one sender. */
export function campaignSentToday(c: Campaign, accountId?: string, now = Date.now()) {
  const today = dayKey(now, c.schedule.timezone);
  let n = 0;
  const ev = db().events;
  for (let i = ev.length - 1; i >= 0 && ev[i].at > now - 2 * DAY; i--) {
    const e = ev[i];
    if (e.type === "sent" && e.campaignId === c.id && (!accountId || e.accountId === accountId) && dayKey(e.at, c.schedule.timezone) === today) n++;
  }
  return n;
}

/** Sender ids (Gmail inboxes or WhatsApp numbers) that exist for this campaign's channel. */
export function senderIds(c: Campaign) {
  const d = db();
  const pool = c.channel === "whatsapp" ? d.waAccounts.map((a) => a.id) : d.accounts.map((a) => a.id);
  return c.accountIds.filter((x) => pool.includes(x));
}

export function activeSenderIds(c: Campaign) {
  const d = db();
  return c.channel === "whatsapp"
    ? d.waAccounts.filter((a) => c.accountIds.includes(a.id) && a.status === "connected").map((a) => a.id)
    : d.accounts.filter((a) => c.accountIds.includes(a.id) && a.status === "active").map((a) => a.id);
}

/** The daily campaign volume is split evenly over its senders: 200/day over 10 inboxes = 20 each. */
export function perAccountQuota(c: Campaign) {
  const n = Math.max(1, activeSenderIds(c).length || c.accountIds.length);
  return Math.ceil(c.dailyLimit / n);
}

// ─── Lead import ───────────────────────────────────────────────────────────

export async function syncLeads(c: Campaign) {
  const wa = c.channel === "whatsapp";
  const column = wa ? c.mapping?.phone : c.mapping?.email;
  if (!c.sheet || !column) throw new Error(`Connect a sheet and map the ${wa ? "phone" : "email"} column first`);
  const d = db();
  await fetchLeads((q) => q.eq("campaign_id", c.id), { all: true });
  const { headers, rows, rowNumbers } = await getSheetRows(c.sheet.spreadsheetId, c.sheet.tab);
  c.sheet.headers = headers;

  const normalize = (raw: string) => (wa ? normalizePhone(raw, c.countryCode) : EMAIL_RE.test(raw.trim().toLowerCase()) ? raw.trim().toLowerCase() : null);
  const keyOf = (addr: string) => contactKey(wa ? { phone: addr } : { email: addr });

  const existing = new Set(d.leads.filter((l) => l.campaignId === c.id).map((l) => (wa ? l.phone : l.email)));
  const seen = new Set<string>();
  // Contacts that already got a cold message from ANY campaign — never cold-contact them twice.
  const addresses = rows.map((r) => normalize(r[column] || "")).filter((x): x is string => !!x);
  const contacted = await alreadyContacted(addresses.map(keyOf));
  const campaignName = (cid: string) => d.campaigns.find((x) => x.id === cid)?.name || "another campaign";
  const unsub = new Set(d.unsubscribes.map((u) => u.email));
  const senders = senderIds(c);
  if (!senders.length) throw new Error(wa ? "Select at least one WhatsApp number" : "Select at least one sending inbox");

  // Balance new leads onto the sender that currently has the fewest.
  const load = new Map(senders.map((a) => [a, 0]));
  for (const l of d.leads) if (l.campaignId === c.id && load.has(l.accountId)) load.set(l.accountId, load.get(l.accountId)! + 1);

  let added = 0,
    invalid = 0,
    duplicate = 0,
    alreadySent = 0;
  rows.forEach((row, i) => {
    const sheetRow = rowNumbers[i];
    const raw = (row[column] || "").trim();
    const addr = normalize(raw);
    if (!addr) {
      invalid++;
      if (raw) queueSheetStatus(c, { row: sheetRow }, wa ? "Skipped · invalid phone number" : "Skipped · invalid email");
      return;
    }
    if (seen.has(addr)) {
      // The same contact appears again further down the sheet — only the first row is used.
      duplicate++;
      queueSheetStatus(c, { row: sheetRow }, "Skipped · duplicate row");
      return;
    }
    seen.add(addr);
    if (existing.has(addr)) return; // imported by an earlier sync — leave its row and status alone
    const accountId = [...load.entries()].sort((a, b) => a[1] - b[1])[0][0];
    load.set(accountId, load.get(accountId)! + 1);
    const key = keyOf(addr);
    const prior = contacted.get(key);
    const status = unsub.has(key) ? "unsubscribed" : prior ? "duplicate" : "pending";
    d.leads.push({
      id: id("l_"),
      campaignId: c.id,
      ...(wa ? { phone: addr } : { email: addr }),
      data: { ...leadVariables(row, c.mapping), ...(wa ? { phone: formatPhone(addr) } : {}) },
      accountId,
      status,
      stepIndex: 0,
      nextAt: 0,
      token: token(),
      error: prior ? `Already contacted in "${campaignName(prior)}"` : undefined,
    });
    if (status === "duplicate") {
      alreadySent++;
      queueSheetStatus(c, { row: sheetRow }, `Skipped · already contacted (${campaignName(prior!)})`);
    } else if (status === "unsubscribed") {
      queueSheetStatus(c, { row: sheetRow }, "Skipped · unsubscribed");
    } else {
      queueSheetStatus(c, { row: sheetRow }, "Queued");
    }
    added++;
  });
  c.lastSyncedAt = new Date().toISOString();
  if (added > alreadySent && c.status === "completed") c.status = "active";
  return { added, invalid, duplicate, alreadyContacted: alreadySent, total: rows.length };
}

/**
 * Share the not-yet-contacted leads evenly over the campaign's senders. Runs when senders are
 * added or removed, so a new inbox gets its share and nothing stays on a removed one.
 * Leads already in a sequence keep their sender, so follow-ups stay in the same thread.
 */
export async function rebalanceLeads(c: Campaign) {
  const all = senderIds(c);
  const active = activeSenderIds(c).filter((x) => all.includes(x));
  const valid = active.length ? active : all;
  if (!valid.length) return;
  const waiting = await fetchLeads((q) => q.eq("campaign_id", c.id).eq("status", "pending").eq("step_index", 0), { all: true });
  // A lead that is being sent right now (claimed) must stay with the sender that is emailing it.
  const claimed = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb().from("sends").select("lead_id").eq("campaign_id", c.id).eq("step", 0).range(from, from + 999);
    if (error) throw new Error(`Supabase: could not read send claims: ${error.message}`);
    data?.forEach((r) => claimed.add(r.lead_id));
    if (!data || data.length < 1000) break;
  }
  waiting
    .filter((l) => !claimed.has(l.id))
    .forEach((l, i) => {
    const to = valid[i % valid.length];
    if (l.accountId !== to) l.accountId = to;
  });
}

// ─── Shared sending pipeline ───────────────────────────────────────────────

/** Pick the next lead a sender should message: due follow-ups first, then new leads in sheet order. */
/** Campaigns a sender may send for right now: in their sending window and under today's quota. */
export function eligibleCampaigns(accountId: string, campaigns: Campaign[], now: number) {
  return campaigns.filter(
    (c) =>
      c.accountIds.includes(accountId) &&
      inWindow(c, now) &&
      campaignSentToday(c, accountId, now) < perAccountQuota(c) &&
      campaignSentToday(c, undefined, now) < c.dailyLimit,
  );
}

export function pickLead(accountId: string, campaigns: Campaign[], now: number, skip = new Set<string>()): { c: Campaign; lead: Lead } | null {
  const d = db();
  const eligible = eligibleCampaigns(accountId, campaigns, now);
  if (!eligible.length) return null;
  const ids = new Set(eligible.map((c) => c.id));
  let followUp: Lead | null = null;
  let fresh: Lead | null = null;
  for (const l of d.leads) {
    if (l.accountId !== accountId || !ids.has(l.campaignId) || l.nextAt > now || skip.has(l.id)) continue;
    if (l.status === "in_progress") {
      if (!followUp || l.nextAt < followUp.nextAt) followUp = l;
    } else if (l.status === "pending" && !fresh) fresh = l;
  }
  const lead = followUp || fresh;
  return lead ? { c: eligible.find((c) => c.id === lead.campaignId)!, lead } : null;
}

/**
 * Load the next few due leads for each sender into the current unit of work — only from the
 * campaigns that sender may send for right now (window + quota), so a campaign that's outside
 * its hours can never block the others.
 */
export async function loadDueLeads(channel: Channel, senderIdsToLoad: string[], now = Date.now()) {
  const d = db();
  const active = d.campaigns.filter((c) => c.status === "active" && c.channel === channel);
  await Promise.all(
    senderIdsToLoad.map((sid) => {
      const ids = eligibleCampaigns(sid, active, now).map((c) => c.id);
      if (!ids.length) return null;
      return Promise.all([
        fetchLeads((q) => q.eq("account_id", sid).in("campaign_id", ids).eq("status", "in_progress").lte("next_at", now).order("next_at").limit(5)),
        fetchLeads((q) => q.eq("account_id", sid).in("campaign_id", ids).eq("status", "pending").order("seq").limit(5)),
      ]);
    }),
  );
}

/** How many leads a sender may skip past (already contacted, unsubscribed…) in one run. */
export const MAX_SKIPS_PER_RUN = 5;

export type ClaimResult = "ok" | "skip";

/**
 * Pre-send checks shared by email and WhatsApp: unsubscribed, sequence finished, and the two
 * duplicate guards (step claim + one-cold-message-per-contact). "ok" means it's safe to send.
 */
/**
 * What to do with a step that was claimed >10 minutes ago but never recorded (the process was
 * stopped mid-send). Return true if it was actually sent (and has been recorded), false if not.
 * Without a resolver the step is assumed sent — never risk a duplicate.
 */
export type StaleResolver = (c: Campaign, lead: Lead, step: number) => Promise<boolean>;

export async function prepareSend(c: Campaign, lead: Lead, accountId: string, resolveStale?: StaleResolver): Promise<ClaimResult> {
  const d = db();
  if (d.unsubscribes.some((u) => u.email === contactKey(lead))) {
    lead.status = "unsubscribed";
    return "skip";
  }
  if (!c.steps[lead.stepIndex]) {
    lead.status = "completed";
    return "skip";
  }
  const step = lead.stepIndex;
  if (!(await claimStep(lead, step, accountId))) {
    // This step was already claimed — never resend it. Find out what really happened.
    if ((await syncClaimedLead(lead, step)) === "stale") {
      // Stopped mid-send earlier. Check whether it really went out.
      const sent = resolveStale ? await resolveStale(c, lead, step).catch(() => true) : true;
      if (!sent) await releaseClaims(lead, step); // never sent: free it, it's retried next run
      else if (lead.stepIndex === step) advanceLead(c, lead);
    }
    return "skip";
  }
  if (step === 0) {
    const claim = await claimContact(lead, accountId);
    if (!claim.ok) {
      await releaseStep(lead.id, step);
      const other = d.campaigns.find((x) => x.id === claim.campaignId)?.name || "another campaign";
      lead.status = "duplicate";
      lead.error = `Already contacted in "${other}"`;
      pushEvent({ type: "duplicate", campaignId: c.id, accountId, leadId: lead.id, email: leadLabel(lead), detail: lead.error });
      queueSheetStatus(c, { match: leadMatch(lead) }, `Skipped · already contacted (${other})`);
      return "skip";
    }
  }
  return "ok";
}

/**
 * Last check right before a message actually goes out: has the lead replied or unsubscribed
 * in the meantime (e.g. while WhatsApp was showing "typing…")? Returns false if so.
 */
export async function stillSendable(lead: Lead): Promise<boolean> {
  const { data, error } = await sb().from("leads").select("status, replied_at").eq("id", lead.id).maybeSingle();
  if (error || !data) return true; // brand-new lead not saved yet, or a read hiccup: the claims still prevent duplicates
  if (data.replied_at || !["pending", "in_progress"].includes(data.status)) {
    lead.status = data.status;
    if (data.replied_at) lead.repliedAt = Number(data.replied_at);
    return false;
  }
  return true;
}

/** Thrown when a lead stopped being sendable during the send. */
export class SendCancelled extends Error {}

/** Undo the duplicate claims after the provider rejected a message, so it can be retried. */
export async function releaseClaims(lead: Lead, step: number) {
  await releaseStep(lead.id, step);
  if (step === 0) await releaseContact(lead);
}

/** Record a successful send: advance the sequence, log it, update the sheet. */
export function recordSent(c: Campaign, lead: Lead, accountId: string, from: string, detail: string, providerId?: string) {
  const step = lead.stepIndex;
  lead.lastSentAt = Date.now();
  lead.error = undefined;
  advanceLead(c, lead);
  if (providerId) recordStepMessage(lead.id, step, providerId).catch(() => {});
  pushEvent({ type: "sent", campaignId: c.id, accountId, leadId: lead.id, email: leadLabel(lead), step: step + 1, detail });
  queueSheetStatus(
    c,
    { match: leadMatch(lead) },
    lead.status === "completed"
      ? `Sequence done · step ${step + 1}/${c.steps.length} sent ${stamp(c)} · from ${from}`
      : `Sent · step ${step + 1}/${c.steps.length} · ${stamp(c)} · from ${from}`,
  );
  console.log(`[sniper] ${from} → ${leadLabel(lead)} (step ${step + 1}, "${c.name}")`);
}

/** Move a lead past the step it just received. */
export function advanceLead(c: Campaign, lead: Lead) {
  lead.stepIndex++;
  if (lead.stepIndex >= c.steps.length) {
    lead.status = "completed";
  } else {
    lead.status = "in_progress";
    lead.nextAt = Math.round(Date.now() + c.steps[lead.stepIndex].delayDays * DAY);
  }
}

export async function finishCampaigns(channel: Channel) {
  const d = db();
  for (const c of d.campaigns) {
    if (c.status !== "active" || c.channel !== channel) continue;
    // Leads changed in this run aren't saved yet — count them from memory, the rest from the database.
    const local = d.leads.filter((l) => l.campaignId === c.id);
    if (local.some((l) => l.status === "pending" || l.status === "in_progress")) continue;
    const [o, a] = await Promise.all([
      sb()
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", c.id)
        .in("status", ["pending", "in_progress"])
        .not("id", "in", `(${local.map((l) => l.id).join(",") || "_"})`),
      sb().from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", c.id),
    ]);
    if (o.error || a.error) continue;
    if ((o.count ?? 0) === 0 && (a.count ?? 0) > 0) c.status = "completed";
  }
}

// ─── Email ─────────────────────────────────────────────────────────────────

export function composeEmail(c: Campaign, lead: Lead, account: GmailAccount, stepIndex = lead.stepIndex) {
  const step = c.steps[stepIndex];
  const vars: Record<string, string> = {
    ...lead.data,
    sender_name: account.name,
    sender_first_name: account.name.split(" ")[0],
    sender_email: account.email,
  };
  const seed = lead.id + step.id;
  const isFollowUpInThread = stepIndex > 0 && !step.subject.trim() && !!lead.firstSubject;
  const subject = isFollowUpInThread ? `Re: ${lead.firstSubject}` : render(step.subject || c.steps[0].subject, vars, seed);

  let text = render(step.body, vars, seed).trim();
  if (account.signature.trim()) text += `\n\n${render(account.signature, vars, seed).trim()}`;
  let html = textToHtml(text);

  // Unsubscribe links and open tracking need a public domain the recipient can reach.
  const base = publicUrl();
  const IS_PUBLIC = !!base;
  const unsubUrl = `${base}/u/${lead.token}`;
  if (c.unsubscribeFooter && c.unsubscribeText.trim()) {
    const note = render(c.unsubscribeText, vars, seed).trim();
    text += `\n\n${note}${IS_PUBLIC ? ` ${unsubUrl}` : ""}`;
    html += `<div><br></div><div style="font-family:Arial,sans-serif;font-size:12px;color:#888">${note
      .replace(/</g, "&lt;")}${IS_PUBLIC ? ` <a href="${unsubUrl}" style="color:#888">Unsubscribe</a>` : ""}</div>`;
  }
  if (c.trackOpens && IS_PUBLIC) {
    html += `<img src="${base}/api/t/o/${lead.token}" width="1" height="1" alt="" style="display:none">`;
  }

  return {
    subject,
    text,
    html,
    threadId: stepIndex > 0 ? lead.threadId : undefined,
    inReplyTo: stepIndex > 0 && isFollowUpInThread ? lead.firstMessageId : undefined,
    listUnsubscribe: `<mailto:${account.email}?subject=unsubscribe>${IS_PUBLIC ? `, <${base}/api/unsubscribe?t=${lead.token}>` : ""}`,
    oneClick: IS_PUBLIC,
  };
}

async function sendNextEmail(account: GmailAccount, campaigns: Campaign[], now: number) {
  // Leads that turn out to be unsendable (already contacted, unsubscribed…) are skipped and the
  // next one is tried, so a run isn't wasted on them.
  const tried = new Set<string>();
  let pick: { c: Campaign; lead: Lead } | null = null;
  for (let i = 0; i < MAX_SKIPS_PER_RUN; i++) {
    const next = pickLead(account.id, campaigns, now, tried);
    if (!next) return;
    tried.add(next.lead.id);
    try {
      if ((await prepareSend(next.c, next.lead, account.id, (c, lead, step) => resolveStaleEmail(account, c, lead, step))) === "ok") {
        pick = next;
        break;
      }
    } catch (err) {
      // Can't confirm with the database → don't risk a duplicate; try again shortly.
      console.error(`[sniper] dedupe check failed, skipping this round: ${(err as Error).message}`);
      account.nextSendAt = Date.now() + 60_000;
      return;
    }
  }
  if (!pick) return;
  const { c, lead } = pick;
  const step = lead.stepIndex;

  const mail = composeEmail(c, lead, account);
  try {
    if (!(await stillSendable(lead))) {
      await releaseClaims(lead, step);
      return;
    }
    const res = await sendGmail(account, { ...mail, fromName: account.name, fromEmail: account.email, to: lead.email! });
    if (step === 0) {
      lead.firstSubject = mail.subject;
      lead.firstMessageId = res.messageId;
    }
    lead.threadId = lead.threadId || res.threadId;
    recordSent(c, lead, account.id, account.email, mail.subject, res.id);
    account.nextSendAt = Math.round(Date.now() + rand(c.schedule.minGapSec, c.schedule.maxGapSec) * 1000);
  } catch (err) {
    await releaseClaims(lead, step);
    const msg = errorMessage(err);
    if (isAuthError(err)) {
      account.status = "error";
      account.error = `Google access expired or was revoked — reconnect this inbox. (${msg})`;
    } else if (/rate|quota|limit/i.test(msg)) {
      account.nextSendAt = Date.now() + 30 * 60_000; // Gmail throttled us: cool off for 30 minutes
      account.error = msg;
    } else {
      lead.status = "failed";
      lead.error = msg;
      account.nextSendAt = Date.now() + 60_000;
      queueSheetStatus(c, { match: leadMatch(lead) }, `Failed · ${msg.slice(0, 120)}`);
    }
    pushEvent({ type: "error", campaignId: c.id, accountId: account.id, leadId: lead.id, email: leadLabel(lead), detail: msg });
    console.error(`[sniper] send failed ${account.email} → ${lead.email}: ${msg}`);
  }
}

/** An email whose send was interrupted: look in the inbox's Sent folder and record it if it went out. */
async function resolveStaleEmail(account: GmailAccount, c: Campaign, lead: Lead, step: number): Promise<boolean> {
  const found = await findSentTo(account, lead.email!);
  if (!found) return false;
  if (step === 0) {
    lead.firstSubject = found.subject;
    lead.firstMessageId = found.messageId;
  }
  lead.threadId = lead.threadId || found.threadId;
  recordSent(c, lead, account.id, account.email, found.subject || "", found.id);
  lead.lastSentAt = found.at;
  return true;
}

/** One email sender run: at most one email per inbox. Works in "base" or "full" scope. */
export async function tick() {
  const d = db();
  const now = Date.now();
  const campaigns = d.campaigns.filter((c) => c.status === "active" && c.channel === "email");
  if (!campaigns.length) return;
  const busy = d.accounts.filter((a) => a.status === "active" && a.nextSendAt <= now && accountSentLast24h(a.id, now) < a.dailyLimit);
  await loadDueLeads("email", busy.map((a) => a.id), now);
  // Inboxes send in parallel, but each inbox only ever sends one email at a time.
  await Promise.allSettled(busy.map((a) => sendNextEmail(a, campaigns, now)));
  await finishCampaigns("email");
}

// ─── Email reply / bounce detection ────────────────────────────────────────

export async function checkReplies(perAccount = 40) {
  const d = db();
  const now = Date.now();
  await Promise.all(d.accounts.filter((a) => a.status === "active").map((account) => checkAccountReplies(account, perAccount, now)));
}

async function checkAccountReplies(account: GmailAccount, perAccount: number, now: number) {
  const d = db();
  const candidates = await fetchLeads((q) =>
    q
      .eq("account_id", account.id)
      .in("status", ["in_progress", "completed"])
      .not("thread_id", "is", null)
      .is("replied_at", null)
      .gt("last_sent_at", now - 45 * DAY)
      .order("last_checked_at", { ascending: true, nullsFirst: true })
      .limit(perAccount),
  );

  for (const lead of candidates) {
    try {
      const r = await checkThread(account, lead.threadId!);
      lead.lastCheckedAt = Date.now();
      const c = d.campaigns.find((x) => x.id === lead.campaignId);
      if (r.bounced && !r.replied) {
        lead.status = "bounced";
        pushEvent({ type: "bounce", campaignId: lead.campaignId, accountId: account.id, leadId: lead.id, email: leadLabel(lead) });
        if (c) queueSheetStatus(c, { match: leadMatch(lead) }, `Bounced · ${stamp(c)}`);
      } else if (r.replied) {
        await recordReply(lead, account.id, r.at || Date.now(), r.snippet || "", r.unsubscribe);
      }
    } catch (err) {
      lead.lastCheckedAt = Date.now();
      if (isAuthError(err)) {
        account.status = "error";
        account.error = `Google access expired or was revoked — reconnect this inbox. (${errorMessage(err)})`;
        break;
      }
    }
  }
}

/** A lead replied (email or WhatsApp): stop the sequence or unsubscribe them. */
export async function recordReply(lead: Lead, accountId: string, at: number, snippet: string, wantsOut: boolean) {
  const c = db().campaigns.find((x) => x.id === lead.campaignId);
  lead.repliedAt = at;
  pushEvent({ type: "reply", campaignId: lead.campaignId, accountId, leadId: lead.id, email: leadLabel(lead), detail: snippet.slice(0, 300) });
  if (wantsOut) {
    lead.status = "unsubscribed";
    await addUnsubscribe(contactKey(lead), "reply", lead);
  } else {
    if (!c || c.stopOnReply) lead.status = "replied";
    if (c) queueSheetStatus(c, { match: leadMatch(lead) }, `Replied · ${stamp(c, at)}`);
  }
}

/**
 * Stop a contact everywhere. `key` is an email address or "wa:<digits>".
 * Updates loaded leads in memory and all other leads directly in the database.
 */
export async function addUnsubscribe(key: string, source: string, lead?: Lead) {
  const d = db();
  key = key.toLowerCase();
  if (!d.unsubscribes.some((u) => u.email === key)) d.unsubscribes.push({ email: key, at: Date.now(), source });
  const isWa = key.startsWith("wa:");
  const value = isWa ? key.slice(3) : key;
  const campaignIds = new Set<string>();
  for (const l of d.leads) {
    if ((isWa ? l.phone : l.email) !== value) continue;
    if (l.status === "pending" || l.status === "in_progress") l.status = "unsubscribed";
    campaignIds.add(l.campaignId);
  }
  const { data, error } = await sb()
    .from("leads")
    .update({ status: "unsubscribed" })
    .eq(isWa ? "phone" : "email", value)
    .in("status", ["pending", "in_progress"])
    .select("campaign_id");
  if (error) console.error("[sniper] unsubscribe update failed", error.message);
  data?.forEach((r) => campaignIds.add(r.campaign_id));
  for (const cid of campaignIds) {
    const c = d.campaigns.find((x) => x.id === cid);
    if (c) queueSheetStatus(c, { match: value }, `Unsubscribed · ${stamp(c)}`);
  }
  pushEvent({ type: "unsubscribe", campaignId: lead?.campaignId, accountId: lead?.accountId, leadId: lead?.id, email: isWa ? formatPhone(value) : value, detail: source });
}
