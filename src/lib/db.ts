import "server-only";
import crypto from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppEvent, DB, Lead } from "./types";

/**
 * Supabase-backed unit-of-work store.
 *
 * Every API request, sender run and WhatsApp event runs inside `withStore(...)`, which loads
 * a small private working set — owner, inboxes, WhatsApp numbers, campaigns, unsubscribes
 * and the last 48h of sends — and lets the code fetch exactly the leads it needs with
 * `fetchLeads()`. Lists and statistics are read with direct queries / the `lead_rollup`
 * view instead of loading every lead.
 *
 * When the unit of work ends, only the *fields* that changed are written back, so two
 * processes touching the same lead at the same moment (e.g. a WhatsApp reply arriving while
 * a follow-up is being sent) don't overwrite each other. A lead's final status (replied,
 * unsubscribed, bounced, already contacted) is never replaced by a stale working status.
 * Duplicate-send guarantees live in the database itself (see dedupe.ts).
 */

export const SERVERLESS = !!process.env.VERCEL;

type TableName = "owner" | "accounts" | "campaigns" | "leads" | "unsubscribes";
type Row = Record<string, unknown>;

const COLUMNS: Record<TableName, { key: string; cols: string[] }> = {
  owner: { key: "id", cols: ["id", "email", "name", "picture", "tokens", "connected_at"] },
  accounts: {
    key: "id",
    cols: ["id", "email", "name", "picture", "tokens", "status", "error", "daily_limit", "signature", "next_send_at", "connected_at"],
  },
  campaigns: {
    key: "id",
    cols: [
      "id", "name", "channel", "status", "sheet", "mapping", "steps", "schedule", "daily_limit", "account_ids", "stop_on_reply",
      "track_opens", "unsubscribe_footer", "unsubscribe_text", "sheet_status", "sheet_status_column", "country_code", "created_at",
      "launched_at", "last_synced_at",
    ],
  },
  leads: {
    key: "id",
    cols: [
      "id", "campaign_id", "email", "phone", "wa_jid", "data", "account_id", "status", "step_index", "next_at", "thread_id",
      "first_message_id", "first_subject", "last_sent_at", "replied_at", "opened_at", "last_checked_at", "error", "token",
    ],
  },
  unsubscribes: { key: "email", cols: ["email", "at", "source"] },
};
const EVENT_COLS = ["id", "type", "at", "campaign_id", "account_id", "lead_id", "email", "step", "detail"];
const WA_COLS = [
  "id", "label", "phone", "name", "status", "paused", "qr", "error", "daily_limit", "next_send_at", "last_seen_at", "connected_at", "created_at",
];

/** Lead statuses that end a lead's sequence for good. */
const FINAL_STATUSES = ["replied", "unsubscribed", "bounced", "duplicate"];

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Integer columns (bigint ms timestamps and int counters): Postgres rejects fractions like 1790968333036.69. */
const INTEGER_COLS = new Set([
  "next_send_at", "next_at", "last_sent_at", "replied_at", "opened_at", "last_checked_at", "at", "daily_limit", "step_index", "step",
]);

function toRow(obj: Row, cols: string[]): Row {
  const r: Row = {};
  for (const c of cols) {
    const v = obj[camel(c)] ?? null;
    r[c] = typeof v === "number" && INTEGER_COLS.has(c) ? Math.round(v) : v;
  }
  return r;
}

function fromRow<T>(row: Row, cols: string[]): T {
  const o: Row = {};
  for (const c of cols) if (row[c] !== null && row[c] !== undefined) o[camel(c)] = row[c];
  return o as T;
}

export const leadFromRow = (row: Row) => fromRow<Lead>(row, COLUMNS.leads.cols);
export const eventFromRow = (row: Row) => fromRow<AppEvent>(row, EVENT_COLS);
export const LEAD_COLUMNS = COLUMNS.leads.cols.join(",");

/** Snapshot of a row as loaded: column → JSON string, for field-level change detection. */
type Snap = Map<string, Record<string, string>>;
const snapOf = (row: Row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, JSON.stringify(v)]));

type Store = {
  data: DB;
  snap: Record<TableName, Snap>;
  eventQueue: AppEvent[];
};

const g = globalThis as unknown as { __sniperSb?: SupabaseClient };
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

function store(): Store {
  const s = als.getStore();
  if (!s) throw new Error("Database used outside of withStore()");
  return s;
}

