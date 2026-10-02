import "server-only";
import type { WASocket } from "baileys";
import { sb } from "../db";
import { withData } from "../run";
import { acquireLease } from "../lease";
import { errorMessage } from "../google";
import { normalizePhone } from "../phone";
import { clearAuthState, supabaseAuthState } from "./auth";
import { handleIncoming, humanSend, resolveJid, waTick } from "./sender";

/**
 * Keeps every linked WhatsApp number connected (like WhatsApp Web), shows QR codes for new
 * ones, runs the WhatsApp sender, executes commands from the app (test messages) and
 * records replies. Needs a long-running process: `npm run dev`, `npm start` or `npm run worker`.
 * Only the process holding the "whatsapp" lease runs it, so a number is never connected twice.
 */

const LEASE = "whatsapp";
type Conn = { sock: WASocket; status: string; retries: number; retryTimer?: NodeJS.Timeout; closing?: boolean };

class WhatsAppManager {
  private conns = new Map<string, Conn>();
  /** Numbers waiting out a reconnect backoff — the sync loop leaves them alone. */
  private retrying = new Set<string>();
  private active = false;
  private ticking = false;
  private syncing = false;

  start() {
    const loop = (fn: () => Promise<void>, ms: number) => {
      const run = () => fn().catch((e) => console.error("[whatsapp]", e));
      run();
      setInterval(run, ms);
    };
    loop(() => this.holdLease(), 15_000);
    loop(() => this.syncAccounts(), 4_000);
    loop(() => this.runCommands(), 3_000);
    loop(() => this.sendTick(), 20_000);
    loop(() => this.cleanup(), 3_600_000);
    console.log("[whatsapp] manager started");
  }

  private async holdLease() {
    const got = await acquireLease(LEASE, 45);
    if (got && !this.active) console.log("[whatsapp] this process now runs the WhatsApp connections");
    if (!got && this.active) {
      console.log("[whatsapp] another worker took over — disconnecting here");
      for (const id of [...this.conns.keys()]) this.drop(id);
    }
    this.active = got;
  }

  /** Reconcile live sockets with the wa_accounts table. */
  private async syncAccounts() {
    if (!this.active || this.syncing) return;
    this.syncing = true;
    try {
      const { data, error } = await sb().from("wa_accounts").select("id, status");
      if (error) throw new Error(error.message);
      const rows = data || [];
      for (const r of rows) {
        const conn = this.conns.get(r.id);
        if (r.status === "remove_requested") {
          await this.remove(r.id);
        } else if (!conn && !this.retrying.has(r.id) && (r.status === "pending" || r.status === "connected" || r.status === "qr")) {
          // New number, or after a restart: resume the saved session (or show a fresh QR).
          await this.connect(r.id);
        }
      }
      for (const id of [...this.conns.keys()]) if (!rows.some((r) => r.id === id)) this.drop(id);
    } finally {
      this.syncing = false;
    }
  }

  private async update(id: string, patch: Record<string, unknown>) {
    const { error } = await sb().from("wa_accounts").update(patch).eq("id", id);
    if (error) console.error("[whatsapp] could not update number", error.message);
  }

  private drop(id: string) {
    const c = this.conns.get(id);
    if (!c) return;
    c.closing = true;
    clearTimeout(c.retryTimer);
    try {
      c.sock.end(undefined);
    } catch {}
    this.conns.delete(id);
  }

  private async remove(id: string) {
    const c = this.conns.get(id);
    if (c) {
      c.closing = true;
      await c.sock.logout().catch(() => {}); // unlinks the device on the phone
      this.drop(id);
    }
    await clearAuthState(id);
    await sb().from("wa_accounts").delete().eq("id", id);
    console.log(`[whatsapp] removed ${id}`);
  }

