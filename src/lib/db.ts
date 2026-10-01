import "server-only";
import crypto from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppEvent, DB, Lead } from "./types";

/**
 * Supabase-backed store with two modes.
 *
 * Long-running server (`npm run dev` / `npm start` on a VPS):
 *   one shared in-memory copy is loaded at startup; every change is written back to
 *   Supabase within ~0.5s. A background worker sends emails.
 *
 * Serverless (Vercel, detected via the VERCEL env var):
 *   every request gets its own private copy (AsyncLocalStorage), loaded fresh from
 *   Supabase and saved before the response is returned — so concurrent requests on
 *   different instances never share stale state. The every-minute cron loads only
 *   the leads that are due ("cron" scope) to keep database traffic small.
 *
 * Only rows that actually changed are upserted, and only rows that were loaded can be
 * deleted. Duplicate-send guarantees don't depend on this layer at all (see dedupe.ts).
 */

export const SERVERLESS = !!process.env.VERCEL;
const EVENT_WINDOW_MS = 45 * 86_400_000;
const FLUSH_DELAY_MS = 500;

type TableName = "owner" | "accounts" | "campaigns" | "leads" | "unsubscribes";
type Row = Record<string, unknown>;
export type Scope = "full" | "cron";

const COLUMNS: Record<TableName, { key: string; cols: string[] }> = {
  owner: { key: "id", cols: ["id", "email", "name", "picture", "tokens", "connected_at"] },
  accounts: {
    key: "id",
    cols: ["id", "email", "name", "picture", "tokens", "status", "error", "daily_limit", "signature", "next_send_at", "connected_at"],
  },
  campaigns: {
    key: "id",
    cols: [
      "id", "name", "status", "sheet", "mapping", "steps", "schedule", "daily_limit", "account_ids", "stop_on_reply", "track_opens",
      "unsubscribe_footer", "unsubscribe_text", "sheet_status", "sheet_status_column", "created_at", "launched_at", "last_synced_at",
    ],
  },
  leads: {
    key: "id",
    cols: [
      "id", "campaign_id", "email", "data", "account_id", "status", "step_index", "next_at", "thread_id", "first_message_id",
      "first_subject", "last_sent_at", "replied_at", "opened_at", "last_checked_at", "error", "token",
    ],
  },
  unsubscribes: { key: "email", cols: ["email", "at", "source"] },
};
const EVENT_COLS = ["id", "type", "at", "campaign_id", "account_id", "lead_id", "email", "step", "detail"];

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function toRow(obj: Row, cols: string[]): Row {
  const r: Row = {};
  for (const c of cols) r[c] = obj[camel(c)] ?? null;
  return r;
}

function fromRow<T>(row: Row, cols: string[]): T {
  const o: Row = {};
  for (const c of cols) if (row[c] !== null && row[c] !== undefined) o[camel(c)] = row[c];
  return o as T;
}

export const leadFromRow = (row: Row) => fromRow<Lead>(row, COLUMNS.leads.cols);
export const LEAD_COLUMNS = COLUMNS.leads.cols.join(",");

type Store = {
  data: DB;
  loaded: boolean;
  scope: Scope;
  loading?: Promise<void>;
  snap: Record<TableName, Map<string, string>>;
  eventQueue: AppEvent[];
  timer: NodeJS.Timeout | null;
  flushing: Promise<boolean> | null;
  again: boolean;
};

const g = globalThis as unknown as { __sniperStore?: Store; __sniperSb?: SupabaseClient };
const als = new AsyncLocalStorage<Store>();

export function sb(): SupabaseClient {
  if (!g.__sniperSb) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY are missing");
    g.__sniperSb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return g.__sniperSb;
}

function newStore(): Store {
  return {
    data: { owner: null, accounts: [], campaigns: [], leads: [], events: [], unsubscribes: [] },
    loaded: false,
    scope: "full",
    snap: { owner: new Map(), accounts: new Map(), campaigns: new Map(), leads: new Map(), unsubscribes: new Map() },
    eventQueue: [],
    timer: null,
    flushing: null,
    again: false,
  };
}

function store(): Store {
  const scoped = als.getStore();
  if (scoped) return scoped;
  if (SERVERLESS) throw new Error("Database used outside of a request context");
  if (!g.__sniperStore) g.__sniperStore = newStore();
  return g.__sniperStore;
}

// ─── Loading ───────────────────────────────────────────────────────────────

type Query = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

/** Fetch every matching row, 1000 at a time (PostgREST page limit). */
async function fetchAll(table: string, build?: (q: Query) => Query): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb().from(table).select("*") as Query;
    if (build) q = build(q);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(`Supabase: failed to load ${table}: ${error.message}`);
    out.push(...(data as Row[]));
    if (!data || data.length < 1000) return out;
  }
}

