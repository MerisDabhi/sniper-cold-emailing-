"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";

/** Shown when a page in the app crashes, instead of a blank screen. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="max-w-sm text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-xl bg-danger-soft text-danger">
          <AlertTriangle className="size-6" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">Something went wrong</h2>
        <p className="mt-1 text-sm text-muted">This page hit an unexpected error. Your data is safe — try again, or reload the page.</p>
        <Button className="mt-5" icon={<RotateCcw className="size-4" />} onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
