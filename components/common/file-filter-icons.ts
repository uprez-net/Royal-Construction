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
  pdf: { icon: FileText, className: "text-red-600 dark:text-red-400" },
  image: { icon: FileImage, className: "text-violet-600 dark:text-violet-400" },
  word: { icon: FileType, className: "text-blue-600 dark:text-blue-400" },
  spreadsheet: {
    icon: FileSpreadsheet,
    className: "text-emerald-600 dark:text-emerald-400",
  },
  text: { icon: FileCode, className: "text-amber-600 dark:text-amber-400" },
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
export const TIME_WINDOW_ICON_CLASS = "text-sky-600 dark:text-sky-400";
