import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { sb } from "@/lib/db";
import { APP_URL } from "@/lib/google";
import { SESSION_COOKIE, SESSION_MAX_AGE_SEC, signSession } from "@/lib/session";

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60_000;

function verifyPassword(password: string, stored: string) {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a.toLowerCase());
  const y = Buffer.from(b.toLowerCase());
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export async function POST(req: NextRequest) {
  const expectedUser = process.env.APP_USERNAME;
  const expectedHash = process.env.APP_PASSWORD_HASH;
  if (!expectedUser || !expectedHash) {
    return NextResponse.json({ error: "Login is not configured (APP_USERNAME / APP_PASSWORD_HASH missing)" }, { status: 500 });
  }

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  const { count, error } = await sb().from("login_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).gte("at", since);
  if (error) return NextResponse.json({ error: "Could not reach the database" }, { status: 503 });
  if ((count ?? 0) >= MAX_FAILURES) {
    return NextResponse.json({ error: "Too many failed attempts. Try again in 15 minutes." }, { status: 429 });
  }

  const { username, password } = await req.json().catch(() => ({}));
  const valid = typeof username === "string" && typeof password === "string" && safeEqual(username.trim(), expectedUser) && verifyPassword(password, expectedHash);

  if (!valid) {
    await sb().from("login_attempts").insert({ ip });
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return NextResponse.json({ error: "Wrong username or password" }, { status: 401 });
  }

  await sb().from("login_attempts").delete().eq("ip", ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await signSession(expectedUser), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: APP_URL.startsWith("https"),
    maxAge: SESSION_MAX_AGE_SEC,
  });
  return res;
}
