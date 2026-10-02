import "server-only";
import crypto from "crypto";
import os from "os";
import { sb } from "./db";

/** Identifies this running process when taking a lease. */
export const HOLDER = `${os.hostname()}-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;

/**
 * Take or renew a named lease. Only one process holds a lease at a time, so e.g. a local dev
 * server and a deployed worker never both run the WhatsApp connections or the email sender.
 * Renewing also records a heartbeat the app uses to show "worker online".
 */
export async function acquireLease(name: string, seconds: number, holder = HOLDER): Promise<boolean> {
  const { data, error } = await sb().rpc("acquire_worker_lease", { p_name: name, p_holder: holder, p_seconds: seconds });
  if (error) {
    console.error(`[lease] ${name}: ${error.message}`);
    return false;
  }
  return data === true;
}

/** Is any process currently holding this lease (i.e. is that worker online)? */
export async function leaseAlive(name: string): Promise<{ online: boolean; heartbeatAt?: string }> {
  const { data } = await sb().from("workers").select("heartbeat_at, lease_until").eq("name", name).maybeSingle();
  if (!data) return { online: false };
  return { online: new Date(data.lease_until).getTime() > Date.now(), heartbeatAt: data.heartbeat_at };
}
