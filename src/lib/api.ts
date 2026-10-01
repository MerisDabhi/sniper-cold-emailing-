import "server-only";
import { NextResponse } from "next/server";
import { errorMessage } from "./google";
import { SERVERLESS, withStore, type Scope } from "./db";
import { flushSheetStatuses } from "./sheetSync";

export const ok = (data: unknown = { ok: true }) => NextResponse.json(data);
export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

/**
 * Run work with the database loaded. On Vercel this also writes queued Google Sheet
 * statuses before the function ends (there is no background worker there).
 */
export function withData<T>(scope: Scope, fn: () => Promise<T>, opts?: { replyCheck?: boolean }) {
  return withStore(
    scope,
    async () => {
      const result = await fn();
      if (SERVERLESS) await flushSheetStatuses().catch((e) => console.error("[sheet-sync]", e));
      return result;
    },
    opts,
  );
}

/** Wrap a route handler: load data, turn thrown errors into clean JSON responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await withData("full", () => fn(...args));
    } catch (err) {
      console.error(err);
      return fail(errorMessage(err), 500);
    }
  };
}