  private async connect(id: string, retries = 0) {
    const { default: makeWASocket, Browsers, DisconnectReason, fetchLatestBaileysVersion, jidNormalizedUser, makeCacheableSignalKeyStore } =
      await import("baileys");
    const { default: pino } = await import("pino");
    const logger = pino({ level: "silent" });

    const { state, saveCreds } = await supabaseAuthState(id);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
    const sock = makeWASocket({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      version,
      logger,
      browser: Browsers.windows("Desktop"),
      markOnlineOnConnect: false, // stay "offline" unless actually sending, like a person
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
    });
    const conn: Conn = { sock, status: "connecting", retries };
    this.conns.set(id, conn);
    let qrShown = 0;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (u) => {
      if (conn.closing) return;
      if (u.qr) {
        qrShown++;
        await this.update(id, { status: "qr", qr: u.qr, error: null });
      }
      if (u.connection === "open") {
        conn.retries = 0;
        conn.status = "connected";
        const me = sock.user;
        await this.update(id, {
          status: "connected",
          qr: null,
          error: null,
          phone: me?.id ? jidNormalizedUser(me.id).split("@")[0] : null,
          name: me?.name || me?.verifiedName || null,
          connected_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        });
        console.log(`[whatsapp] ${id} connected as +${me?.id ? jidNormalizedUser(me.id).split("@")[0] : "?"}`);
      }
      if (u.connection === "close") {
        this.conns.delete(id);
        const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          await clearAuthState(id);
          await this.update(id, { status: "logged_out", qr: null, error: "Unlinked from the phone. Scan a new QR code to reconnect." });
          return;
        }
        if (code === DisconnectReason.connectionReplaced) {
          await this.update(id, { status: "disconnected", error: "This number was opened in another session." });
          return;
        }
        const linked = !!state.creds.me;
        if (qrShown > 0 && !linked && code !== DisconnectReason.restartRequired) {
          // QR codes expired without being scanned — stop until the user asks again.
          await this.update(id, { status: "logged_out", qr: null, error: "QR code expired. Click “Show QR code” to try again." });
          return;
        }
        // Temporary drop (network, WhatsApp restart, right after pairing): reconnect with backoff.
        const wait = code === DisconnectReason.restartRequired ? 500 : Math.min(60_000, 2000 * 2 ** retries);
        if (linked && code !== DisconnectReason.restartRequired) await this.update(id, { error: "Reconnecting…" });
        this.retrying.add(id);
        setTimeout(() => {
          this.retrying.delete(id);
          if (this.active && !this.conns.has(id)) this.connect(id, retries + 1).catch((e) => console.error("[whatsapp]", e));
        }, wait);
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const m of messages) {
        const jid = m.key.remoteJid;
        if (!jid || m.key.fromMe || jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) continue;
        const msg = m.message;
        const text =
          msg?.conversation ||
          msg?.extendedTextMessage?.text ||
          msg?.imageMessage?.caption ||
          msg?.videoMessage?.caption ||
          (msg?.audioMessage ? "[voice message]" : msg ? "[message]" : "");
        if (!text) continue;
        const at = Number(m.messageTimestamp) * 1000 || Date.now();
        withData(() => handleIncoming(id, jid, m.key.remoteJidAlt || undefined, text, at)).catch((e) =>
          console.error("[whatsapp] could not record reply", e),
        );
      }
    });
  }

  /** Send due messages from every connected, unpaused number. */
  private async sendTick() {
    if (!this.active || this.ticking) return;
    this.ticking = true;
    try {
      const live = new Map([...this.conns].filter(([, c]) => c.status === "connected").map(([id, c]) => [id, c.sock]));
      await sb().from("wa_accounts").update({ last_seen_at: new Date().toISOString() }).in("id", [...live.keys()]);
      if (live.size) await withData(() => waTick(live));
    } finally {
      this.ticking = false;
    }
  }

  /** Forget finished commands after a day so the table doesn't grow forever. */
  private async cleanup() {
    if (!this.active) return;
    await sb().from("wa_commands").delete().lt("created_at", new Date(Date.now() - 86_400_000).toISOString());
  }

  /** Commands queued by the app, e.g. "send a test message". */
  private async runCommands() {
    if (!this.active) return;
    const { data } = await sb().from("wa_commands").select("*").eq("status", "pending").order("created_at").limit(5);
    for (const cmd of data || []) {
      const conn = this.conns.get(cmd.account_id);
      const finish = (status: "done" | "failed", result: string) => sb().from("wa_commands").update({ status, result }).eq("id", cmd.id);
      if (!conn || conn.status !== "connected") {
        await finish("failed", "This WhatsApp number is not connected right now.");
        continue;
      }
      try {
        if (cmd.type === "test") {
          const phone = normalizePhone(String(cmd.payload.to || ""), String(cmd.payload.countryCode || ""));
          if (!phone) throw new Error("Invalid phone number");
          const jid = await resolveJid(conn.sock, phone);
          if (!jid) throw new Error(`+${phone} is not on WhatsApp`);
          await humanSend(conn.sock, jid, String(cmd.payload.text || ""));
          await finish("done", `+${phone}`);
        } else {
          await finish("failed", "Unknown command");
        }
      } catch (err) {
        await finish("failed", errorMessage(err));
      }
    }
  }
}

const g = globalThis as unknown as { __sniperWhatsApp?: WhatsAppManager };

/** Start the WhatsApp manager once per process. */
export function startWhatsApp() {
  if (g.__sniperWhatsApp) return;
  g.__sniperWhatsApp = new WhatsAppManager();
  g.__sniperWhatsApp.start();
}
