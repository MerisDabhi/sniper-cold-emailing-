"use client";

import { CheckCheck, Mail } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./ui";

export type ChannelKind = "email" | "whatsapp";

/** WhatsApp-style chat glyph (generic speech bubble with a phone handset). */
export function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <path
        d="M9.2 8.4c.2-.4.5-.4.7-.4h.5c.2 0 .4 0 .5.4l.7 1.7c.1.2 0 .4-.1.6l-.4.5c-.1.1-.2.3 0 .5.3.6.8 1.2 1.3 1.6.5.4 1 .7 1.5.9.2.1.4 0 .5-.1l.6-.7c.2-.2.4-.2.6-.1l1.6.8c.2.1.4.2.4.4 0 .4-.1 1-.6 1.4-.5.4-1.3.7-2.3.4-1.1-.3-2.3-1-3.4-2s-1.8-2.2-2.1-3.2c-.3-1 0-1.8.4-2.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ChannelIcon({ channel, size = "md", className }: { channel: ChannelKind; size?: "sm" | "md" | "lg"; className?: string }) {
  const box = size === "sm" ? "size-6 rounded-md" : size === "lg" ? "size-11 rounded-xl" : "size-8 rounded-lg";
  const icon = size === "sm" ? "size-3.5" : size === "lg" ? "size-5" : "size-4";
  return (
    <span className={cn("grid shrink-0 place-items-center", box, channel === "whatsapp" ? "bg-wa-soft text-wa" : "bg-primary-soft text-primary", className)}>
      {channel === "whatsapp" ? <WhatsAppGlyph className={icon} /> : <Mail className={icon} />}
    </span>
  );
}

export function ChannelBadge({ channel }: { channel: ChannelKind }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        channel === "whatsapp" ? "border-wa/25 bg-wa-soft text-wa" : "border-primary/20 bg-primary-soft text-primary",
      )}
    >
      {channel === "whatsapp" ? <WhatsAppGlyph className="size-3" /> : <Mail className="size-3" />}
      {channel === "whatsapp" ? "WhatsApp" : "Email"}
    </span>
  );
}

/** A phone-shaped WhatsApp chat preview: outgoing bubbles plus an optional "typing…" indicator. */
export function WhatsAppPreview({
  contactName,
  messages,
  typing,
  footer,
}: {
  contactName: string;
  messages: { text: string; label?: ReactNode }[];
  typing?: boolean;
  footer?: ReactNode;
}) {
  const initials = contactName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="mx-auto w-full max-w-[360px] overflow-hidden rounded-[28px] border-[6px] border-[#1f2329] bg-wa-chat shadow-pop">
      <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white dark:bg-[#1f2c34]">
        <div className="grid size-8 place-items-center rounded-full bg-white/20 text-xs font-semibold">{initials || "?"}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{contactName || "Lead"}</div>
          <div className="text-[11px] text-white/75">{typing ? "typing…" : "online"}</div>
        </div>
      </div>
      <div
        className="min-h-[300px] space-y-2 px-3 py-4"
        style={{
          backgroundImage: "radial-gradient(color-mix(in srgb, var(--text) 6%, transparent) 1px, transparent 1px)",
          backgroundSize: "14px 14px",
        }}
      >
        {messages.map((m, i) => (
          <div key={i}>
            {m.label && <div className="my-2 text-center text-[10px] font-medium tracking-wide text-faint uppercase">{m.label}</div>}
            <div className="ml-auto w-fit max-w-[85%] rounded-lg rounded-tr-none bg-wa-bubble px-2.5 pt-1.5 pb-1 text-[13px] leading-snug text-[#111b21] shadow-sm dark:text-[#e9edef]">
              <div className="break-words whitespace-pre-wrap">{m.text || <span className="opacity-50">Empty message</span>}</div>
              <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] opacity-60">
                10:{String(12 + i * 7).padStart(2, "0")} <CheckCheck className="size-3 text-sky-500" />
              </div>
            </div>
          </div>
        ))}
        {typing && (
          <div className="w-fit rounded-lg rounded-tl-none bg-surface px-3 py-2.5 shadow-sm">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span key={i} className="typing-dot size-1.5 rounded-full bg-faint" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}
      </div>
      {footer}
    </div>
  );
}
