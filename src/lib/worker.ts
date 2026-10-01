import "server-only";
import { checkReplies, tick } from "./engine";
import { ready } from "./db";
import { flushSheetStatuses } from "./sheetSync";

const g = globalThis as unknown as { __sniperWorker?: { started: boolean; ticking: boolean; checking: boolean } };

/**
 * Background loop for long-running servers (local / VPS): sends due emails every 15s,
 * checks replies every 3 minutes and writes sheet statuses every 10s.
 * On Vercel this is replaced by /api/cron/tick.
 */
export function startWorker() {
  if (g.__sniperWorker?.started) return;
  const w: { started: boolean; ticking: boolean; checking: boolean } = { started: true, ticking: false, checking: false };
  g.__sniperWorker = w;

  setInterval(async () => {
    if (w.ticking) return;
    w.ticking = true;
    try {
      await ready();
      await tick();
    } catch (e) {
      console.error("[sniper] tick error", e);
    } finally {
      w.ticking = false;
    }
  }, 15_000);

  setInterval(async () => {
    if (w.checking) return;
    w.checking = true;
    try {
      await ready();
      await checkReplies(40);
    } catch (e) {
      console.error("[sniper] reply check error", e);
    } finally {
      w.checking = false;
    }
  }, 180_000);

  setInterval(() => {
    ready()
      .then(flushSheetStatuses)
      .catch((e) => console.error("[sniper] sheet sync error", e));
  }, 10_000);

  ready().catch((e) => console.error("[sniper] could not load data from Supabase:", e.message));
  console.log("[sniper] background sender started");
}
