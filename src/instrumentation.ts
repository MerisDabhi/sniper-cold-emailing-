export async function register() {
  // On Vercel there is no long-running process — sending is driven by /api/cron/tick instead.
  if (process.env.NEXT_RUNTIME === "nodejs" && !process.env.VERCEL) {
    const { startWorker } = await import("./lib/worker");
    startWorker();
  }
}
