import { NextRequest, NextResponse } from "next/server";
import { db, id, save } from "@/lib/db";
import { withData } from "@/lib/api";
import { APP_URL, errorMessage, fetchProfile, oauthClient } from "@/lib/google";

const MAX_ACCOUNTS = 25;

function back(path: string, params: Record<string, string>) {
  const u = new URL(path, APP_URL);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = NextResponse.redirect(u);
  res.cookies.delete("sniper_oauth_state");
  return res;
}

/**
 * Google OAuth return URL. The user is already signed in to Sniper (middleware enforces it);
 * this only stores Google access — for the Sheets account ("owner") or a Gmail sending inbox.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const state = sp.get("state") || "";
  const purpose = state.startsWith("gmail.") ? "gmail" : "owner";
  const errPath = purpose === "gmail" ? "/accounts" : "/welcome";

  if (sp.get("error")) return back(errPath, { error: sp.get("error") === "access_denied" ? "Access was denied" : sp.get("error")! });
  if (!state || state !== req.cookies.get("sniper_oauth_state")?.value) return back(errPath, { error: "Login expired, please try again" });

  try {
    const client = oauthClient();
    const { tokens } = await client.getToken(sp.get("code") || "");
    client.setCredentials(tokens);
    const profile = await fetchProfile(client);
    const granted = tokens.scope || "";

    if (purpose === "owner") {
      if (!granted.includes("spreadsheets")) return back("/welcome", { error: "Please allow access to Google Sheets" });
      await withData(async () => {
        const d = db();
        const sameAccount = d.owner?.email === profile.email;
        d.owner = {
          ...profile,
          tokens: { ...tokens, refresh_token: tokens.refresh_token || (sameAccount ? d.owner?.tokens.refresh_token : undefined) },
          connectedAt: sameAccount && d.owner ? d.owner.connectedAt : new Date().toISOString(),
        };
        save();
      });
      return back("/dashboard", {});
    }

    if (!granted.includes("gmail.send")) return back("/accounts", { error: "Please tick the Gmail permission checkboxes on Google's screen" });

    const outcome = await withData(async () => {
      const d = db();
      const existing = d.accounts.find((a) => a.email === profile.email);
      if (existing) {
        existing.tokens = { ...tokens, refresh_token: tokens.refresh_token || existing.tokens.refresh_token };
        existing.status = "active";
        existing.error = undefined;
        existing.picture = profile.picture;
      } else {
        if (d.accounts.length >= MAX_ACCOUNTS) return "full";
        d.accounts.push({
          id: id("a_"),
          email: profile.email,
          name: profile.name,
          picture: profile.picture,
          tokens,
          status: "active",
          dailyLimit: 30,
          signature: "",
          nextSendAt: 0,
          connectedAt: new Date().toISOString(),
        });
      }
      save();
      return "ok";
    });
    if (outcome === "full") return back("/accounts", { error: `You can connect up to ${MAX_ACCOUNTS} inboxes` });
    return back("/accounts", { connected: profile.email });
  } catch (err) {
    return back(errPath, { error: errorMessage(err) });
  }
}
