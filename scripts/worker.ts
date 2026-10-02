/**
 * Standalone always-on worker: keeps WhatsApp numbers connected and sends WhatsApp messages,
 * and (unless WORKER_EMAIL=false) also runs the email sender — so with this running you don't
 * need the /api/cron/tick pinger. Run it on Railway, Render, a VPS, or your own PC:
 *
 *   npm run worker
 *
 * Locally it reads .env.local; on a server, set the same variables in the host's settings.
 */
import fs from "fs";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");

const missing = ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[worker] missing environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

// Log crashes instead of dying silently; the host restarts the process if it exits.
process.on("unhandledRejection", (e) => console.error("[worker] unhandled rejection", e));

// Imported after the environment is loaded: some modules read settings when they load.
(async () => {
  const { startWhatsApp } = await import("../src/lib/whatsapp/manager");
  const { startEmailWorker } = await import("../src/lib/worker");
  startWhatsApp();
  if (process.env.WORKER_EMAIL !== "false") startEmailWorker();
  console.log("[worker] running — press Ctrl+C to stop");
})();
