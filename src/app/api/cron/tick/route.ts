import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { runEmailSender } from "@/lib/worker";
import { acquireLease } from "@/lib/lease";
import { errorMessage } from "@/lib/google";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || req.nextUrl.searchParams.get("secret") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * The email sender for Vercel. Call it once a minute (cron-job.org, or Vercel Cron on Pro)
 * with `Authorization: Bearer <CRON_SECRET>`. If an always-on worker already runs the email
 * sender, this skips (they share the "email" lease). WhatsApp always runs in the worker.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const started = Date.now();
  try {
    if (!(await acquireLease("email", 90, "vercel-cron"))) {
      return NextResponse.json({ ok: true, skipped: "another worker is sending email" });
    }
    const replyCheck = new Date().getUTCMinutes() % 3 === 0;
    await runEmailSender({ replyCheck, replyLimit: 10 });
    return NextResponse.json({ ok: true, replyCheck, ms: Date.now() - started });
  } catch (err) {
    console.error("[cron]", err);
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export const POST = GET;
