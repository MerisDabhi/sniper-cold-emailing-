"use client";

import { use, useState } from "react";
import { CheckCircle2, MailX } from "lucide-react";
import { Button } from "@/components/ui";

export default function Unsubscribe({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function confirm() {
    setState("loading");
    const res = await fetch("/api/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    setState(res.ok ? "done" : "error");
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="animate-fade-up w-full max-w-sm rounded-2xl border border-border bg-surface p-8 text-center shadow-card">
        {state === "done" ? (
          <>
            <CheckCircle2 className="mx-auto size-10 text-success" />
            <h1 className="mt-4 text-lg font-semibold">You&apos;re unsubscribed</h1>
            <p className="mt-2 text-sm text-muted">You won&apos;t receive any more emails from me. Sorry for the interruption!</p>
          </>
        ) : (
          <>
            <MailX className="mx-auto size-10 text-muted" />
            <h1 className="mt-4 text-lg font-semibold">Unsubscribe?</h1>
            <p className="mt-2 text-sm text-muted">Click below and you won&apos;t hear from me again.</p>
            {state === "error" && <p className="mt-3 text-sm text-danger">This link is invalid or has expired.</p>}
            <Button className="mt-6 w-full" size="lg" loading={state === "loading"} onClick={confirm}>
              Unsubscribe me
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
