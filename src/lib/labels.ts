/** Labels a conversation can carry. Set automatically from the reply text; can be changed by hand. */
export const LABELS = ["interested", "meeting_booked", "not_interested", "out_of_office", "auto_reply", "wrong_person", "replied"] as const;
export type ReplyLabel = (typeof LABELS)[number];

export const LABEL_META: Record<ReplyLabel, { name: string; tone: "green" | "blue" | "red" | "amber" | "gray" | "violet" }> = {
  interested: { name: "Interested", tone: "green" },
  meeting_booked: { name: "Meeting booked", tone: "blue" },
  not_interested: { name: "Not interested", tone: "red" },
  out_of_office: { name: "Out of office", tone: "amber" },
  auto_reply: { name: "Auto-reply", tone: "gray" },
  wrong_person: { name: "Wrong person", tone: "violet" },
  replied: { name: "Replied", tone: "gray" },
};

export const isLabel = (v: unknown): v is ReplyLabel => typeof v === "string" && (LABELS as readonly string[]).includes(v);

/** A conversation is unread when the newest message from the lead is newer than the last time it was opened. */
export const isUnread = (row: { last_reply_at?: number | null; read_at?: number | null }) =>
  !!row.last_reply_at && Number(row.last_reply_at) > Number(row.read_at || 0);
