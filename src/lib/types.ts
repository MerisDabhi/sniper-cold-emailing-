export type OAuthTokens = {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string;
  token_type?: string | null;
};

export type Owner = {
  email: string;
  name: string;
  picture?: string;
  tokens: OAuthTokens;
  connectedAt: string;
};

export type AccountStatus = "active" | "paused" | "error";

export type GmailAccount = {
  id: string;
  email: string;
  name: string;
  picture?: string;
  tokens: OAuthTokens;
  status: AccountStatus;
  error?: string;
  /** Hard cap per day for this inbox across all campaigns */
  dailyLimit: number;
  signature: string;
  /** Next time this inbox is allowed to send (ms epoch) — enforces human-like gaps */
  nextSendAt: number;
  connectedAt: string;
};

export type ColumnMapping = {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
};

export type SequenceStep = {
  id: string;
  /** Days to wait after the previous step (ignored for step 1) */
  delayDays: number;
  /** Empty subject on a follow-up = reply in the same thread ("Re: ...") */
  subject: string;
  body: string;
};

export type CampaignStatus = "draft" | "active" | "paused" | "completed";

export type CampaignSchedule = {
  timezone: string;
  /** 0 = Sunday … 6 = Saturday */
  days: number[];
  startHour: number;
  endHour: number;
  /** Random gap between two emails from the same inbox, in seconds */
  minGapSec: number;
  maxGapSec: number;
};

export type Campaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  sheet?: {
    spreadsheetId: string;
    title: string;
    tab: string;
    url: string;
    headers: string[];
  };
  mapping?: ColumnMapping;
  steps: SequenceStep[];
  schedule: CampaignSchedule;
  /** Total new + follow-up emails per day across all selected inboxes */
  dailyLimit: number;
  accountIds: string[];
  stopOnReply: boolean;
  trackOpens: boolean;
  unsubscribeFooter: boolean;
  unsubscribeText: string;
  /** Write each lead's progress back into the Google Sheet */
  sheetStatus: boolean;
  sheetStatusColumn: string;
  createdAt: string;
  launchedAt?: string;
  lastSyncedAt?: string;
};

export type LeadStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "replied"
  | "bounced"
  | "unsubscribed"
  | "failed"
  /** Skipped: this address was already cold-emailed (by any campaign) */
  | "duplicate";

export type Lead = {
  id: string;
  campaignId: string;
  email: string;
  data: Record<string, string>;
  accountId: string;
  status: LeadStatus;
  /** Index of the next step to send */
  stepIndex: number;
  nextAt: number;
  threadId?: string;
  firstMessageId?: string;
  firstSubject?: string;
  lastSentAt?: number;
  repliedAt?: number;
  openedAt?: number;
  lastCheckedAt?: number;
  error?: string;
  token: string;
};

export type EventType = "sent" | "reply" | "open" | "bounce" | "unsubscribe" | "error" | "duplicate";

export type AppEvent = {
  id: string;
  type: EventType;
  at: number;
  campaignId?: string;
  accountId?: string;
  leadId?: string;
  email?: string;
  step?: number;
  detail?: string;
};

export type DB = {
  owner: Owner | null;
  accounts: GmailAccount[];
  campaigns: Campaign[];
  leads: Lead[];
  events: AppEvent[];
  unsubscribes: { email: string; at: number; source: string }[];
};