// ─── Loading ───────────────────────────────────────────────────────────────

export type Query = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

/** Fetch every matching row, 1000 at a time (PostgREST page limit). */
export async function fetchAll(table: string, build?: (q: Query) => Query, columns = "*"): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb().from(table).select(columns) as Query;
    if (build) q = build(q);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(`Supabase: failed to load ${table}: ${error.message}`);
    out.push(...((data || []) as unknown as Row[]));
    if (!data || data.length < 1000) return out;
  }
}

function track(s: Store, t: TableName, rows: Row[]) {
  const { key, cols } = COLUMNS[t];
  for (const r of rows) s.snap[t].set(String(r[key]), snapOf(toRow(fromRow(r, cols), cols)));
}

async function load(s: Store) {
  const [owner, accounts, waAccounts, campaigns, unsubscribes, events] = await Promise.all([
    fetchAll("owner"),
    fetchAll("accounts"),
    fetchAll("wa_accounts", (q) => q.order("created_at", { ascending: true })),
    fetchAll("campaigns"),
    fetchAll("unsubscribes"),
    // Recent sends drive the daily quotas.
    fetchAll("events", (q) => q.eq("type", "sent").gte("at", Date.now() - 2 * 86_400_000).order("at", { ascending: true })),
  ]);
  track(s, "owner", owner);
  track(s, "accounts", accounts);
  track(s, "campaigns", campaigns);
  track(s, "unsubscribes", unsubscribes);
  s.data = {
    owner: owner[0] ? fromRow(owner[0], COLUMNS.owner.cols) : null,
    accounts: accounts.map((r) => fromRow(r, COLUMNS.accounts.cols)),
    waAccounts: waAccounts.map((r) => fromRow(r, WA_COLS)),
    campaigns: campaigns.map((r) => fromRow(r, COLUMNS.campaigns.cols)),
    leads: [],
    unsubscribes: unsubscribes.map((r) => fromRow(r, COLUMNS.unsubscribes.cols)),
    events: events.map((r) => fromRow(r, EVENT_COLS)),
  };
}

/**
 * Load leads matching a query into the current unit of work (tracked for saving).
 * `all: true` pages through every match; otherwise the query's own limit applies.
 * Leads already loaded are returned as the same objects.
 */
export async function fetchLeads(build: (q: Query) => Query, opts: { all?: boolean } = {}): Promise<Lead[]> {
  const s = store();
  let rows: Row[];
  if (opts.all) {
    rows = await fetchAll("leads", (q) => build(q).order("seq", { ascending: true }));
  } else {
    const { data, error } = await build(sb().from("leads").select("*") as Query);
    if (error) throw new Error(`Supabase: failed to load leads: ${error.message}`);
    rows = (data || []) as unknown as Row[];
  }
  const byId = new Map(s.data.leads.map((l) => [l.id, l]));
  const out: Lead[] = [];
  for (const r of rows) {
    const existing = byId.get(r.id as string);
    if (existing) {
      out.push(existing);
      continue;
    }
    const lead = fromRow<Lead>(r, COLUMNS.leads.cols);
    track(s, "leads", [r]);
    s.data.leads.push(lead);
    byId.set(lead.id, lead);
    out.push(lead);
  }
  return out;
}

/** Read events (not tracked — events are append-only). */
export async function fetchEvents(build: (q: Query) => Query): Promise<AppEvent[]> {
  const rows = await fetchAll("events", build);
  return rows.map((r) => fromRow<AppEvent>(r, EVENT_COLS));
}

/** Run `fn` with its own freshly loaded working set; changes are saved before it returns. */
export async function withStore<T>(fn: () => Promise<T>): Promise<T> {
  if (als.getStore()) return fn(); // already inside a unit of work
  const s: Store = {
    data: { owner: null, accounts: [], waAccounts: [], campaigns: [], leads: [], events: [], unsubscribes: [] },
    snap: { owner: new Map(), accounts: new Map(), campaigns: new Map(), leads: new Map(), unsubscribes: new Map() },
    eventQueue: [],
  };
  return als.run(s, async () => {
    await load(s);
    try {
      return await fn();
    } finally {
      await persist();
    }
  });
}

export function db(): DB {
  return store().data;
}

// ─── Saving ────────────────────────────────────────────────────────────────

