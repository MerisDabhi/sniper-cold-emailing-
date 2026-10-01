"use client";

/** Small fetch wrapper for the app's JSON API. Throws with the server's error message. */
export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method || (init?.body ? "POST" : "GET"),
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Not signed in");
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

export function timeAgo(ts?: number | string) {
  if (!ts) return "—";
  const t = typeof ts === "string" ? new Date(ts).getTime() : ts;
  const diff = Date.now() - t;
  const future = diff < 0;
  const s = Math.abs(diff) / 1000;
  const fmt = (n: number, u: string) => (future ? `in ${n}${u}` : `${n}${u} ago`);
  if (s < 60) return future ? "in <1m" : "just now";
  if (s < 3600) return fmt(Math.floor(s / 60), "m");
  if (s < 86400) return fmt(Math.floor(s / 3600), "h");
  return fmt(Math.floor(s / 86400), "d");
}

/** Run `fn` every `ms` while the tab is visible (saves database traffic when it's in the background). */
export function pollWhileVisible(fn: () => void, ms: number) {
  const t = setInterval(() => {
    if (document.visibilityState === "visible") fn();
  }, ms);
  const onShow = () => document.visibilityState === "visible" && fn();
  document.addEventListener("visibilitychange", onShow);
  return () => {
    clearInterval(t);
    document.removeEventListener("visibilitychange", onShow);
  };
}

export const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