function install(s: Store, raw: Record<TableName, Row[]>, events: Row[], scope: Scope) {
  for (const t of Object.keys(raw) as TableName[]) {
    const { key, cols } = COLUMNS[t];
    s.snap[t].clear();
    for (const r of raw[t]) s.snap[t].set(String(r[key]), JSON.stringify(toRow(fromRow(r, cols), cols)));
  }
  s.data = {
    owner: raw.owner[0] ? fromRow(raw.owner[0], COLUMNS.owner.cols) : null,
    accounts: raw.accounts.map((r) => fromRow(r, COLUMNS.accounts.cols)),
    campaigns: raw.campaigns.map((r) => fromRow(r, COLUMNS.campaigns.cols)),
    leads: raw.leads.map((r) => fromRow(r, COLUMNS.leads.cols)),
    unsubscribes: raw.unsubscribes.map((r) => fromRow(r, COLUMNS.unsubscribes.cols)),
    events: events.map((r) => fromRow(r, EVENT_COLS)),
  };
  s.scope = scope;
  s.loaded = true;
}

async function loadFull(s: Store) {
  const [owner, accounts, campaigns, leads, unsubscribes, events] = await Promise.all([
    fetchAll("owner"),
    fetchAll("accounts"),
    fetchAll("campaigns"),
    fetchAll("leads", (q) => q.order("seq", { ascending: true })),
    fetchAll("unsubscribes"),
    fetchAll("events", (q) => q.gte("at", Date.now() - EVENT_WINDOW_MS).order("at", { ascending: true })),
  ]);
  install(s, { owner, accounts, campaigns, leads, unsubscribes }, events, "full");
}

/**
 * Minimal working set for one sender run: inboxes, campaigns, the next few due leads per
 * inbox, (optionally) leads whose threads need a reply check, and the last 48h of sends
 * for the daily quotas.
 */
async function loadCron(s: Store, withReplyCheck: boolean) {
  const now = Date.now();
  const [owner, accounts, campaigns, unsubscribes, events] = await Promise.all([
    fetchAll("owner"),
    fetchAll("accounts"),
    fetchAll("campaigns"),
    fetchAll("unsubscribes"),
    fetchAll("events", (q) => q.eq("type", "sent").gte("at", now - 2 * 86_400_000).order("at", { ascending: true })),
  ]);
  const active = campaigns.filter((c) => c.status === "active").map((c) => c.id as string);
  const leadMap = new Map<string, Row>();
  const add = (rows: Row[] | null) => rows?.forEach((r) => leadMap.set(r.id as string, r));

  await Promise.all(
    accounts
      .filter((a) => a.status === "active")
      .map(async (a) => {
        const jobs = [];
        if (active.length) {
          jobs.push(
            sb().from("leads").select("*").eq("account_id", a.id).in("campaign_id", active).eq("status", "in_progress").lte("next_at", now).order("next_at").limit(3),
            sb().from("leads").select("*").eq("account_id", a.id).in("campaign_id", active).eq("status", "pending").order("seq").limit(3),
          );
        }
        if (withReplyCheck) {
          jobs.push(
            sb()
              .from("leads")
              .select("*")
              .eq("account_id", a.id)
              .in("status", ["in_progress", "completed"])
              .not("thread_id", "is", null)
              .is("replied_at", null)
              .gt("last_sent_at", now - 45 * 86_400_000)
              .order("last_checked_at", { ascending: true, nullsFirst: true })
              .limit(10),
          );
        }
        for (const r of await Promise.all(jobs)) {
          if (r.error) throw new Error(`Supabase: failed to load leads: ${r.error.message}`);
          add(r.data as Row[]);
        }
      }),
  );
  install(s, { owner, accounts, campaigns, leads: [...leadMap.values()], unsubscribes }, events, "cron");
}

/** Long-running mode: load the shared store once. (No-op inside a serverless request.) */
export function ready(): Promise<void> {
  const s = store();
  if (s.loaded) return Promise.resolve();
  if (!s.loading) {
    s.loading = loadFull(s).then(
      () => console.log(`[db] loaded from Supabase: ${s.data.campaigns.length} campaigns, ${s.data.leads.length} leads, ${s.data.accounts.length} inboxes`),
      (err) => {
        s.loading = undefined;
        throw err;
      },
    );
  }
  return s.loading;
}

/**
 * Run `fn` with data loaded. Serverless: a private store for this request, saved to
 * Supabase before returning. Long-running: the shared store.
 */
export async function withStore<T>(scope: Scope, fn: () => Promise<T>, opts: { replyCheck?: boolean } = {}): Promise<T> {
  if (!SERVERLESS) {
    await ready();
    return fn();
  }
  const s = newStore();
  return als.run(s, async () => {
    if (scope === "full") await loadFull(s);
    else await loadCron(s, !!opts.replyCheck);
    try {
      return await fn();
    } finally {
      await persist();
    }
  });
}

