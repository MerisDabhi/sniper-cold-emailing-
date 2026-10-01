"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ReactNode } from "react";
import { cn } from "./ui";

type Row = { label: string; sent: number; replies: number; opens?: number; bounces?: number };

const SERIES = [
  { key: "sent", name: "Sent", color: "var(--primary)" },
  { key: "replies", name: "Replies", color: "var(--success)" },
  { key: "bounces", name: "Bounces", color: "var(--danger)" },
] as const;

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-pop">
      <div className="mb-1 font-medium">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-muted">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          {p.name}
          <span className="ml-auto pl-4 font-semibold text-text tabular-nums">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ActivityChart({ data, height = 260 }: { data: Row[]; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <defs>
            {SERIES.map((s) => (
              <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--border-strong)" }} />
          {SERIES.map((s) => (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} fill={`url(#g-${s.key})`} dot={false} activeDot={{ r: 4 }} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Legend() {
  return (
    <div className="flex items-center gap-4 text-xs text-muted">
      {SERIES.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: s.color }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, icon, tone = "primary" }: { label: string; value: ReactNode; sub?: ReactNode; icon: ReactNode; tone?: "primary" | "success" | "warning" | "danger" | "violet" }) {
  const toneCls = {
    primary: "bg-primary-soft text-primary",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
    violet: "bg-violet/10 text-violet",
  }[tone];
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-muted">{label}</span>
        <span className={cn("grid size-7 place-items-center rounded-lg", toneCls)}>{icon}</span>
      </div>
      <div className="mt-3 text-[26px] font-semibold leading-none tracking-tight tabular-nums">{value}</div>
      {sub && <div className="mt-2 text-xs text-faint">{sub}</div>}
    </div>
  );
}
