import type { ProjectStatus, Role, VariationStatus } from "@prisma/client";

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

export const timeFormat = new Intl.DateTimeFormat("en-AU", {
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

export function formatFileType(fileType: string): string {
  // Minify MIME types to common file extensions
  const mapping: Record<string, string> = {
    "application/pdf": "PDF",
    "application/msword": "DOC",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
    "application/vnd.ms-excel": "XLS",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      "XLSX",
    "text/csv": "CSV",
  };

  return mapping[fileType] || fileType.split("/").pop()?.toUpperCase() || "FILE";
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


export function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
}

interface BlobPathParams {
  fileId: string;
  fileName: string;
  milestoneId?: string;
  projectId?: string;
  leadId?: string;
  offerId?: string;
}

export function buildBlobPath({ fileId, fileName, milestoneId, projectId, leadId, offerId }: BlobPathParams) {
  if (milestoneId) {
    return `projects/${projectId ?? "Unknown"}/milestones/${milestoneId}/${fileId}-${sanitizeFileName(fileName)}`;
  }
  
  if (leadId) {
    return `leads/${leadId}/${fileId}-${sanitizeFileName(fileName)}`;
  }

  if (offerId) {
    return `offers/${offerId}/${fileId}-${sanitizeFileName(fileName)}`;
  }

  else {
    return `projects/${projectId ?? "Unknown"}/${fileId}-${sanitizeFileName(fileName)}`;
  }
}

export async function streamToBase64(
  stream: ReadableStream<Uint8Array>
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  // merge chunks
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(totalLength);

  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  // Node.js way
  return Buffer.from(merged).toString("base64");
}

export const RoleLabelRecord: Partial<Record<Role, string>> & { undefined: string } = {
  ADMIN: "Admin",
  SITE_MANAGER: "Site Manager",
  GUEST: "Guest",
  CUSTOMER: "Customer",
  undefined: "No role",
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPrimitive(value: unknown): value is string | number | boolean | null | undefined {
  return value === null || value === undefined || ["string", "number", "boolean"].includes(typeof value);
}

export function formatValue(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") return new Intl.NumberFormat("en-AU", { maximumFractionDigits: 2 }).format(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function formatMoney(value: unknown) {
  if (typeof value !== "number") return formatValue(value);

  return currency.format(value);
}

export function toLabel(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

export function countEntries(value: unknown, keys: string[]) {
  if (!isPlainObject(value)) return 0;

  for (const key of keys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      return candidate.length;
    }
    if (typeof candidate === "number") {
      return candidate;
    }
  }

  return 0;
}

export function safeStringify(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export const base64ToBlob = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: "application/pdf" });
};