// Pure, framework-agnostic readiness helpers for the project creation /
// activation gate. Modeled after `collectOfferSendBlockers` in
// `lib/offer/offer-readiness.ts`: returns an array of blocker entries so the
// caller can decide whether to abort (block) or proceed with a warning
// status (warn). Kept side-effect free so it can be unit-tested and reused
// from the server action, the offer-handoff path, and the PATCH route.

import type { ProjectStatus } from "@prisma/client";
import { compareSignedAndStartDates, normalizeDateString } from "@/utils/date";

export type ProjectDateBlockerSeverity = "block" | "warn";

export type ProjectDateBlocker = {
  readonly id: string;
  readonly label: string;
  /** Dotted path into the project payload for scroll-to-fix in the UI. */
  readonly fieldPath: string;
  readonly severity: ProjectDateBlockerSeverity;
};

export type CollectProjectDateBlockersInput = {
  readonly signedDate: string | null | undefined;
  readonly startDate: string | null | undefined;
  readonly pcaInspector: string | null | undefined;
  readonly hbcfInsuranceNumber: string | null | undefined;
  readonly status: ProjectStatus | string;
};

/**
 * Collects the date / PCA blockers that stand between a project and an
 * Active (or clean Active) state.
 *
 * Block entries (abort creation / reject PATCH):
 * - `start_before_signed` — the on-site start date is before the contract
 *   execution date, an impossible pair for a real build.
 * - `signed_far_before_start` — the signed date is more than
 *   `SIGNED_START_TOLERANCE_DAYS` before the start date, almost certainly a
 *   data-entry error rather than a genuine long lead time.
 *
 * Warn entries (create as `NEEDS_ATTENTION`, surface in the header):
 * - `pca_missing` — the PCA inspector is empty and the project is (or would
 *   become) `ACTIVE`.
 * - `signed_date_unparseable` — the signed date is non-empty but does not
 *   normalize to a valid date; the header would otherwise show a
 *   mis-parsed value as if it were a confirmed fact.
 *
 * Returns an empty array when the project is clean.
 */
export function collectProjectDateBlockers({
  signedDate,
  startDate,
  pcaInspector,
  hbcfInsuranceNumber,
  status,
}: CollectProjectDateBlockersInput): readonly ProjectDateBlocker[] {
  const blockers: ProjectDateBlocker[] = [];

  const comparison = compareSignedAndStartDates(signedDate, startDate);

  if (comparison.state === "start_before_signed") {
    blockers.push({
      id: "start_before_signed",
      label: `The start date (${comparison.normalizedStartDate ?? "?"}) is before the signed date (${comparison.normalizedSignedDate ?? "?"}). On-site work cannot begin before the contract is executed.`,
      fieldPath: "requirements.legalAdministration.signedDate",
      severity: "block",
    });
  } else if (comparison.state === "signed_far_before_start") {
    blockers.push({
      id: "signed_far_before_start",
      label: `The signed date (${comparison.normalizedSignedDate}) is more than a year before the start date (${comparison.normalizedStartDate}). This is almost certainly a data-entry error — confirm or correct the dates.`,
      fieldPath: "requirements.legalAdministration.signedDate",
      severity: "block",
    });
  }

  const normalizedSigned = signedDate ? normalizeDateString(signedDate) : null;
  const hasRawSigned = Boolean(signedDate && signedDate.trim() !== "");
  if (hasRawSigned && !normalizedSigned) {
    blockers.push({
      id: "signed_date_unparseable",
      label: `The signed date "${signedDate}" could not be parsed into a calendar date. It will be shown as unverified until corrected.`,
      fieldPath: "requirements.legalAdministration.signedDate",
      severity: "warn",
    });
  }

  const pcaMissing =
    !pcaInspector ||
    (typeof pcaInspector === "string" && pcaInspector.trim() === "");
  const hbcfInsuranceMissing =
    !hbcfInsuranceNumber ||
    (typeof hbcfInsuranceNumber === "string" &&
      hbcfInsuranceNumber.trim() === "");
  if (pcaMissing && status === "ACTIVE") {
    blockers.push({
      id: "pca_missing",
      label:
        "No PCA inspector is assigned. Add one before the build goes on site so the principal certifier is on record.",
      fieldPath: "requirements.legalAdministration.pcaInspector",
      severity: "warn",
    });
  }

  if (hbcfInsuranceMissing && status === "ACTIVE") {
    blockers.push({
      id: "hbcf_missing",
      label:
        "No HBCF insurance number is assigned. Add one before the build goes on site so the insurance is on record.",
      fieldPath: "requirements.legalAdministration.hbcfInsuranceNumber",
      severity: "warn",
    });
  }

  return blockers;
}

/**
 * Typed error thrown by `createProjectWithLead` when a hard blocker is
 * present and the caller did not pass an explicit confirm flag. Carries the
 * blocker list so the UI / API can render each issue.
 */
export class ProjectDateBlockerError extends Error {
  readonly blockers: readonly ProjectDateBlocker[];
  constructor(blockers: readonly ProjectDateBlocker[]) {
    const labels = blockers.map((b) => b.label).join(" ");
    super(labels || "Project date blockers prevent creation.");
    this.name = "ProjectDateBlockerError";
    this.blockers = blockers;
  }
}

/**
 * Splits a blocker list into hard blocks and soft warns.
 */
export function partitionBlockers(blockers: readonly ProjectDateBlocker[]): {
  blocks: readonly ProjectDateBlocker[];
  warns: readonly ProjectDateBlocker[];
} {
  const blocks = blockers.filter((b) => b.severity === "block");
  const warns = blockers.filter((b) => b.severity === "warn");
  return { blocks, warns };
}
