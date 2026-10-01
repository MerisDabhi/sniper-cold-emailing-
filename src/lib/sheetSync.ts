import "server-only";
import { db } from "./db";
import { errorMessage, ownerCanWriteSheets, writeSheetStatuses } from "./google";
import type { Campaign } from "./types";

/**
 * Queue of status cells to write back into each campaign's Google Sheet.
 * Updates are batched and flushed every few seconds by the worker so we stay well
 * inside the Sheets API quota (60 writes/min), and only the latest status per row is written.
 */

type Update = { campaignId: string; email?: string; row?: number; text: string; attempts: number };
type State = { queue: Map<string, Update>; lastError: string | null; flushing: boolean };

const g = globalThis as unknown as { __sniperSheetSync?: State };
function state(): State {
  if (!g.__sniperSheetSync) g.__sniperSheetSync = { queue: new Map(), lastError: null, flushing: false };
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

/** Queue a status for a lead's row (found by email) or for an explicit sheet row. */
export function queueSheetStatus(c: Campaign, target: { email?: string; row?: number }, text: string) {
  if (!c.sheet || !c.sheetStatus) return;
  const key = `${c.id}|${target.row ?? target.email?.toLowerCase()}`;
  state().queue.set(key, { campaignId: c.id, ...target, text, attempts: 0 });
}

export async function flushSheetStatuses() {
  const s = state();
  if (s.flushing || !s.queue.size) return;
  if (!ownerCanWriteSheets()) {
    s.lastError = "Reconnect Google Sheets in Settings to allow status updates (write access was not granted).";
    return; // keep the queue — it is written as soon as access is granted
  }
  s.flushing = true;
  try {
    const byCampaign = new Map<string, [string, Update][]>();
    for (const entry of s.queue) {
      const list = byCampaign.get(entry[1].campaignId) || [];
      list.push(entry);
      byCampaign.set(entry[1].campaignId, list);
    }
    for (const [campaignId, entries] of byCampaign) {
      const c = db().campaigns.find((x) => x.id === campaignId);
      if (!c?.sheet || !c.mapping?.email || !c.sheetStatus) {
        entries.forEach(([k]) => s.queue.delete(k));
        continue;
      }
      // Remove before the async write; anything queued meanwhile for the same row is newer and stays.
      entries.forEach(([k]) => s.queue.delete(k));
      try {
        await writeSheetStatuses({
          spreadsheetId: c.sheet.spreadsheetId,
          tab: c.sheet.tab,
          emailHeader: c.mapping.email,
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
  } finally {
    s.flushing = false;
  }
}
