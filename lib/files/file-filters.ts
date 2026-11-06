// The filters the file tables share: what kind of file, and when it came in.
// One copy, so the project's Documents tab and the lead's Documents tab sort a
// file into the same bucket.

export const FILE_KINDS = [
  "pdf",
  "image",
  "word",
  "spreadsheet",
  "text",
  "other",
] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const FILE_KIND_LABEL: Readonly<Record<FileKind, string>> = {
  pdf: "PDF",
  image: "Image",
  word: "Word document",
  spreadsheet: "Spreadsheet",
  text: "Text / CSV",
  other: "Other",
};

const EXTENSION_KIND: Readonly<Record<string, FileKind>> = {
  pdf: "pdf",
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
  gif: "image",
  heic: "image",
  doc: "word",
  docx: "word",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  csv: "text",
  txt: "text",
};

/** The kind of a file, from its MIME type, or its name when that is missing. */
export function fileKind(
  fileType: string | null | undefined,
  name: string,
): FileKind {
  const mime = (fileType ?? "").toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.includes("wordprocessingml") || mime === "application/msword") {
    return "word";
  }
  if (mime.includes("spreadsheetml") || mime === "application/vnd.ms-excel") {
    return "spreadsheet";
  }
  if (
    mime === "text/csv"
    || mime === "application/csv"
    || mime === "text/plain"
  ) {
    return "text";
  }
  const extension = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return (extension && EXTENSION_KIND[extension]) || "other";
}

export const TIME_WINDOWS = [
  "today",
  "7d",
  "30d",
  "90d",
  "year",
  "older",
  "custom",
] as const;
export type TimeWindow = (typeof TIME_WINDOWS)[number];

export const TIME_WINDOW_LABEL: Readonly<Record<TimeWindow, string>> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  year: "This year",
  older: "Older than 90 days",
  custom: "Custom range",
};

export function isTimeWindow(
  value: string | null | undefined,
): value is TimeWindow {
  return (TIME_WINDOWS as readonly string[]).includes(value ?? "");
}

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** A yyyy-mm-dd from a date input, as local midnight; null when not a date. */
export function parseDateInput(value: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Whether a timestamp falls in the window, in the browser's own day. Days are
 * counted from midnight, so "Last 7 days" is today and the six before it.
 * A custom range includes both of its end days; either end may be open.
 */
export function isWithinWindow(
  value: Date | string,
  window: TimeWindow | null | undefined,
  now: Date,
  range: { from?: string | null; to?: string | null } = {},
): boolean {
  if (!window) return true;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) return false;
  const today = startOfDay(now).getTime();

  switch (window) {
    case "today":
      return time >= today;
    case "7d":
      return time >= today - 6 * DAY;
    case "30d":
      return time >= today - 29 * DAY;
    case "90d":
      return time >= today - 89 * DAY;
    case "year":
      return date.getFullYear() === now.getFullYear();
    case "older":
      return time < today - 89 * DAY;
    case "custom": {
      const from = parseDateInput(range.from);
      const to = parseDateInput(range.to);
      if (from && time < from.getTime()) return false;
      if (to && time >= to.getTime() + DAY) return false;
      return true;
    }
  }
}

/** Every distinct value with how often it appears, most frequent first. */
export function countValues(
  values: Iterable<string>,
): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
