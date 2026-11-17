import {
  Archive,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CalendarSearch,
  FileImage,
  FileQuestionMark,
  FileSpreadsheet,
  FileText,
  FileType,
  FileCode,
  History,
  Sun,
  type LucideIcon,
} from "lucide-react";

import type { FileKind, TimeWindow } from "@/lib/files/file-filters";

/**
 * The icon and colour for each kind of file, shared by the file tables and
 * their filters, so a PDF looks the same in the dropdown and in the row.
 */
export const FILE_KIND_ICON: Readonly<
  Record<FileKind, { icon: LucideIcon; className: string }>
> = {
  pdf: { icon: FileText, className: "text-destructive-ink" },
  image: { icon: FileImage, className: "text-info-ink" },
  word: { icon: FileType, className: "text-info-ink" },
  spreadsheet: {
    icon: FileSpreadsheet,
    className: "text-success-ink",
  },
  text: { icon: FileCode, className: "text-warning-ink" },
  other: { icon: FileQuestionMark, className: "text-muted-foreground" },
};

export const TIME_WINDOW_ICON: Readonly<Record<TimeWindow, LucideIcon>> = {
  today: Sun,
  "7d": CalendarDays,
  "30d": CalendarRange,
  "90d": CalendarClock,
  year: History,
  older: Archive,
  custom: CalendarSearch,
};

/** Every date choice shares one colour; the icon is what tells them apart. */
export const TIME_WINDOW_ICON_CLASS = "text-info-ink";
