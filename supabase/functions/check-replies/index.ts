// Cloud reply checker: runs every minute (pg_cron → this function), so replies, bounces and
// unsubscribes are detected — and phone notifications fire — even when no laptop is running.
// Protected by the `cron_secret` from Vault (sent as the x-cron-secret header).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { accessToken, errorMessage, fail, GMAIL_API, google, header, id, json, sb, secret, type GmailMessage } from "../_shared/core.ts";

const DAY = 86_400_000;
const PER_ACCOUNT = 25;
const FOLLOW_UPS_PER_ACCOUNT = 10;
const UNSUB_RE = /\b(unsubscribe|remove me|stop emailing|take me off|not interested|opt[ -]?out)\b/i;

Deno.serve(async (req) => {
  if ((req.headers.get("x-cron-secret") || "") !== (await secret("cron_secret"))) return fail("Unauthorized", 401);
  const started = Date.now();
  const stats = { checked: 0, replies: 0, bounces: 0, unsubscribes: 0, errors: 0 };
  try {
    const { data: accounts } = await sb().from("accounts").select("id, email, tokens").eq("status", "active");
    await Promise.all((accounts || []).map((a) => checkAccount(a, stats)));
    return json({ ok: true, ...stats, ms: Date.now() - started });
  } catch (err) {
    console.error(err);
    return fail(errorMessage(err), 500);
  }
});

type Account = { id: string; email: string; tokens: Record<string, unknown> };

async function checkAccount(account: Account, stats: Record<string, number>) {
  const { data: leads } = await sb()
    .from("leads")
    .select("id, campaign_id, email, thread_id, status")
    .eq("account_id", account.id)
    .in("status", ["in_progress", "completed"])
    .not("thread_id", "is", null)
    .is("replied_at", null)
    .gt("last_sent_at", Date.now() - 45 * DAY)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(PER_ACCOUNT);
  // People who already replied: watch their thread for further messages, so the inbox stays live.
  const { data: talking } = await sb()
    .from("leads")
    .select("id, campaign_id, email, thread_id, last_reply_at")
    .eq("account_id", account.id)
    .not("thread_id", "is", null)
    .gt("last_reply_at", Date.now() - 30 * DAY)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(FOLLOW_UPS_PER_ACCOUNT);
  if (!leads?.length && !talking?.length) return;

  let token: string;
  try {
    token = await accessToken("accounts", account.id, account.tokens);
  } catch (err) {
    stats.errors++;
    if (/invalid_grant|expired|revoked/i.test(errorMessage(err))) {
      await sb().from("accounts").update({ status: "error", error: `Google access expired or was revoked — reconnect this inbox. (${errorMessage(err)})` }).eq("id", account.id);
    }
    return;
  }

  for (const lead of talking || []) {
    stats.checked++;
    try {
      const { replied } = await scanThread(token, lead.thread_id, account.email);
      await sb().from("leads").update({ last_checked_at: Date.now() }).eq("id", lead.id);
      const at = Number(replied?.internalDate) || 0;
      if (!replied || at <= Number(lead.last_reply_at)) continue;
      // Only the first detector records it (the condition makes this safe to race).
      const { data: claimed } = await sb().from("leads").update({ last_reply_at: at }).eq("id", lead.id).lt("last_reply_at", at).select("id");
      if (!claimed?.length) continue;
      stats.replies++;
      await sb().from("events").insert({ id: id("e_"), type: "reply", at: Date.now(), campaign_id: lead.campaign_id, account_id: account.id, lead_id: lead.id, email: lead.email, detail: (replied.snippet || "").slice(0, 300) });
    } catch (err) {
      stats.errors++;
      console.error(`[check-replies] ${account.email} lead ${lead.id}: ${errorMessage(err)}`);
    }
  }

  for (const lead of leads || []) {
    stats.checked++;
    try {
      const { replied, bounced } = await scanThread(token, lead.thread_id, account.email);
      await sb().from("leads").update({ last_checked_at: Date.now() }).eq("id", lead.id);

      if (replied) {
        const at = Number(replied.internalDate) || Date.now();
        const snippet = (replied.snippet || "").slice(0, 300);
        // Only the first detector records the reply (the condition makes this safe to race).
        const { data: claimed } = await sb().from("leads").update({ replied_at: at, last_reply_at: at }).eq("id", lead.id).is("replied_at", null).select("id");
        if (!claimed?.length) continue;
        stats.replies++;
        await sb().from("events").insert({ id: id("e_"), type: "reply", at: Date.now(), campaign_id: lead.campaign_id, account_id: account.id, lead_id: lead.id, email: lead.email, detail: snippet });
        const { data: campaign } = await sb().from("campaigns").select("id, stop_on_reply, sheet, mapping, sheet_status, sheet_status_column, schedule").eq("id", lead.campaign_id).maybeSingle();
        if (UNSUB_RE.test(snippet)) {
          stats.unsubscribes++;
          await unsubscribe(lead, account.id);
          await sheetStatus(campaign, lead.email, `Unsubscribed · ${stamp(campaign, at)}`);
        } else {
          if (campaign?.stop_on_reply !== false) await sb().from("leads").update({ status: "replied" }).eq("id", lead.id);
          await sheetStatus(campaign, lead.email, `Replied · ${stamp(campaign, at)}`);
        }
      } else if (bounced) {
        const { data: changed } = await sb().from("leads").update({ status: "bounced" }).eq("id", lead.id).in("status", ["in_progress", "completed"]).select("id");
        if (!changed?.length) continue;
        stats.bounces++;
        await sb().from("events").insert({ id: id("e_"), type: "bounce", at: Date.now(), campaign_id: lead.campaign_id, account_id: account.id, lead_id: lead.id, email: lead.email });
        const { data: campaign } = await sb().from("campaigns").select("id, sheet, mapping, sheet_status, sheet_status_column, schedule").eq("id", lead.campaign_id).maybeSingle();
        await sheetStatus(campaign, lead.email, `Bounced · ${stamp(campaign, Date.now())}`);
      }
    } catch (err) {
      stats.errors++;
      console.error(`[check-replies] ${account.email} lead ${lead.id}: ${errorMessage(err)}`);
    }
  }
}

