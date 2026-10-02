import "server-only";
import { checkReplies, tick } from "./engine";
import { withData } from "./run";
import { acquireLease } from "./lease";

const g = globalThis as unknown as { __sniperEmailWorker?: boolean };

/** One email sender run (also used by /api/cron/tick on Vercel). */
export async function runEmailSender(opts: { replyCheck: boolean; replyLimit: number }) {
  await withData(async () => {
    await tick();
    if (opts.replyCheck) await checkReplies(opts.replyLimit);
  });
}

/**
 * Email sender loop for long-running processes (local dev, `npm start`, `npm run worker`):
 * once a minute, sends at most one email per inbox and checks replies every 3rd minute.
 * Only the process holding the "email" lease sends, so several copies never double up.
 */
export function startEmailWorker() {
  if (g.__sniperEmailWorker) return;
  g.__sniperEmailWorker = true;
  let running = false;
  let runs = 0;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      if (!(await acquireLease("email", 90))) return;
      await runEmailSender({ replyCheck: runs++ % 3 === 0, replyLimit: 40 });
    } catch (e) {
      console.error("[sniper] email sender error", e);
    } finally {
      running = false;
    }
  };
  setTimeout(run, 5_000);
  setInterval(run, 60_000);
  console.log("[sniper] email sender started");
}
