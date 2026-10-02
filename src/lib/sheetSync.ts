import "server-only";
import { db } from "./db";
import { errorMessage, ownerCanWriteSheets, writeSheetStatuses } from "./google";
import { normalizePhone } from "./phone";
import type { Campaign, Lead } from "./types";

/**
 * Queue of status cells to write back into each campaign's Google Sheet.
 * Every unit of work flushes the queue when it finishes, in one batch per sheet, so we stay
 * well inside the Sheets API quota and only the latest status per row is written.
 */

type Update = { campaignId: string; match?: string; row?: number; text: string; attempts: number };
type State = { queue: Map<string, Update>; lastError: string | null; flushing: Promise<void> | null };

const g = globalThis as unknown as { __sniperSheetSync?: State };
function state(): State {
  if (!g.__sniperSheetSync) g.__sniperSheetSync = { queue: new Map(), lastError: null, flushing: null };
  return g.__sniperSheetSync;
}

export function sheetSyncError() {
  return state().lastError;
}

export function stamp(c: Campaign, ts = Date.now()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: c.schedule.timezone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ts));
}

/** The value that identifies a lead's row: phone digits (WhatsApp) or lowercase email. */
export const leadMatch = (lead: Pick<Lead, "email" | "phone">) => lead.phone ?? lead.email?.toLowerCase();

/** Queue a status for a lead's row (found by email/phone) or for an explicit sheet row. */
export function queueSheetStatus(c: Campaign, target: { match?: string; row?: number }, text: string) {
  if (!c.sheet || !c.sheetStatus) return;
  const key = `${c.id}|${target.row ?? target.match}`;
  state().queue.set(key, { campaignId: c.id, ...target, text, attempts: 0 });
}

export async function flushSheetStatuses(): Promise<void> {
  const s = state();
  while (s.flushing) await s.flushing;
  if (!s.queue.size) return;
  if (!ownerCanWriteSheets()) {
    s.lastError = "Reconnect Google Sheets in Settings to allow status updates (write access was not granted).";
    return; // keep the queue — it is written as soon as access is granted
  }
  s.flushing = (async () => {
    const byCampaign = new Map<string, [string, Update][]>();
    for (const entry of s.queue) {
      const list = byCampaign.get(entry[1].campaignId) || [];
      list.push(entry);
      byCampaign.set(entry[1].campaignId, list);
    }
    for (const [campaignId, entries] of byCampaign) {
      // Remove before the async write; anything queued meanwhile for the same row is newer and stays.
      entries.forEach(([k]) => s.queue.delete(k));
      const c = db().campaigns.find((x) => x.id === campaignId);
      const header = c?.channel === "whatsapp" ? c.mapping?.phone : c?.mapping?.email;
      if (!c?.sheet || !header || !c.sheetStatus) continue;
      try {
        await writeSheetStatuses({
          spreadsheetId: c.sheet.spreadsheetId,
          tab: c.sheet.tab,
          matchHeader: header,
          normalize: c.channel === "whatsapp" ? (v) => normalizePhone(v, c.countryCode) : (v) => v.trim().toLowerCase() || null,
          statusHeader: c.sheetStatusColumn || "Outreach Status",
          updates: entries.map(([, u]) => u),
        });
        s.lastError = null;
      } catch (err) {
        const msg = errorMessage(err);
        s.lastError = `Couldn't update "${c.sheet.title}": ${msg}`;
        console.error("[sheet-sync]", s.lastError);
        // Put back for retry (max 5 attempts) unless a newer status arrived for that row.
        for (const [k, u] of entries) if (!s.queue.has(k) && u.attempts < 5) s.queue.set(k, { ...u, attempts: u.attempts + 1 });
      }
    }
  })();
  try {
    await s.flushing;
  } finally {
    s.flushing = null;
  }
}
