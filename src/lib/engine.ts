import "server-only";
import { db, id, isPartial, pushEvent, save, sb, token } from "./db";
import { APP_URL, checkThread, errorMessage, getSheetRows, isAuthError, sendGmail } from "./google";
import { EMAIL_RE, leadVariables, render, textToHtml } from "./template";
import { alreadyContacted, claimContact, claimStep, normalizeEmail, recordStepMessage, releaseContact, releaseStep, syncClaimedLead } from "./dedupe";
import { queueSheetStatus, stamp } from "./sheetSync";
import type { Campaign, GmailAccount, Lead } from "./types";

const DAY = 86_400_000;
export const IS_PUBLIC = !/localhost|127\.0\.0\.1|\[::1\]/.test(APP_URL);

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

const rand = (min: number, max: number) => min + Math.random() * Math.max(0, max - min);

// ─── Quotas ────────────────────────────────────────────────────────────────

/** Emails sent by an inbox in the last 24h (all campaigns) — the hard inbox cap. */
export function accountSentLast24h(accountId: string, now = Date.now()) {
  let n = 0;
  const ev = db().events;
  for (let i = ev.length - 1; i >= 0 && ev[i].at > now - DAY; i--) if (ev[i].type === "sent" && ev[i].accountId === accountId) n++;
  return n;
}

/** Emails a campaign sent today (campaign timezone), optionally for one inbox. */
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

export function activeCampaignAccounts(c: Campaign) {
  return db().accounts.filter((a) => c.accountIds.includes(a.id) && a.status === "active");
}

/** The daily campaign volume is split evenly over its inboxes: 200/day over 10 inboxes = 20 each. */
export function perAccountQuota(c: Campaign) {
  const n = Math.max(1, activeCampaignAccounts(c).length || c.accountIds.length);
  return Math.ceil(c.dailyLimit / n);
}

// ─── Lead import ───────────────────────────────────────────────────────────

