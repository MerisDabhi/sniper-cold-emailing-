import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { withData } from "@/lib/api";
import { checkReplies, tick } from "@/lib/engine";
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
 * The sender for serverless hosting (Vercel). Call it once a minute:
 *   - Vercel Cron (Pro plan): add a "* * * * *" cron for /api/cron/tick in vercel.json
 *   - or a free pinger such as cron-job.org with header `Authorization: Bearer <CRON_SECRET>`
 * Each run sends at most one email per inbox (respecting gaps, windows and limits),
 * checks replies every 3rd minute, and writes sheet statuses.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const replyCheck = new Date().getUTCMinutes() % 3 === 0;
  const started = Date.now();
  try {
    await withData(
      "cron",
      async () => {
        await tick();
        if (replyCheck) await checkReplies(10);
      },
      { replyCheck },
    );
    return NextResponse.json({ ok: true, replyCheck, ms: Date.now() - started });
  } catch (err) {
    console.error("[cron]", err);
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export const POST = GET;