/** The newest real (not automatic) message from the other side in a Gmail thread, and any bounce notice. */
async function scanThread(token: string, threadId: string, ownEmail: string) {
  const params = new URLSearchParams({ format: "metadata" });
  for (const h of ["From", "Subject", "Auto-Submitted", "X-Autoreply", "X-Autorespond", "Precedence"]) params.append("metadataHeaders", h);
  const data = await google<{ messages?: GmailMessage[] }>(token, `${GMAIL_API}/threads/${threadId}?${params}`);
  let replied: GmailMessage | null = null;
  let bounced: GmailMessage | null = null;
  for (const m of data.messages || []) {
    const from = header(m, "From").toLowerCase();
    if (from.includes(ownEmail.toLowerCase())) continue;
    if (/mailer-daemon|postmaster|mail delivery/.test(from)) {
      bounced = m;
      continue;
    }
    const auto = header(m, "Auto-Submitted").toLowerCase();
    const isAuto =
      (auto && auto !== "no") ||
      !!header(m, "X-Autoreply") ||
      !!header(m, "X-Autorespond") ||
      /^(auto_reply|bulk|junk)$/i.test(header(m, "Precedence")) ||
      /^(automatic reply|auto[- ]?reply|autoreply|out of (the )?office)/i.test(header(m, "Subject"));
    if (!isAuto) replied = m;
  }
  return { replied, bounced };
}

/** Stop this address everywhere and remember it, like the web app does. */
async function unsubscribe(lead: { id: string; email: string; campaign_id: string }, accountId: string) {
  const email = lead.email.toLowerCase();
  await sb().from("leads").update({ status: "unsubscribed" }).eq("id", lead.id);
  await sb().from("unsubscribes").upsert({ email, at: Date.now(), source: "reply" }, { onConflict: "email", ignoreDuplicates: true });
  await sb().from("leads").update({ status: "unsubscribed" }).eq("email", email).in("status", ["pending", "in_progress"]);
  await sb().from("events").insert({ id: id("e_"), type: "unsubscribe", at: Date.now(), campaign_id: lead.campaign_id, account_id: accountId, lead_id: lead.id, email, detail: "reply" });
}

type Campaign = {
  id: string;
  sheet?: { spreadsheetId: string; tab: string } | null;
  mapping?: { email?: string } | null;
  sheet_status?: boolean;
  sheet_status_column?: string;
  schedule?: { timezone?: string } | null;
} | null;

function stamp(c: Campaign, ts: number) {
  let tz = c?.schedule?.timezone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ts));
}

const colLetter = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** Write the lead's status into the campaign's Google Sheet (row found by email). */
async function sheetStatus(c: Campaign, email: string, text: string) {
  try {
    if (!c?.sheet || !c.sheet_status || !c.mapping?.email) return;
    const { data: owner } = await sb().from("owner").select("id, tokens").maybeSingle();
    if (!owner || !String(owner.tokens?.scope || "").split(" ").includes("https://www.googleapis.com/auth/spreadsheets")) return;
    const token = await accessToken("owner", owner.id, owner.tokens);
    const tab = `'${c.sheet.tab.replace(/'/g, "''")}'`;
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${c.sheet.spreadsheetId}/values`;
    const { values = [] } = await google<{ values?: string[][] }>(token, `${base}/${encodeURIComponent(tab)}`);
    const headers = (values[0] || []).map((h) => String(h || "").trim());
    const emailCol = headers.indexOf(c.mapping.email);
    let statusCol = headers.findIndex((h) => h.toLowerCase() === (c.sheet_status_column || "Outreach Status").toLowerCase());
    if (emailCol === -1) return;
    const writes: { range: string; values: string[][] }[] = [];
    if (statusCol === -1) {
      statusCol = headers.length;
      writes.push({ range: `${tab}!${colLetter(statusCol)}1`, values: [[c.sheet_status_column || "Outreach Status"]] });
    }
    const rowIdx = values.findIndex((r, i) => i > 0 && String(r[emailCol] || "").trim().toLowerCase() === email.toLowerCase());
    if (rowIdx === -1) return;
    writes.push({ range: `${tab}!${colLetter(statusCol)}${rowIdx + 1}`, values: [[text]] });
    await google(token, `${base}:batchUpdate`, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data: writes }) });
  } catch (err) {
    console.error(`[check-replies] sheet update failed: ${errorMessage(err)}`);
  }
}