export function db(): DB {
  const s = store();
  if (!s.loaded) throw new Error("Database not loaded yet");
  return s.data;
}

/** True when only a partial set of leads is loaded (serverless sender run). */
export function isPartial() {
  return store().scope === "cron";
}

// ─── Saving ────────────────────────────────────────────────────────────────

function rowsOf(t: TableName, d: DB): Row[] {
  if (t === "owner") return d.owner ? [{ ...d.owner, id: "owner" }] : [];
  return d[t] as unknown as Row[];
}

async function writeChanges(s: Store) {
  const d = s.data;
  for (const t of ["owner", "accounts", "campaigns", "leads", "unsubscribes"] as TableName[]) {
    const { key, cols } = COLUMNS[t];
    const seen = new Set<string>();
    const changed: { id: string; json: string; row: Row }[] = [];
    for (const obj of rowsOf(t, d)) {
      const row = toRow(obj, cols);
      const id = String(row[key]);
      seen.add(id);
      const json = JSON.stringify(row);
      if (s.snap[t].get(id) !== json) changed.push({ id, json, row });
    }
    for (let i = 0; i < changed.length; i += 500) {
      const chunk = changed.slice(i, i + 500);
      const { error } = await sb().from(t).upsert(chunk.map((c) => c.row), { onConflict: key });
      if (error) throw new Error(`upsert ${t}: ${error.message}`);
      for (const c of chunk) s.snap[t].set(c.id, c.json);
    }
    const removed = [...s.snap[t].keys()].filter((id) => !seen.has(id));
    for (let i = 0; i < removed.length; i += 200) {
      const chunk = removed.slice(i, i + 200);
      const { error } = await sb().from(t).delete().in(key, chunk);
      if (error) throw new Error(`delete ${t}: ${error.message}`);
      for (const id of chunk) s.snap[t].delete(id);
    }
  }
  while (s.eventQueue.length) {
    const batch = s.eventQueue.splice(0, 1000);
    const { error } = await sb().from("events").upsert(batch.map((e) => toRow(e as unknown as Row, EVENT_COLS)), { onConflict: "id", ignoreDuplicates: true });
    if (error) {
      s.eventQueue.unshift(...batch);
      throw new Error(`insert events: ${error.message}`);
    }
  }
}

/** Write pending changes of a store. Returns false if Supabase rejected the write. */
function flush(s: Store): Promise<boolean> {
  if (s.timer) {
    clearTimeout(s.timer);
    s.timer = null;
  }
  if (s.flushing) {
    s.again = true;
    return s.flushing;
  }
  s.flushing = (async () => {
    let ok = true;
    try {
      await writeChanges(s);
    } catch (err) {
      ok = false;
      console.error("[db] Supabase write failed:", (err as Error).message);
    } finally {
      s.flushing = null;
    }
    if (!ok && !SERVERLESS) s.timer = setTimeout(() => flush(s), 5000);
    else if (s.again) {
      s.again = false;
      return flush(s);
    }
    return ok;
  })();
  return s.flushing;
}

/** Mark the store dirty; changes are written to Supabase within ~0.5s. */
export function save() {
  const s = store();
  if (!s.timer && !s.flushing) s.timer = setTimeout(() => flush(s), FLUSH_DELAY_MS);
  else if (s.flushing) s.again = true;
}

/** Write everything now and wait for it (used at the end of serverless requests). */
export async function persist() {
  const s = store();
  while (s.flushing) await s.flushing;
  if (!(await flush(s))) throw new Error("Could not save changes to the database");
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function id(prefix = ""): string {
  return prefix + crypto.randomBytes(8).toString("hex");
}

export function token(): string {
  return crypto.randomBytes(16).toString("base64url");
}

export function pushEvent(e: Omit<AppEvent, "id" | "at"> & { at?: number }) {
  const s = store();
  const ev: AppEvent = { id: id("e_"), at: e.at ?? Date.now(), ...e };
  s.data.events.push(ev);
  s.eventQueue.push(ev);
  const cutoff = Date.now() - EVENT_WINDOW_MS;
  if (s.data.events.length > 1000 && s.data.events[0].at < cutoff) {
    const keepFrom = s.data.events.findIndex((x) => x.at >= cutoff);
    s.data.events.splice(0, keepFrom === -1 ? s.data.events.length : keepFrom);
  }
  save();
}

/** Strip OAuth tokens before sending accounts to the browser. */
export function publicAccount(a: DB["accounts"][number]) {
  const { tokens, ...rest } = a;
  void tokens;
  return rest;
}
