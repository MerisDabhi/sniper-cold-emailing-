import "server-only";
import type { WASocket } from "baileys";
import { db, fetchLeads, pushEvent, sb } from "../db";
import { render } from "../template";
import { formatPhone } from "../phone";
import { leadMatch, queueSheetStatus } from "../sheetSync";
import {
  accountSentLast24h,
  finishCampaigns,
  leadLabel,
  loadDueLeads,
  MAX_SKIPS_PER_RUN,
  pickLead,
  prepareSend,
  rand,
  recordReply,
  recordSent,
  releaseClaims,
  SendCancelled,
  stillSendable,
} from "../engine";
import { errorMessage } from "../google";
import type { Campaign, Lead, WaAccount } from "../types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Replies that mean "don't message me again". */
const STOP_RE = /^\s*(stop|unsubscribe|remove|block)\b|\b(unsubscribe|remove me|opt[ -]?out|don'?t (message|text|contact) me|stop (messaging|texting)|not interested)\b/i;

export function composeWhatsApp(c: Campaign, lead: Lead, account: Pick<WaAccount, "name" | "label" | "phone">, stepIndex = lead.stepIndex) {
  const step = c.steps[stepIndex];
  const senderName = account.name || account.label || "";
  const vars: Record<string, string> = {
    ...lead.data,
    sender_name: senderName,
    sender_first_name: senderName.split(" ")[0],
    sender_phone: formatPhone(account.phone),
  };
  const seed = lead.id + step.id;
  let text = render(step.body, vars, seed).trim();
  if (stepIndex === 0 && c.unsubscribeFooter && c.unsubscribeText.trim()) text += `\n\n${render(c.unsubscribeText, vars, seed).trim()}`;
  return text;
}

/**
 * Send like a person would: come online, open the chat, show "typing…" for about as long as
 * it takes to type the message (with a short pause on long ones), then send.
 */
export async function humanSend(sock: WASocket, jid: string, text: string, beforeSend?: () => Promise<boolean>) {
  await sock.presenceSubscribe(jid).catch(() => {});
  await sock.sendPresenceUpdate("available").catch(() => {});
  await sleep(rand(1200, 3500)); // open the chat, glance at it
  const typingMs = Math.min(22_000, Math.max(2500, (text.length / rand(4.5, 7.5)) * 1000));
  await sock.sendPresenceUpdate("composing", jid).catch(() => {});
  if (typingMs > 9000) {
    await sleep(typingMs * rand(0.4, 0.6));
    await sock.sendPresenceUpdate("paused", jid).catch(() => {}); // stop to think
    await sleep(rand(800, 2500));
    await sock.sendPresenceUpdate("composing", jid).catch(() => {});
    await sleep(typingMs * 0.5);
  } else {
    await sleep(typingMs);
  }
  await sock.sendPresenceUpdate("paused", jid).catch(() => {});
  if (beforeSend && !(await beforeSend())) {
    sock.sendPresenceUpdate("unavailable").catch(() => {});
    throw new SendCancelled("Lead replied or unsubscribed while typing");
  }
  const res = await sock.sendMessage(jid, { text });
  setTimeout(() => sock.sendPresenceUpdate("unavailable").catch(() => {}), rand(5000, 20_000));
  return res;
}

/** Look up a number on WhatsApp. Returns its chat id, or null if it has no WhatsApp. */
export async function resolveJid(sock: WASocket, phone: string): Promise<string | null> {
  const [r] = (await sock.onWhatsApp(phone)) || [];
  return r?.exists ? r.jid : null;
}

async function setNextSend(accountId: string, at: number) {
  await sb().from("wa_accounts").update({ next_send_at: Math.round(at) }).eq("id", accountId);
}

async function sendNext(account: WaAccount, sock: WASocket, campaigns: Campaign[], now: number) {
  const tried = new Set<string>();
  let pick: { c: Campaign; lead: Lead } | null = null;
  for (let i = 0; i < MAX_SKIPS_PER_RUN; i++) {
    const next = pickLead(account.id, campaigns, now, tried);
    if (!next) return;
    tried.add(next.lead.id);
    try {
      if ((await prepareSend(next.c, next.lead, account.id)) === "ok") {
        pick = next;
        break;
      }
    } catch (err) {
      console.error(`[whatsapp] dedupe check failed, skipping this round: ${(err as Error).message}`);
      await setNextSend(account.id, Date.now() + 60_000);
      return;
    }
  }
  if (!pick) return;
  const { c, lead } = pick;
  const step = lead.stepIndex;

  try {
    if (!lead.waJid) {
      const jid = await resolveJid(sock, lead.phone!);
      if (!jid) {
        await releaseClaims(lead, step);
        lead.status = "bounced";
        lead.error = "This number is not on WhatsApp";
        pushEvent({ type: "bounce", campaignId: c.id, accountId: account.id, leadId: lead.id, email: leadLabel(lead), detail: lead.error });
        queueSheetStatus(c, { match: leadMatch(lead) }, "Not on WhatsApp");
        await setNextSend(account.id, Date.now() + rand(20_000, 60_000));
        return;
      }
      lead.waJid = jid;
    }
    const text = composeWhatsApp(c, lead, account);
    const res = await humanSend(sock, lead.waJid, text, () => stillSendable(lead));
    recordSent(c, lead, account.id, formatPhone(account.phone) || account.label, text.slice(0, 120), res?.key.id || undefined);
    await setNextSend(account.id, Date.now() + rand(c.schedule.minGapSec, c.schedule.maxGapSec) * 1000);
  } catch (err) {
    await releaseClaims(lead, step);
    if (err instanceof SendCancelled) return; // they replied while we were "typing" — nothing to do
    const msg = errorMessage(err);
    lead.status = "failed";
    lead.error = msg;
    queueSheetStatus(c, { match: leadMatch(lead) }, `Failed · ${msg.slice(0, 120)}`);
    pushEvent({ type: "error", campaignId: c.id, accountId: account.id, leadId: lead.id, email: leadLabel(lead), detail: msg });
    await setNextSend(account.id, Date.now() + 5 * 60_000);
    console.error(`[whatsapp] send failed ${account.phone} → ${lead.phone}: ${msg}`);
  }
}

/** One WhatsApp sender run: at most one message per connected number. */
export async function waTick(sockets: Map<string, WASocket>) {
  const d = db();
  const now = Date.now();
  const campaigns = d.campaigns.filter((c) => c.status === "active" && c.channel === "whatsapp");
  if (!campaigns.length) return;
  const busy = d.waAccounts.filter(
    (a) => a.status === "connected" && !a.paused && sockets.has(a.id) && a.nextSendAt <= now && accountSentLast24h(a.id, now) < a.dailyLimit,
  );
  await loadDueLeads("whatsapp", busy.map((a) => a.id), now);
  await Promise.allSettled(busy.map((a) => sendNext(a, sockets.get(a.id)!, campaigns, now)));
  await finishCampaigns("whatsapp");
}

/** An incoming WhatsApp message: if it's from a lead we messaged, record the reply. */
export async function handleIncoming(accountId: string, jid: string, altJid: string | undefined, text: string, at: number) {
  const phones = [jid, altJid].filter((j): j is string => !!j && j.endsWith("@s.whatsapp.net")).map((j) => j.split("@")[0].split(":")[0]);
  const jids = [jid, altJid].filter((j): j is string => !!j);
  const found = new Map<string, Lead>();
  const open = ["in_progress", "completed"];
  const add = (rows: Lead[]) => rows.forEach((l) => found.set(l.id, l));
  if (phones.length) add(await fetchLeads((q) => q.eq("account_id", accountId).in("status", open).is("replied_at", null).in("phone", phones)));
  add(await fetchLeads((q) => q.eq("account_id", accountId).in("status", open).is("replied_at", null).in("wa_jid", jids)));
  for (const lead of found.values()) await recordReply(lead, accountId, at, text, STOP_RE.test(text));
}
