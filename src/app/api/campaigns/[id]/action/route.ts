import { NextRequest } from "next/server";
import { db, save } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { composeEmail, syncLeads } from "@/lib/engine";
import { getSheetRows, sendGmail } from "@/lib/google";
import { leadVariables } from "@/lib/template";
import type { Campaign, Lead } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

function validate(c: Campaign): string | null {
  if (!c.sheet) return "Connect a Google Sheet in the Leads step";
  if (!c.mapping?.email) return "Map the email column in the Leads step";
  if (!c.steps.length || !c.steps[0].subject.trim() || !c.steps[0].body.trim()) return "Step 1 needs a subject and a body";
  if (c.steps.some((s) => !s.body.trim())) return "Every sequence step needs a body";
  const d = db();
  if (!c.accountIds.some((aid) => d.accounts.some((a) => a.id === aid && a.status === "active"))) return "Select at least one active sending inbox";
  if (!c.schedule.days.length) return "Pick at least one sending day";
  if (c.schedule.endHour <= c.schedule.startHour) return "Sending window end must be after the start";
  return null;
}

export const POST = handle(async (req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  const d = db();
  const c = d.campaigns.find((x) => x.id === id);
  if (!c) return fail("Campaign not found", 404);
  const { action, to, step } = await req.json();

  switch (action) {
    case "launch": {
      const err = validate(c);
      if (err) return fail(err);
      const result = await syncLeads(c);
      if (!d.leads.some((l) => l.campaignId === c.id)) return fail("No valid email addresses were found in the sheet");
      c.status = "active";
      c.launchedAt = c.launchedAt || new Date().toISOString();
      save();
      return ok({ campaign: c, result });
    }
    case "pause":
      c.status = "paused";
      save();
      return ok({ campaign: c });
    case "resume": {
      const err = validate(c);
      if (err) return fail(err);
      c.status = "active";
      save();
      return ok({ campaign: c });
    }
    case "sync": {
      const result = await syncLeads(c);
      return ok({ campaign: c, result });
    }
    case "retry_failed": {
      let n = 0;
      for (const l of d.leads) {
        if (l.campaignId === c.id && l.status === "failed") {
          l.status = l.stepIndex > 0 ? "in_progress" : "pending";
          l.error = undefined;
          l.nextAt = 0;
          n++;
        }
      }
      save();
      return ok({ retried: n });
    }
    case "test": {
      const account = d.accounts.find((a) => c.accountIds.includes(a.id) && a.status === "active");
      if (!account) return fail("Select an active sending inbox first");
      const target = String(to || d.owner?.email || account.email);
      const stepIndex = Math.max(0, Math.min(c.steps.length - 1, Number(step) || 0));
      let data: Record<string, string> = { first_name: "Alex", last_name: "Taylor", company: "Acme Inc", email: target };
      if (c.sheet && c.mapping) {
        const { rows } = await getSheetRows(c.sheet.spreadsheetId, c.sheet.tab);
        if (rows[0]) data = leadVariables(rows[0], c.mapping);
      }
      const fake: Lead = {
        id: "test",
        campaignId: c.id,
        email: target,
        data,
        accountId: account.id,
        status: "pending",
        stepIndex,
        nextAt: 0,
        token: "test",
        firstSubject: stepIndex > 0 ? "Test email" : undefined,
      };
      const mail = composeEmail(c, fake, account, stepIndex);
      await sendGmail(account, {
        ...mail,
        threadId: undefined,
        inReplyTo: undefined,
        subject: `[TEST] ${mail.subject}`,
        fromName: account.name,
        fromEmail: account.email,
        to: target,
      });
      return ok({ sentTo: target, from: account.email });
    }
    default:
      return fail("Unknown action");
  }
});
