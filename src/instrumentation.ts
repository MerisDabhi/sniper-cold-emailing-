export async function register() {
  // Long-running server (npm run dev / npm start): run the email sender and WhatsApp connections here.
  // On Vercel there's no long-running process: email is sent via /api/cron/tick, and WhatsApp
  // runs in a separate always-on worker (`npm run worker`).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (!process.env.VERCEL) {
      const { startEmailWorker } = await import("./lib/worker");
      startEmailWorker();
      if (process.env.WHATSAPP_ENABLED !== "false") {
        const { startWhatsApp } = await import("./lib/whatsapp/manager");
        startWhatsApp();
      }
    }
  }
}
