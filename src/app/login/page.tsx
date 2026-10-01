"use client";

import { useState } from "react";
import { AlertCircle, Eye, EyeOff, Lock, User } from "lucide-react";
import { Logo, ThemeToggle } from "@/components/Shell";
import { Button, Input, Label } from "@/components/ui";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error || "Sign-in failed");
    setLoading(false);
  }

  return (
    <div className="relative flex min-h-screen flex-col">
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(520px circle at 50% 0%, color-mix(in srgb, var(--primary) 14%, transparent), transparent 70%)",
        }}
      />
      <div className="relative flex items-center justify-between p-5">
        <Logo />
        <div className="w-32">
          <ThemeToggle />
        </div>
      </div>
      <div className="relative flex flex-1 items-center justify-center px-4 pb-20">
        <form onSubmit={submit} className="animate-fade-up w-full max-w-sm rounded-2xl border border-border bg-surface p-7 shadow-pop">
          <div className="mb-6 grid size-11 place-items-center rounded-xl bg-primary-soft">
            <Lock className="size-5 text-primary" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Sign in to Sniper</h1>
          <p className="mt-1 text-sm text-muted">This workspace is private.</p>

          {error && (
            <div className="mt-5 flex gap-2.5 rounded-lg border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="mt-5 space-y-4">
            <div>
              <Label>Username</Label>
              <div className="relative">
                <User className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
                <Input className="h-10 pl-9" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
              </div>
            </div>
            <div>
              <Label>Password</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
                <Input
                  className="h-10 pr-10 pl-9"
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-faint hover:text-text"
                  aria-label={show ? "Hide password" : "Show password"}
                >
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
          </div>
          <Button type="submit" size="lg" className="mt-6 w-full" loading={loading}>
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
