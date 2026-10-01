import type { Campaign } from "@/lib/types";

export type CampaignPatch = Partial<Campaign>;

export type SheetInfo = {
  spreadsheetId: string;
  url: string;
  title: string;
  tabs: string[];
  tab: string;
  headers: string[];
  rowCount: number;
  sample: Record<string, string>[];
};

export type AccountLite = {
  id: string;
  email: string;
  name: string;
  picture?: string;
  status: "active" | "paused" | "error";
  dailyLimit: number;
  sentToday: number;
};

export type Detail = {
  campaign: Campaign;
  stats: {
    leads: number;
    sent: number;
    contacted: number;
    replied: number;
    opened: number;
    bounced: number;
    unsubscribed: number;
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
    replyRate: number;
    openRate: number;
    bounceRate: number;
    unsubRate: number;
  };
  daily: { label: string; sent: number; replies: number; opens: number; bounces: number }[];
  sentToday: number;
  inWindow: boolean;
  perAccountQuota: number;
  senders: (AccountLite & { leads: number; sentToday: number; inboxSent24h: number; quota: number; nextSendAt: number })[];
  steps: { id: string; sent: number }[];
  activity: import("@/components/ActivityFeed").FeedEvent[];
};
