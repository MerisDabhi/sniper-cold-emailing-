import type { ColumnMapping } from "./types";

/** "Company Name" -> "company_name" */
export function slug(header: string) {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Build the variable map for a lead: every sheet column + the standard mapped fields. */
export function leadVariables(row: Record<string, string>, mapping?: ColumnMapping): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) vars[slug(k)] = v ?? "";
  if (mapping) {
    if (mapping.email) vars.email = row[mapping.email] ?? "";
    if (mapping.phone) vars.phone = row[mapping.phone] ?? "";
    if (mapping.firstName) vars.first_name = row[mapping.firstName] ?? "";
    if (mapping.lastName) vars.last_name = row[mapping.lastName] ?? "";
    if (mapping.company) vars.company = row[mapping.company] ?? "";
  }
  if (!vars.first_name && vars.full_name) vars.first_name = vars.full_name.split(" ")[0];
  return vars;
}

export function variableKeys(headers: string[]): string[] {
  const keys = new Set(["first_name", "last_name", "company"]);
  headers.forEach((h) => keys.add(slug(h)));
  return [...keys].filter(Boolean);
}

/**
 * Render a template.
 *   {{first_name}}            → value
 *   {{first_name|there}}      → value, or "there" if empty
 *   {Hi|Hello|Hey}            → spintax: one option picked at random
 */
export function render(tpl: string, vars: Record<string, string>, seed?: string): string {
  let out = tpl.replace(/\{\{\s*([\w.-]+)\s*(?:\|([^}]*))?\}\}/g, (_, key: string, fallback?: string) => {
    const v = vars[slug(key)] ?? vars[key];
    return v && v.trim() ? v : (fallback ?? "").trim();
  });
  const rand = seeded(seed);
  out = out.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, opts: string) => {
    const list = opts.split("|");
    return list[Math.floor(rand() * list.length)];
  });
  return out;
}

/** Deterministic RNG when a seed is given so previews stay stable. */
function seeded(seed?: string) {
  if (!seed) return Math.random;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Plain text → light HTML that looks like a hand-written Gmail message. */
export function textToHtml(text: string) {
  const linked = escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return `<div dir="ltr" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">${linked
    .split(/\n{2,}/)
    .map((p) => `<div>${p.replace(/\n/g, "<br>")}</div>`)
    .join("<div><br></div>")}</div>`;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
