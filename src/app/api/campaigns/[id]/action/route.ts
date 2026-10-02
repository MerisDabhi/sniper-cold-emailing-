import { NextRequest } from "next/server";
import { db, fetchLeads, id as newId, sb } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";
import { composeEmail, syncLeads } from "@/lib/engine";
import { getSheetRows, sendGmail } from "@/lib/google";
import { leadVariables } from "@/lib/template";
import { composeWhatsApp } from "@/lib/whatsapp/sender";
import { leaseAlive } from "@/lib/lease";
import type { Campaign, Lead } from "@/lib/types";

export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

function validate(c: Campaign): string | null {
  const wa = c.channel === "whatsapp";
  if (!c.sheet) return "Connect a Google Sheet in the Sheet & mapping step";
  if (wa ? !c.mapping?.phone : !c.mapping?.email) return `Map the ${wa ? "phone number" : "email"} column in the Sheet & mapping step`;
  if (!c.steps.length || !c.steps[0].body.trim()) return "Step 1 needs a message";
  if (!wa && !c.steps[0].subject.trim()) return "Step 1 needs a subject";
  if (c.steps.some((s) => !s.body.trim())) return "Every sequence step needs a message";
  const d = db();
  if (wa) {
    if (!c.accountIds.some((aid) => d.waAccounts.some((a) => a.id === aid && a.status === "connected"))) return "Select at least one connected WhatsApp number";
  } else if (!c.accountIds.some((aid) => d.accounts.some((a) => a.id === aid && a.status === "active"))) {
    return "Select at least one active sending inbox";
  }
  if (!c.schedule.days.length) return "Pick at least one sending day";
  if (c.schedule.endHour <= c.schedule.startHour) return "Sending window end must be after the start";
  return null;
}

/** Variables for test messages: the first row of the sheet, or sample data. */
async function sampleData(c: Campaign, fallback: Record<string, string>) {
  if (c.sheet && c.mapping) {
    const { rows } = await getSheetRows(c.sheet.spreadsheetId, c.sheet.tab);
    if (rows[0]) return leadVariables(rows[0], c.mapping);
  }
  return fallback;
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
      if (!d.leads.some((l) => l.campaignId === c.id)) {
        return fail(`No valid ${c.channel === "whatsapp" ? "phone numbers" : "email addresses"} were found in the sheet`);
      }
      c.status = "active";
      c.launchedAt = c.launchedAt || new Date().toISOString();
      return ok({ campaign: c, result });
    }
    case "pause":
      c.status = "paused";
      return ok({ campaign: c });
    case "resume": {
      const err = validate(c);
      if (err) return fail(err);
      c.status = "active";
      return ok({ campaign: c });
    }
    case "sync": {
      const result = await syncLeads(c);
      return ok({ campaign: c, result });
    }
    case "retry_failed": {
      let n = 0;
      for (const l of await fetchLeads((q) => q.eq("campaign_id", c.id).eq("status", "failed"), { all: true })) {
        l.status = l.stepIndex > 0 ? "in_progress" : "pending";
        l.error = undefined;
        l.nextAt = 0;
        n++;
      }
      return ok({ retried: n });
    }
    case "test": {
      const stepIndex = Math.max(0, Math.min(c.steps.length - 1, Number(step) || 0));

      if (c.channel === "whatsapp") {
        const account = d.waAccounts.find((a) => c.accountIds.includes(a.id) && a.status === "connected");
        if (!account) return fail("Select a connected WhatsApp number first");
        if (!(await leaseAlive("whatsapp")).online) return fail("The WhatsApp worker is offline, so nothing can be sent right now.");
        const target = String(to || "").trim();
        if (!target) return fail("Enter the phone number to send the test to");
        const data = await sampleData(c, { first_name: "Alex", last_name: "Taylor", company: "Acme Inc" });
        const fake = { id: "test", campaignId: c.id, data, accountId: account.id, status: "pending", stepIndex, nextAt: 0, token: "test" } as Lead;
        const text = composeWhatsApp(c, fake, account, stepIndex);
        const cmdId = newId("cmd_");
        const { error } = await sb()
          .from("wa_commands")
          .insert({ id: cmdId, account_id: account.id, type: "test", payload: { to: target, countryCode: c.countryCode, text } });
        if (error) return fail(error.message, 500);
        // The worker types and sends it like a person would — wait for the result (up to ~50s).
        for (let i = 0; i < 50; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const { data: cmd } = await sb().from("wa_commands").select("status, result").eq("id", cmdId).single();
          if (cmd?.status === "done") return ok({ sentTo: cmd.result, from: account.phone ? `+${account.phone}` : account.label });
          if (cmd?.status === "failed") return fail(cmd.result || "Sending failed");
        }
        return ok({ sentTo: target, from: account.phone ? `+${account.phone}` : account.label, pending: true });
      }

      const account = d.accounts.find((a) => c.accountIds.includes(a.id) && a.status === "active");
      if (!account) return fail("Select an active sending inbox first");
      const target = String(to || d.owner?.email || account.email);
      const data = await sampleData(c, { first_name: "Alex", last_name: "Taylor", company: "Acme Inc", email: target });
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
