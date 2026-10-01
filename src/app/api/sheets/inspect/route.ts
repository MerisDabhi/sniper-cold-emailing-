import { NextRequest } from "next/server";
import { fail, handle, ok } from "@/lib/api";
import { getSheetRows, getSpreadsheetMeta, parseSpreadsheetId } from "@/lib/google";

export const POST = handle(async (req: NextRequest) => {
  const { url, tab } = await req.json();
  const spreadsheetId = parseSpreadsheetId(String(url || ""));
  if (!spreadsheetId) return fail("That doesn't look like a Google Sheets link");
  const meta = await getSpreadsheetMeta(spreadsheetId);
  const selected = tab && meta.tabs.includes(tab) ? tab : meta.tabs[0];
  const { headers, rows } = await getSheetRows(spreadsheetId, selected);
  return ok({
    spreadsheetId,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    title: meta.title,
    tabs: meta.tabs,
    tab: selected,
    headers,
    rowCount: rows.length,
    sample: rows.slice(0, 5),
  });
});
