// Shared compliance value normalization; adapters only transport the result.
import type { CertifierEngagementDetail } from "@/types/compliance";

/**
 * Restore Dates on a compliance engagement returned through fetchJson.
 *
 * The initial project payload comes through the RSC boundary with Date objects,
 * but compliance mutations refresh the engagement through JSON, where dates
 * are strings. The store keeps the declared engagement shape, so normalize it
 * once at that boundary instead of making every consumer parse its dates.
 *
 * Invalid dates are treated as missing. An Invalid Date poisons the date
 * comparisons used by the stage flow and is no more useful to the UI than a
 * missing timestamp.
 */
export function reviveComplianceEngagementDates(
  engagement: CertifierEngagementDetail | null,
): CertifierEngagementDetail | null {
  return reviveDateFields(engagement);
}

const isDateField = (key: string) =>
  key === "scheduledFor" || key.endsWith("At");

function reviveDateFields<T>(value: T): T {
  if (value === null || value === undefined) return value;

  if (value instanceof Date) {
    return isValidDate(value) ? value : (null as T);
  }

  if (Array.isArray(value)) {
    return value.map(reviveDateFields) as T;
  }

  if (typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      isDateField(key) ? toDate(child) : reviveDateFields(child),
    ]),
  ) as T;
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;

  const parsed = value instanceof Date ? value : new Date(String(value));
  return isValidDate(parsed) ? parsed : null;
}

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}
