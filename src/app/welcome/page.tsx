import { AlertCircle, CheckCircle2, FileSpreadsheet, Inbox, Rocket, ShieldCheck, Timer } from "lucide-react";
import { Logo, ThemeToggle } from "@/components/Shell";

export const dynamic = "force-dynamic";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="size-5">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

const steps = [
  { icon: FileSpreadsheet, title: "Connect Google Sheets", text: "Your leads stay in your sheet. Map any column into your emails." },
  { icon: Inbox, title: "Add up to 25 Gmail inboxes", text: "Volume is split evenly so each inbox sends a natural amount." },
  { icon: Timer, title: "Send like a human", text: "One email at a time per inbox, with random 1–3 minute gaps." },
];

export default async function Welcome({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="relative grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden border-r border-border bg-surface lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(600px circle at 20% 10%, color-mix(in srgb, var(--primary) 16%, transparent), transparent 60%), radial-gradient(500px circle at 90% 90%, color-mix(in srgb, var(--violet) 14%, transparent), transparent 60%)",
          }}
        />
        <div className="relative">
          <Logo />
        </div>
        <div className="relative max-w-md">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            Cold outreach that lands in the <span className="text-primary">primary inbox</span>.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-muted">
            Personalized sequences from your Google Sheet, sent through your own Gmail accounts at a human pace — with replies, bounces and unsubscribes tracked automatically.
          </p>
          <div className="mt-10 space-y-5">
            {steps.map(({ icon: Icon, title, text }) => (
              <div key={title} className="flex gap-4">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-surface shadow-card">
                  <Icon className="size-[18px] text-primary" />
                </div>
                <div>
                  <div className="text-sm font-semibold">{title}</div>
                  <div className="mt-0.5 text-sm text-muted">{text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative flex items-center gap-2 text-xs text-faint">
          <ShieldCheck className="size-4" /> Runs on your machine. Tokens never leave your server.
        </div>
      </div>

      <div className="flex flex-col">
        <div className="flex items-center justify-between p-5">
          <div className="lg:invisible">
            <Logo />
          </div>
          <div className="w-32">
            <ThemeToggle />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center px-5 pb-16">
          <div className="animate-fade-up w-full max-w-sm">
            <div className="mb-6 grid size-12 place-items-center rounded-2xl bg-primary-soft">
              <FileSpreadsheet className="size-6 text-primary" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">Connect your Google Sheet</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Sign in with the Google account that owns your lead sheets. You&apos;ll add your sending Gmail inboxes next.
            </p>

            {(!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) && (
              <div className="mt-5 flex gap-2.5 rounded-lg border border-warning/25 bg-warning-soft px-3.5 py-3 text-sm text-warning">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>
                  Database not configured. Add <code className="font-mono">SUPABASE_SECRET_KEY</code> to <code className="font-mono">.env.local</code> and restart the app.
                </span>
              </div>
            )}

            {error && (
              <div className="mt-5 flex gap-2.5 rounded-lg border border-danger/25 bg-danger-soft px-3.5 py-3 text-sm text-danger">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <a
              href="/api/auth/google/start?purpose=owner"
              className="mt-6 flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-border-strong bg-surface text-[15px] font-medium shadow-card transition hover:bg-surface-2 active:scale-[0.99]"
            >
              <GoogleIcon /> Continue with Google
            </a>

            <div className="mt-6 space-y-2.5 rounded-xl border border-border bg-surface-2/60 p-4">
              {["Reads your leads from the sheet you choose", "Only writes one status column — nothing else is changed", "Disconnect any time from Settings"].map((t) => (
                <div key={t} className="flex items-center gap-2 text-[13px] text-muted">
                  <CheckCircle2 className="size-4 text-success" /> {t}
                </div>
              ))}
            </div>
            <p className="mt-6 flex items-center gap-2 text-xs text-faint">
              <Rocket className="size-3.5" /> Takes about 30 seconds.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
