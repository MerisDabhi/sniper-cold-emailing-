"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, FileSpreadsheet, RefreshCw } from "lucide-react";
import { api } from "@/lib/client";
import type { Campaign, ColumnMapping } from "@/lib/types";
import { Badge, Button, Card, CardHeader, Input, Label, Select } from "../ui";
import type { CampaignPatch, SheetInfo } from "./types";

const GUESS: Record<keyof ColumnMapping, RegExp> = {
  email: /e-?mail/i,
  firstName: /^(first|fname|first[\s_-]?name|given)/i,
  lastName: /^(last|lname|last[\s_-]?name|surname|family)/i,
  company: /(company|organi[sz]ation|business|brand|agency)/i,
};

export function guessMapping(headers: string[], current?: ColumnMapping): ColumnMapping {
  const find = (k: keyof ColumnMapping) => {
    const cur = current?.[k];
    if (cur && headers.includes(cur)) return cur;
    return headers.find((h) => GUESS[k].test(h)) || "";
  };
  return { email: find("email"), firstName: find("firstName"), lastName: find("lastName"), company: find("company") };
}

const FIELDS: { key: keyof ColumnMapping; label: string; variable: string; required?: boolean }[] = [
  { key: "email", label: "Email address", variable: "{{email}}", required: true },
  { key: "firstName", label: "First name", variable: "{{first_name}}" },
  { key: "lastName", label: "Last name", variable: "{{last_name}}" },
  { key: "company", label: "Company name", variable: "{{company}}" },
];

export function SheetTab({ c, sheet, setSheet, onChange, locked }: { c: Campaign; sheet: SheetInfo | null; setSheet: (s: SheetInfo) => void; onChange: (p: CampaignPatch) => void; locked: boolean }) {
  const [url, setUrl] = useState(c.sheet?.url || "");
  const [loading, setLoading] = useState(false);

  async function inspect(u = url, tab?: string) {
    setLoading(true);
    try {
      const info = await api<SheetInfo>("/api/sheets/inspect", { body: { url: u, tab } });
      setSheet(info);
      setUrl(info.url);
      onChange({
        sheet: { spreadsheetId: info.spreadsheetId, title: info.title, tab: info.tab, url: info.url, headers: info.headers },
        mapping: guessMapping(info.headers, c.mapping),
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const mapping = c.mapping || { email: "" };
  const headers = sheet?.headers || c.sheet?.headers || [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Google Sheet" description="Paste the link of the sheet that holds your leads. The first row must contain column names." />
        <div className="p-5">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <FileSpreadsheet className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-success" />
              <Input
                className="pl-9"
                placeholder="https://docs.google.com/spreadsheets/d/…"
                value={url}
                disabled={locked}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && inspect()}
              />
            </div>
            <Button onClick={() => inspect()} loading={loading} disabled={!url || locked} icon={sheet ? <RefreshCw className="size-4" /> : undefined}>
              {sheet ? "Reload" : "Load sheet"}
            </Button>
          </div>

          {(sheet || c.sheet) && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2/60 px-4 py-3">
              <CheckCircle2 className="size-4 text-success" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{sheet?.title || c.sheet?.title}</div>
                <div className="text-xs text-faint">{sheet ? `${sheet.rowCount} rows · ${sheet.headers.length} columns` : "Loading preview…"}</div>
              </div>
              {sheet && sheet.tabs.length > 1 && (
                <Select className="w-44" value={sheet.tab} disabled={locked} onChange={(e) => inspect(sheet.url, e.target.value)}>
                  {sheet.tabs.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </Select>
              )}
              <a href={sheet?.url || c.sheet?.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                Open <ExternalLink className="size-3" />
              </a>
            </div>
          )}
        </div>
      </Card>

      {headers.length > 0 && (
        <Card>
          <CardHeader title="Map columns" description="Tell us which columns hold the basics. Every other column is also available as a variable." />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <Label hint={f.variable}>
                  {f.label} {f.required && <span className="text-danger">*</span>}
                </Label>
                <Select value={mapping[f.key] || ""} onChange={(e) => onChange({ mapping: { ...mapping, [f.key]: e.target.value } as ColumnMapping })}>
                  <option value="">{f.required ? "Select a column…" : "— Not mapped —"}</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
          {sheet && sheet.sample.length > 0 && (
            <div className="border-t border-border">
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-[13px] font-medium">Preview</span>
                <Badge>First {sheet.sample.length} rows</Badge>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-y border-border bg-surface-2/60 text-left text-xs text-faint">
                      {sheet.headers.map((h) => (
                        <th key={h} className="px-4 py-2 font-medium whitespace-nowrap">
                          {h}
                          {Object.values(mapping).includes(h) && <span className="ml-1.5 text-primary">●</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sheet.sample.map((r, i) => (
                      <tr key={i}>
                        {sheet.headers.map((h) => (
                          <td key={h} className="max-w-[220px] truncate px-4 py-2 text-muted">
                            {r[h] || <span className="text-faint">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
