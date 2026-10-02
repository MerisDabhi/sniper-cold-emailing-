"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { BarChart3, ChevronsUpDown, LogOut, Mail, Menu, Monitor, Moon, Send, Settings, Sun, X } from "lucide-react";
import { api } from "@/lib/client";
import { Avatar, cn } from "./ui";
import { WhatsAppGlyph } from "./Channel";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; tone?: "wa" };
const NAV: { title?: string; items: NavItem[] }[] = [
  { items: [{ href: "/dashboard", label: "Analytics", icon: BarChart3 }] },
  { title: "Outreach", items: [{ href: "/campaigns", label: "Campaigns", icon: Send }] },
  {
    title: "Senders",
    items: [
      { href: "/accounts", label: "Email inboxes", icon: Mail },
      { href: "/whatsapp", label: "WhatsApp numbers", icon: WhatsAppGlyph, tone: "wa" },
    ],
  },
  { items: [{ href: "/settings", label: "Settings", icon: Settings }] },
];

type Me = { owner: { email: string; name: string; picture?: string } | null };

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-7">
        <rect width="32" height="32" rx="8" fill="var(--primary)" />
        <circle cx="16" cy="16" r="8" fill="none" stroke="#fff" strokeWidth="2.2" />
        <circle cx="16" cy="16" r="2.4" fill="#fff" />
        <path d="M16 4v5M16 23v5M4 16h5M23 16h5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight">Sniper</span>
    </div>
  );
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const opts = [
    { v: "light", icon: Sun },
    { v: "dark", icon: Moon },
    { v: "system", icon: Monitor },
  ];
  return (
    <div className="flex rounded-lg border border-border bg-surface-2 p-0.5">
      {opts.map(({ v, icon: Icon }) => (
        <button
          key={v}
          title={v}
          onClick={() => setTheme(v)}
          className={cn(
            "grid h-7 flex-1 place-items-center rounded-md px-2 transition-all",
            mounted && theme === v ? "bg-surface text-text shadow-card" : "text-faint hover:text-text",
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    api<Me>("/api/me").then(setMe).catch(() => {});
  }, []);
  useEffect(() => setOpen(false), [pathname]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between px-4">
        <Logo />
        <button className="rounded-md p-1 text-muted lg:hidden" onClick={() => setOpen(false)}>
          <X className="size-5" />
        </button>
      </div>
      <nav className="mt-2 flex-1 space-y-4 overflow-y-auto px-3">
        {NAV.map((group, gi) => (
          <div key={gi} className="space-y-0.5">
            {group.title && <div className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-faint uppercase">{group.title}</div>}
            {group.items.map(({ href, label, icon: Icon, tone }) => {
              const active = pathname === href || pathname.startsWith(href + "/");
              const wa = tone === "wa";
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active ? (wa ? "bg-wa-soft text-wa" : "bg-primary-soft text-primary") : "text-muted hover:bg-surface-2 hover:text-text",
                  )}
                >
                  <Icon className={cn("size-[18px]", active ? (wa ? "text-wa" : "text-primary") : "text-faint group-hover:text-text")} />
                  {label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="space-y-3 border-t border-border p-3">
        <ThemeToggle />
        <div className="relative">
          <button onClick={() => setMenu((m) => !m)} className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left hover:bg-surface-2">
            <Avatar src={me?.owner?.picture} name={me?.owner?.name || "?"} size={30} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{me?.owner?.name || "…"}</div>
              <div className="truncate text-xs text-faint">{me?.owner?.email}</div>
            </div>
            <ChevronsUpDown className="size-4 text-faint" />
          </button>
          {menu && (
            <div className="animate-fade-up absolute bottom-full left-0 mb-1 w-full rounded-lg border border-border bg-surface p-1 shadow-pop">
              <button onClick={logout} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-danger hover:bg-danger-soft">
                <LogOut className="size-4" /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-border bg-surface lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="animate-fade-up absolute inset-y-0 left-0 w-64 border-r border-border bg-surface">{sidebar}</aside>
        </div>
      )}
      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded-md p-1.5 text-muted hover:bg-surface-2">
            <Menu className="size-5" />
          </button>
          <Logo />
        </header>
        <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