export async function syncLeads(c: Campaign) {
  if (!c.sheet || !c.mapping?.email) throw new Error("Connect a sheet and map the email column first");
  const d = db();
  const { headers, rows, rowNumbers } = await getSheetRows(c.sheet.spreadsheetId, c.sheet.tab);
  c.sheet.headers = headers;

  const existing = new Set(d.leads.filter((l) => l.campaignId === c.id).map((l) => l.email));
  // Addresses that already got a cold email from ANY campaign — never cold-email them twice.
  const contacted = await alreadyContacted(rows.map((r) => r[c.mapping!.email] || "").filter((e) => EMAIL_RE.test(normalizeEmail(e))));
  const campaignName = (cid: string) => d.campaigns.find((x) => x.id === cid)?.name || "another campaign";
  const unsub = new Set(d.unsubscribes.map((u) => u.email));
  const accounts = c.accountIds.filter((aid) => d.accounts.some((a) => a.id === aid));
  if (!accounts.length) throw new Error("Select at least one sending inbox");

  // Balance new leads onto the inbox that currently has the fewest.
  const load = new Map(accounts.map((a) => [a, 0]));
  for (const l of d.leads) if (l.campaignId === c.id && load.has(l.accountId)) load.set(l.accountId, load.get(l.accountId)! + 1);

  let added = 0,
    invalid = 0,
    duplicate = 0,
    alreadySent = 0;
  rows.forEach((row, i) => {
    const sheetRow = rowNumbers[i];
    const email = normalizeEmail(row[c.mapping!.email] || "");
    if (!EMAIL_RE.test(email)) {
      invalid++;
      if (email) queueSheetStatus(c, { row: sheetRow }, "Skipped · invalid email");
      return;
    }
    if (existing.has(email)) {
      // Same address appears twice in the sheet (or was imported before) — only the first row is used.
      duplicate++;
      if (!d.leads.some((l) => l.campaignId === c.id && l.email === email && l.stepIndex > 0)) {
        queueSheetStatus(c, { row: sheetRow }, "Skipped · duplicate row");
      }
      return;
    }
    existing.add(email);
    const accountId = [...load.entries()].sort((a, b) => a[1] - b[1])[0][0];
    load.set(accountId, load.get(accountId)! + 1);
    const prior = contacted.get(email);
    const status = unsub.has(email) ? "unsubscribed" : prior ? "duplicate" : "pending";
    d.leads.push({
      id: id("l_"),
      campaignId: c.id,
      email,
      data: leadVariables(row, c.mapping),
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
  save();
  return { added, invalid, duplicate, alreadyContacted: alreadySent, total: rows.length };
}

/** Move unsent leads off an inbox that was removed from a campaign / deleted. */
export function rebalanceLeads(c: Campaign) {
  const d = db();
  const valid = c.accountIds.filter((aid) => d.accounts.some((a) => a.id === aid));
  if (!valid.length) return;
  let i = 0;
  for (const l of d.leads) {
    if (l.campaignId !== c.id || valid.includes(l.accountId)) continue;
    if (l.stepIndex === 0 && l.status === "pending") l.accountId = valid[i++ % valid.length];
  }
  save();
}

// ─── Building an email ─────────────────────────────────────────────────────

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

  const unsubUrl = `${APP_URL}/u/${lead.token}`;
  if (c.unsubscribeFooter && c.unsubscribeText.trim()) {
    const note = render(c.unsubscribeText, vars, seed).trim();
    text += `\n\n${note}${IS_PUBLIC ? ` ${unsubUrl}` : ""}`;
    html += `<div><br></div><div style="font-family:Arial,sans-serif;font-size:12px;color:#888">${note
      .replace(/</g, "&lt;")}${IS_PUBLIC ? ` <a href="${unsubUrl}" style="color:#888">Unsubscribe</a>` : ""}</div>`;
  }
  if (c.trackOpens && IS_PUBLIC) {
    html += `<img src="${APP_URL}/api/t/o/${lead.token}" width="1" height="1" alt="" style="display:none">`;
  }

  return {
    subject,
    text,
    html,
    threadId: stepIndex > 0 ? lead.threadId : undefined,
    inReplyTo: stepIndex > 0 && isFollowUpInThread ? lead.firstMessageId : undefined,
    listUnsubscribe: `<mailto:${account.email}?subject=unsubscribe>${IS_PUBLIC ? `, <${APP_URL}/api/unsubscribe?t=${lead.token}>` : ""}`,
    oneClick: IS_PUBLIC,
  };
}

// ─── Worker tick: at most one email per inbox per tick ─────────────────────

function pickLead(account: GmailAccount, campaigns: Campaign[], now: number): { c: Campaign; lead: Lead } | null {
  const d = db();
  const eligible = campaigns.filter(
    (c) => c.accountIds.includes(account.id) && inWindow(c, now) && campaignSentToday(c, account.id, now) < perAccountQuota(c),
  );
  if (!eligible.length) return null;
  const ids = new Set(eligible.map((c) => c.id));
  let followUp: Lead | null = null;
  let fresh: Lead | null = null;
  for (const l of d.leads) {
    if (l.accountId !== account.id || !ids.has(l.campaignId) || l.nextAt > now) continue;
    if (l.status === "in_progress") {
      if (!followUp || l.nextAt < followUp.nextAt) followUp = l;
    } else if (l.status === "pending" && !fresh) fresh = l;
  }
  // Follow-ups go first so sequences stay on time; new leads fill the rest.
  const lead = followUp || fresh;
  return lead ? { c: eligible.find((c) => c.id === lead.campaignId)!, lead } : null;
}

async function sendNext(account: GmailAccount, campaigns: Campaign[], now: number) {
  const d = db();
  const pick = pickLead(account, campaigns, now);
  if (!pick) return;
  const { c, lead } = pick;

  if (d.unsubscribes.some((u) => u.email === lead.email)) {
    lead.status = "unsubscribed";
    save();
    return;
  }
  if (!c.steps[lead.stepIndex]) {
    lead.status = "completed";
    save();
    return;
  }

  const step = lead.stepIndex;

  // ── Duplicate protection (enforced by unique keys in Supabase) ──
  try {
    if (!(await claimStep(lead, step, account.id))) {
      // This step was already claimed — never resend it. Find out what really happened.
      const outcome = await syncClaimedLead(lead, step);
      if (outcome === "stale") advanceLead(c, lead); // crashed right after sending: move on
      if (outcome !== "wait") save();
      return;
    }
    if (step === 0) {
      const claim = await claimContact(lead, account.id);
      if (!claim.ok) {
        await releaseStep(lead.id, step);
        const other = d.campaigns.find((x) => x.id === claim.campaignId)?.name || "another campaign";
        lead.status = "duplicate";
        lead.error = `Already contacted in "${other}"`;
        pushEvent({ type: "duplicate", campaignId: c.id, accountId: account.id, leadId: lead.id, email: lead.email, detail: lead.error });
        queueSheetStatus(c, { email: lead.email }, `Skipped · already contacted (${other})`);
        save();
        return;
      }
    }
  } catch (err) {
    // Can't confirm with the database → don't risk a duplicate; try again shortly.
    console.error(`[sniper] dedupe check failed, skipping this round: ${(err as Error).message}`);
    account.nextSendAt = Date.now() + 60_000;
    return;
  }

  const mail = composeEmail(c, lead, account);
  try {
    const res = await sendGmail(account, { ...mail, fromName: account.name, fromEmail: account.email, to: lead.email });
    if (step === 0) {
      lead.firstSubject = mail.subject;
      lead.firstMessageId = res.messageId;
    }
    lead.threadId = lead.threadId || res.threadId;
    lead.lastSentAt = Date.now();
    lead.error = undefined;
    advanceLead(c, lead);
    recordStepMessage(lead.id, step, res.id).catch(() => {});
    pushEvent({ type: "sent", campaignId: c.id, accountId: account.id, leadId: lead.id, email: lead.email, step: step + 1, detail: mail.subject });
    queueSheetStatus(
      c,
      { email: lead.email },
      lead.status === "completed"
        ? `Sequence done · step ${step + 1}/${c.steps.length} sent ${stamp(c)} · from ${account.email}`
        : `Sent · step ${step + 1}/${c.steps.length} · ${stamp(c)} · from ${account.email}`,
    );
    account.nextSendAt = Date.now() + rand(c.schedule.minGapSec, c.schedule.maxGapSec) * 1000;
    console.log(`[sniper] ${account.email} → ${lead.email} (step ${step + 1}, "${c.name}")`);
  } catch (err) {
    // Gmail rejected it — release the claims so it can be retried later.
    await releaseStep(lead.id, step);
    if (step === 0) await releaseContact(lead.email, lead.id);
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
      queueSheetStatus(c, { email: lead.email }, `Failed · ${msg.slice(0, 120)}`);
    }
    pushEvent({ type: "error", campaignId: c.id, accountId: account.id, leadId: lead.id, email: lead.email, detail: msg });
    console.error(`[sniper] send failed ${account.email} → ${lead.email}: ${msg}`);
  }
  save();
}

/** Move a lead past the step it just received. */
function advanceLead(c: Campaign, lead: Lead) {
  lead.stepIndex++;
  if (lead.stepIndex >= c.steps.length) {
    lead.status = "completed";
  } else {
    lead.status = "in_progress";
    lead.nextAt = Date.now() + c.steps[lead.stepIndex].delayDays * DAY;
  }
}

async function finishCampaigns() {
  const d = db();
  for (const c of d.campaigns) {
    if (c.status !== "active") continue;
    let open: boolean, any: boolean;
    if (isPartial()) {
      const [o, a] = await Promise.all([
        sb().from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).in("status", ["pending", "in_progress"]),
        sb().from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", c.id),
      ]);
      if (o.error || a.error) continue;
      open = (o.count ?? 0) > 0;
      any = (a.count ?? 0) > 0;
    } else {
      open = d.leads.some((l) => l.campaignId === c.id && (l.status === "pending" || l.status === "in_progress"));
      any = d.leads.some((l) => l.campaignId === c.id);
    }
    if (!open && any) {
      c.status = "completed";
      save();
    }
  }
}

export async function tick() {
  const d = db();
  const now = Date.now();
  const campaigns = d.campaigns.filter((c) => c.status === "active");
  if (!campaigns.length) return;
  const busy = d.accounts.filter(
    (a) => a.status === "active" && a.nextSendAt <= now && accountSentLast24h(a.id, now) < a.dailyLimit,
  );
  // Inboxes send in parallel, but each inbox only ever sends one email at a time.
  await Promise.allSettled(busy.map((a) => sendNext(a, campaigns, now)));
  await finishCampaigns();
}

// ─── Reply / bounce detection ──────────────────────────────────────────────

export async function checkReplies(perAccount = 40) {
  const d = db();
  const now = Date.now();
  await Promise.all(d.accounts.filter((a) => a.status === "active").map((account) => checkAccountReplies(account, perAccount, now)));
}

async function checkAccountReplies(account: GmailAccount, perAccount: number, now: number) {
  const d = db();
  const candidates = d.leads
    .filter(
      (l) =>
        l.accountId === account.id &&
        l.threadId &&
        !l.repliedAt &&
        (l.status === "in_progress" || l.status === "completed") &&
        (l.lastSentAt || 0) > now - 45 * DAY,
    )
    .sort((a, b) => (a.lastCheckedAt || 0) - (b.lastCheckedAt || 0))
    .slice(0, perAccount);

  for (const lead of candidates) {
    try {
      const r = await checkThread(account, lead.threadId!);
      lead.lastCheckedAt = Date.now();
      const c = d.campaigns.find((x) => x.id === lead.campaignId);
      if (r.bounced && !r.replied) {
        lead.status = "bounced";
        pushEvent({ type: "bounce", campaignId: lead.campaignId, accountId: account.id, leadId: lead.id, email: lead.email });
        if (c) queueSheetStatus(c, { email: lead.email }, `Bounced · ${stamp(c)}`);
      } else if (r.replied) {
        lead.repliedAt = r.at || Date.now();
        pushEvent({ type: "reply", campaignId: lead.campaignId, accountId: account.id, leadId: lead.id, email: lead.email, detail: r.snippet });
        if (r.unsubscribe) {
          lead.status = "unsubscribed";
          await addUnsubscribe(lead.email, "reply", lead);
        } else {
          if (!c || c.stopOnReply) lead.status = "replied";
          if (c) queueSheetStatus(c, { email: lead.email }, `Replied · ${stamp(c, lead.repliedAt)}`);
        }
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
  save();
}

export async function addUnsubscribe(email: string, source: string, lead?: Lead) {
  const d = db();
  email = email.toLowerCase();
  if (!d.unsubscribes.some((u) => u.email === email)) d.unsubscribes.push({ email, at: Date.now(), source });
  // Stop this address in every campaign — in memory and directly in the database
  // (on Vercel only some leads are loaded at a time).
  const campaignIds = new Set<string>();
  for (const l of d.leads) {
    if (l.email !== email) continue;
    if (l.status === "pending" || l.status === "in_progress") l.status = "unsubscribed";
    campaignIds.add(l.campaignId);
  }
  const { data, error } = await sb()
    .from("leads")
    .update({ status: "unsubscribed" })
    .eq("email", email)
    .in("status", ["pending", "in_progress"])
    .select("campaign_id");
  if (error) console.error("[sniper] unsubscribe update failed", error.message);
  data?.forEach((r) => campaignIds.add(r.campaign_id));
  for (const cid of campaignIds) {
    const c = d.campaigns.find((x) => x.id === cid);
    if (c) queueSheetStatus(c, { email }, `Unsubscribed · ${stamp(c)}`);
  }
  pushEvent({ type: "unsubscribe", campaignId: lead?.campaignId, accountId: lead?.accountId, leadId: lead?.id, email, detail: source });
  save();
}
