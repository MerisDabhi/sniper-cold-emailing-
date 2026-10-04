import "server-only";
import { checkReplies, tick } from "./engine";
import { withData } from "./run";
import { acquireLease } from "./lease";

const LOCAL_REPLY_CHECK = process.env.LOCAL_REPLY_CHECK === "true";

const g = globalThis as unknown as { __sniperEmailWorker?: { stopping: boolean; running: boolean } };

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
  const state: { stopping: boolean; running: boolean } = { stopping: false, running: false };
  g.__sniperEmailWorker = state;
  let runs = 0;
  const run = async () => {
    if (state.running || state.stopping) return;
    state.running = true;
    try {
      if (!(await acquireLease("email", 90))) return;
      // Email replies are checked in the cloud (Supabase function `check-replies`, every 3 minutes).
      // Set LOCAL_REPLY_CHECK=true only if that cloud job is turned off.
      await runEmailSender({ replyCheck: LOCAL_REPLY_CHECK && runs++ % 3 === 0, replyLimit: 40 });
    } catch (e) {
      console.error("[sniper] email sender error", e);
    } finally {
      state.running = false;
    }
  };
  setTimeout(run, 5_000);
  setInterval(run, 60_000);
  console.log("[sniper] email sender started");
}

/** Stop starting new sends and wait (up to `ms`) for the one in progress to finish and be saved. */
export async function stopEmailWorker(ms = 60_000) {
  const state = g.__sniperEmailWorker;
  if (!state) return;
  state.stopping = true;
  const until = Date.now() + ms;
  while (state.running && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
}
