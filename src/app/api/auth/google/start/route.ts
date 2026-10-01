import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { authUrl } from "@/lib/google";

export async function GET(req: NextRequest) {
  const purpose = req.nextUrl.searchParams.get("purpose") === "gmail" ? "gmail" : "owner";
  const hint = req.nextUrl.searchParams.get("hint") || undefined;
  const state = `${purpose}.${crypto.randomBytes(16).toString("hex")}`;
  const res = NextResponse.redirect(authUrl(purpose, state, hint));
  res.cookies.set("sniper_oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
