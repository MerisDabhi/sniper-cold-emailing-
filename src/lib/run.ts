import "server-only";
import { withStore } from "./db";
import { flushSheetStatuses } from "./sheetSync";
import { refreshPublicUrl } from "./url";

/**
 * Run a unit of work with data loaded, then write any queued Google Sheet statuses.
 * Used by API routes, the email sender and the WhatsApp worker alike.
 */
export function withData<T>(fn: () => Promise<T>): Promise<T> {
  return withStore(async () => {
    await refreshPublicUrl().catch(() => null);
    const result = await fn();
    await flushSheetStatuses().catch((e) => console.error("[sheet-sync]", e));
    return result;
  });
}