function rowsOf(t: TableName, d: DB): Row[] {
  if (t === "owner") return d.owner ? [{ ...d.owner, id: "owner" }] : [];
  return d[t] as unknown as Row[];
}

/** Write the changes of the current unit of work to Supabase (field by field). */
export async function persist() {
  const s = store();
  const d = s.data;
  const failures: string[] = [];
  // Leads first: they record what was sent. A failure in one table doesn't stop the others.
  for (const t of ["leads", "unsubscribes", "campaigns", "accounts", "owner"] as TableName[]) {
    try {
      await persistTable(s, d, t);
    } catch (err) {
      failures.push((err as Error).message);
    }
  }
  try {
    await persistEvents(s);
  } catch (err) {
    failures.push((err as Error).message);
  }
  if (failures.length) throw new Error(failures.join("; "));
}

async function persistTable(s: Store, d: DB, t: TableName) {
  {
    const { key, cols } = COLUMNS[t];
    const seen = new Set<string>();
    const inserts: Row[] = [];
    // Rows with identical changes are updated together: patch JSON → ids.
    const groups = new Map<string, { patch: Row; ids: string[]; guardFinal: boolean }>();

    for (const obj of rowsOf(t, d)) {
      const row = toRow(obj, cols);
      const id = String(row[key]);
      seen.add(id);
      const before = s.snap[t].get(id);
      if (!before) {
        inserts.push(row);
        continue;
      }
      const patch: Row = {};
      for (const c of cols) if (c !== key && before[c] !== JSON.stringify(row[c])) patch[c] = row[c];
      if (!Object.keys(patch).length) continue;

      // Never let a stale working status overwrite a final one written by someone else.
      if (t === "leads" && "status" in patch && !FINAL_STATUSES.includes(String(patch.status))) {
        const { status, ...rest } = patch;
        if (Object.keys(rest).length) addGroup(groups, rest, id, false);
        addGroup(groups, { status }, id, true);
      } else {
        addGroup(groups, patch, id, false);
      }
      s.snap[t].set(id, snapOf(row));
    }

    for (let i = 0; i < inserts.length; i += 500) {
      const chunk = inserts.slice(i, i + 500);
      const { error } = await sb().from(t).upsert(chunk, { onConflict: key });
      if (error) throw new Error(`Could not save ${t}: ${error.message}`);
      for (const r of chunk) s.snap[t].set(String(r[key]), snapOf(r));
    }
    for (const { patch, ids, guardFinal } of groups.values()) {
      for (let i = 0; i < ids.length; i += 200) {
        let q = sb().from(t).update(patch).in(key, ids.slice(i, i + 200));
        if (guardFinal) q = q.not("status", "in", `(${FINAL_STATUSES.join(",")})`);
        const { error } = await q;
        if (error) throw new Error(`Could not save ${t}: ${error.message}`);
      }
    }
    const removed = [...s.snap[t].keys()].filter((id) => !seen.has(id));
    for (let i = 0; i < removed.length; i += 200) {
      const chunk = removed.slice(i, i + 200);
      const { error } = await sb().from(t).delete().in(key, chunk);
      if (error) throw new Error(`Could not delete ${t}: ${error.message}`);
      for (const id of chunk) s.snap[t].delete(id);
    }
  }
}

async function persistEvents(s: Store) {
  while (s.eventQueue.length) {
    const batch = s.eventQueue.splice(0, 1000);
    const { error } = await sb()
      .from("events")
      .upsert(batch.map((e) => toRow(e as unknown as Row, EVENT_COLS)), { onConflict: "id", ignoreDuplicates: true });
    if (error) {
      s.eventQueue.unshift(...batch);
      throw new Error(`Could not save events: ${error.message}`);
    }
  }
}

function addGroup(groups: Map<string, { patch: Row; ids: string[]; guardFinal: boolean }>, patch: Row, id: string, guardFinal: boolean) {
  const k = `${guardFinal ? "g" : "u"}:${JSON.stringify(patch)}`;
  const grp = groups.get(k);
  if (grp) grp.ids.push(id);
  else groups.set(k, { patch, ids: [id], guardFinal });
}

/** Kept for readability at call sites: changes are saved when the unit of work ends. */
export function save() {}

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
}

/** Strip OAuth tokens before sending accounts to the browser. */
export function publicAccount(a: DB["accounts"][number]) {
  const { tokens, ...rest } = a;
  void tokens;
  return rest;
}
