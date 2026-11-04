import { SYDNEY_TZ } from "@/lib/dates/sydney";

// Display rules for the WhatsApp-style chat view. Pure, so what an operator
// reads — "Yesterday", "2:05 pm", "1.2 MB" — can be tested without React.
// Every time is Sydney's, whatever zone the browser is in.

const TIME = new Intl.DateTimeFormat("en-AU", {
  hour: "numeric",
  hour12: true,
  minute: "2-digit",
  timeZone: SYDNEY_TZ,
});

const DAY_KEY = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: SYDNEY_TZ,
  year: "numeric",
});

const WEEKDAY = new Intl.DateTimeFormat("en-AU", {
  timeZone: SYDNEY_TZ,
  weekday: "long",
});

const FULL_DATE = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "long",
  timeZone: SYDNEY_TZ,
  year: "numeric",
});

/** "2:05 pm" — the stamp inside a bubble. */
export function chatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : TIME.format(date).toLowerCase();
}

/** "2026-11-04" in Sydney — which day separator a message sits under. */
export function chatDayKey(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : DAY_KEY.format(date);
}

/** "Today", "Yesterday", "Monday" (this week) or "4 November 2026". */
export function chatDayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const key = DAY_KEY.format(date);
  if (key === DAY_KEY.format(now)) return "Today";
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (key === DAY_KEY.format(yesterday)) return "Yesterday";
  const days = (Date.parse(DAY_KEY.format(now)) - Date.parse(key)) / 86_400_000;
  if (days > 0 && days < 7) return WEEKDAY.format(date);
  return FULL_DATE.format(date);
}

/** The name colours WhatsApp uses for people in a group, light theme. */
const SENDER_COLOURS = [
  "#1f7aec",
  "#d62976",
  "#00a884",
  "#e26a00",
  "#7f66ff",
  "#06cf9c",
  "#c45b0e",
  "#008069",
  "#a62c71",
  "#5e47de",
] as const;

/** One stable colour per participant, from their number. */
export function senderColour(key: string | null | undefined): string {
  if (!key) return SENDER_COLOURS[0];
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return SENDER_COLOURS[hash % SENDER_COLOURS.length];
}

/** "840 KB", "1.2 MB". */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** "PDF", "DOCX" — the badge on a document. */
export function fileKindLabel(
  fileName: string | null | undefined,
  mimeType: string | null | undefined,
): string {
  const ext = fileName?.match(/\.([A-Za-z0-9]{1,5})$/)?.[1];
  if (ext) return ext.toUpperCase();
  const sub = mimeType?.split("/")[1]?.split(/[;+.-]/)[0];
  return sub ? sub.toUpperCase().slice(0, 5) : "FILE";
}

/** Initials for an avatar: "Sam Lee" → "SL", "+61 412…" → "#". */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "")
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "#";
  return (
    words[0][0] + (words.length > 1 ? words.at(-1)![0] : "")
  ).toUpperCase();
}
