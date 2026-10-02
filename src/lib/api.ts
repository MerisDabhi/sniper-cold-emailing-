import "server-only";
import { NextResponse } from "next/server";
import { errorMessage } from "./google";
import { withData } from "./run";

export { withData };

export const ok = (data: unknown = { ok: true }) => NextResponse.json(data);
export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

/** Wrap a route handler: load data, turn thrown errors into clean JSON responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await withData(() => fn(...args));
    } catch (err) {
      console.error(err);
      return fail(errorMessage(err), 500);
    }
  };
}
