import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { authUrl } from "@/lib/google";
import { OAUTH_CALLBACK_PATH, requestOrigin } from "@/lib/url";

export async function GET(req: NextRequest) {
  const purpose = req.nextUrl.searchParams.get("purpose") === "gmail" ? "gmail" : "owner";
  const hint = req.nextUrl.searchParams.get("hint") || undefined;
  const state = `${purpose}.${crypto.randomBytes(16).toString("hex")}`;
  // Google sends the user back to the same domain they started on.
  const redirectUri = requestOrigin(req.headers, req.nextUrl.origin) + OAUTH_CALLBACK_PATH;
  const res = NextResponse.redirect(authUrl(purpose, state, redirectUri, hint));
  res.cookies.set("sniper_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
    secure: redirectUri.startsWith("https"),
  });
  return res;
}
