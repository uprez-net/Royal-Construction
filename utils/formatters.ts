import type { ProjectStatus, VariationStatus } from "@prisma/client";

export const currency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

export const compactCurrency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export const dateFormat = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export const shortDateFormat = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "short",
});

export const dataTimeFormat = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;

  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatStatus(status: string) {
  return status
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

export function projectStatusTone(status: ProjectStatus) {
  if (status === "ON_TRACK" || status === "COMPLETED") {
    return "success" as const;
  }

  if (status === "NEEDS_ATTENTION") {
    return "warning" as const;
  }

  if (status === "DELAYED") {
    return "danger" as const;
  }

  return "neutral" as const;
}

export function variationStatusTone(status: VariationStatus) {
  if (status === "APPROVED") {
    return "success" as const;
  }

  if (status === "REJECTED") {
    return "danger" as const;
  }

  return "warning" as const;
}
