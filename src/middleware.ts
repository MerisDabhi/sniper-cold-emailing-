import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/** Routes reachable without signing in. */
const PUBLIC = [
  "/login",
  "/api/auth/login",
  "/api/t/", // open-tracking pixel
  "/u/", // unsubscribe page
  "/api/unsubscribe",
  "/api/cron/", // protected by CRON_SECRET instead
];

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const user = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (user) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const url = new URL("/login", req.url);
  if (pathname !== "/" && pathname !== "/dashboard") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
