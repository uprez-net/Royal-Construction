// Shared, framework-agnostic error model for the "create project from lead"
// flow. Imported by BOTH the server action (`lib/actions/projects.ts`) and
// the client wizard (`components/projects/create-project-modal.tsx`), so it
// must stay free of `prisma`, `next/*` and any other server-only import.
//
// Why this exists: a thrown Error does not survive the server-action boundary
// with anything a UI can act on. Next strips the message in production and
// replaces it with a digest, and custom classes (`ProjectDateBlockerError`)
// lose their prototype and their `blockers` array. So the action returns a
// plain, serializable failure object instead, and this module owns the shape
// plus the mapping from a failure back onto the review-form fields.

import {
  projectExtractionSections,
  type ProjectExtractionData,
} from "@/types/project-extraction";
import {
  DomainNotFoundError,
  DomainTransitionError,
  DomainValidationError,
  isDomainError,
} from "@/lib/domain/errors";
import { projectOwnerProblems } from "@/lib/domain/projects/owners";
import {
  ProjectDateBlockerError,
  type ProjectDateBlocker,
} from "@/lib/domain/projects/readiness";
import { normalizeDateString } from "@/utils/date";
import { ZodError } from "zod";
import type { ProjectDetail } from "@/types/project";

// ---------------------------------------------------------------------------
// Field addressing
// ---------------------------------------------------------------------------

/** Fields the wizard renders outside the extraction sections. */
export const NON_EXTRACTION_FIELDS = [
  "lead",
  "documents",
  "siteLocation",
  "siteManager",
  "startDate",
] as const;

export type NonExtractionFieldKey = (typeof NON_EXTRACTION_FIELDS)[number];

/** Every field in the wizard that an error can point at. */
export type ProjectFormFieldKey =
  | keyof ProjectExtractionData
  | NonExtractionFieldKey;

export type CreateProjectFieldError = {
  readonly field: ProjectFormFieldKey;
  readonly message: string;
};

export type CreateProjectFailureCode =
  | "VALIDATION"
  | "DATE_BLOCKERS"
  | "LEAD_NOT_FOUND"
  | "FORBIDDEN"
  | "PROJECT_ALREADY_EXISTS_FOR_LEAD"
  | "PROJECT_DETAIL_NOT_FOUND"
  | "SITE_MANAGER_NOT_FOUND"
  | "CUSTOMER_NOT_FOUND"
  | "CONFLICT"
  | "SERVER_ERROR"
  | "NETWORK"
  | "UNKNOWN";

export type CreateProjectFailure = {
  readonly kind: "create-project-failure";
  readonly code: CreateProjectFailureCode;
  /** Short headline for the error banner. */
  readonly title: string;
  /** One-sentence explanation shown under the headline. */
  readonly message: string;
  /** Errors bound to a specific form field, used for inline messages. */
  readonly fieldErrors: readonly CreateProjectFieldError[];
  /** Readiness blockers, when the server rejected on the date gate. */
  readonly blockers?: readonly ProjectDateBlocker[];
  /**
   * Whether re-submitting the same payload could ever succeed. `false` means
   * the wizard should stop offering "Try again" and send the user back to the
   * lead/upload step instead.
   */
  readonly retryable: boolean;
  /** Server-side digest/stack hint, surfaced in a collapsible "details" row. */
  readonly detail?: string;
};

const EXTRACTION_FIELD_KEYS = new Set<string>(
  projectExtractionSections.flatMap((section) => section.fields),
);

/** Section index (the wizard step) that owns each extraction field. */
const SECTION_INDEX_BY_FIELD: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  projectExtractionSections.forEach((section, index) => {
    for (const field of section.fields) {
      map[field] = index;
    }
  });
  return map;
})();

/**
 * The review step that has to be open before `field` is on screen, or `null`
 * when the field lives in the always-visible header block (site location,
 * site manager, start date) or is not a field at all (lead, documents).
 */
export function sectionIndexForField(
  field: ProjectFormFieldKey,
): number | null {
  return SECTION_INDEX_BY_FIELD[field] ?? null;
}

/** Stable DOM id for a field's wrapper, so the UI can scroll it into view. */
export function fieldElementId(field: string): string {
  return `create-project-field-${field}`;
}

const FIELD_LABELS: Partial<Record<ProjectFormFieldKey, string>> = {
  lead: "Lead",
  documents: "Tender and contract PDFs",
  siteLocation: "Site location",
  siteManager: "Site manager",
  startDate: "Start date",
  projectName: "Project name",
  lotSize: "Lot size",
  legalAdministrationSignedDate: "Signed date",
  legalAdministrationPcaInspector: "PCA inspector",
  legalAdministrationSiteAddress: "Site address",
  legalAdministrationOwners: "Owners",
  commercialsAndClaimsTotalContractSum: "Total contract sum",
  commercialsAndClaimsDepositValue: "Deposit value",
};

/** Human label for an error row; falls back to de-camel-casing the key. */
export function fieldDisplayLabel(field: ProjectFormFieldKey): string {
  const known = FIELD_LABELS[field];
  if (known) return known;

  const spaced = String(field)
    .replace(/([A-Z])/g, " $1")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Maps a blocker's dotted `fieldPath` (e.g.
 * `requirements.legalAdministration.signedDate`) onto the flat extraction key
 * the review form actually renders. Returns `null` when the path points at
 * something the wizard does not expose, so the caller keeps it as a general
 * (non-field) error rather than attaching it to an arbitrary input.
 */
export function fieldPathToFormField(
  fieldPath: string | null | undefined,
): ProjectFormFieldKey | null {
  if (!fieldPath) return null;

  const segments = fieldPath
    .split(".")
    .filter((segment) => segment && segment !== "requirements");

  if (segments.length === 0) return null;

  // `startDate` / `siteManagerId` are top-level project columns, not part of
  // the extraction payload.
  const direct: Record<string, ProjectFormFieldKey> = {
    startDate: "startDate",
    siteManagerId: "siteManager",
    siteManager: "siteManager",
    address: "siteLocation",
    location: "siteLocation",
    council: "siteLocation",
    leadId: "lead",
    sourceDocuments: "documents",
    projectName: "projectName",
    name: "projectName",
    lotSize: "lotSize",
  };
  if (segments.length === 1 && direct[segments[0]]) {
    return direct[segments[0]];
  }

  // `legalAdministration` + `signedDate` -> `legalAdministrationSignedDate`.
  const flattened = segments
    .map((segment, index) =>
      index === 0
        ? segment
        : segment.charAt(0).toUpperCase() + segment.slice(1),
    )
    .join("");

  if (EXTRACTION_FIELD_KEYS.has(flattened)) {
    return flattened as ProjectFormFieldKey;
  }

  const last = segments[segments.length - 1];
  return direct[last] ?? null;
}

// ---------------------------------------------------------------------------
// Server action result envelope
// ---------------------------------------------------------------------------

/**
 * What the client actually receives from `createProjectWithLeadAction`. A
 * discriminated union rather than a throw, because only plain data survives
 * the server-action boundary intact.
 */
export type CreateProjectResult =
  | { readonly ok: true; readonly project: ProjectDetail }
  | { readonly ok: false; readonly failure: CreateProjectFailure };

// ---------------------------------------------------------------------------
// Client-side validation (runs before the request leaves the browser)
// ---------------------------------------------------------------------------

export type ValidateCreateProjectInput = {
  readonly selectedLeadId: number | null;
  readonly hasSourceDocuments: boolean;
  readonly hasLocation: boolean;
  readonly hasSiteManager: boolean;
  readonly startDate: string;
  readonly extraction: ProjectExtractionData;
};

/**
 * Mirrors the server's own guards so the common mistakes are caught without a
 * round trip. Deliberately conservative: only things the server would also
 * reject (or that would silently produce a broken project) are errors here —
 * blank optional extraction fields stay blank by design.
 */
export function validateCreateProjectForm({
  selectedLeadId,
  hasSourceDocuments,
  hasLocation,
  hasSiteManager,
  startDate,
  extraction,
}: ValidateCreateProjectInput): CreateProjectFieldError[] {
  const errors: CreateProjectFieldError[] = [];

  if (!selectedLeadId) {
    errors.push({
      field: "lead",
      message: "Select a lead before creating the project.",
    });
  }

  if (!hasSourceDocuments) {
    errors.push({
      field: "documents",
      message:
        "The tender and contract documents are missing. Re-run the extraction.",
    });
  }

  if (!hasLocation) {
    errors.push({
      field: "siteLocation",
      message: "Pick a site location from the address suggestions.",
    });
  }

  if (!hasSiteManager) {
    errors.push({
      field: "siteManager",
      message: "Assign a site manager to the project.",
    });
  }

  const signedDate = extraction.legalAdministrationSignedDate?.trim() ?? "";
  const effectiveStart = normalizeDateString(signedDate) || startDate.trim();

  if (!effectiveStart) {
    errors.push({
      field: "startDate",
      message:
        "Set a start date, or fill in the signed date so it can be derived.",
    });
  }

  if (signedDate && !normalizeDateString(signedDate)) {
    errors.push({
      field: "legalAdministrationSignedDate",
      message: `"${signedDate}" is not a date we can read. Use a YYYY-MM-DD or D Month YYYY format.`,
    });
  }

  // The rule the server applies, so every owner problem is listed here rather
  // than coming back from the server one at a time.
  for (const problem of projectOwnerProblems(
    extraction.legalAdministrationOwners,
  )) {
    errors.push({
      field: "legalAdministrationOwners",
      message: problem.message,
    });
  }

  if (!normalizeString(extraction.projectName) && !hasLocation) {
    errors.push({
      field: "projectName",
      message: "Give the project a name — nothing else can stand in for it.",
    });
  }

  if (extraction.lotSize !== null && extraction.lotSize < 0) {
    errors.push({
      field: "lotSize",
      message: "Lot size cannot be negative.",
    });
  }

  const contractSum = extraction.commercialsAndClaimsTotalContractSum;
  const deposit = extraction.commercialsAndClaimsDepositValue;

  for (const [field, value] of [
    ["commercialsAndClaimsTotalContractSum", contractSum],
    ["commercialsAndClaimsDepositValue", deposit],
    ["commercialsAndClaimsGstAmount", extraction.commercialsAndClaimsGstAmount],
  ] as const) {
    if (typeof value === "number" && value < 0) {
      errors.push({
        field: field as ProjectFormFieldKey,
        message: `${fieldDisplayLabel(field as ProjectFormFieldKey)} cannot be negative.`,
      });
    }
  }

  if (
    typeof deposit === "number"
    && deposit > 0
    && typeof contractSum === "number"
    && contractSum > 0
    && deposit > contractSum
  ) {
    errors.push({
      field: "commercialsAndClaimsDepositValue",
      message:
        "The deposit is larger than the total contract sum. Check both figures against the contract.",
    });
  }

  return errors;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// ---------------------------------------------------------------------------
// Failure construction / narrowing
// ---------------------------------------------------------------------------

export function createProjectFailure(
  code: CreateProjectFailureCode,
  title: string,
  message: string,
  extras: {
    fieldErrors?: readonly CreateProjectFieldError[];
    blockers?: readonly ProjectDateBlocker[];
    retryable?: boolean;
    detail?: string;
  } = {},
): CreateProjectFailure {
  return {
    kind: "create-project-failure",
    code,
    title,
    message,
    fieldErrors: extras.fieldErrors ?? [],
    ...(extras.blockers ? { blockers: extras.blockers } : {}),
    retryable: extras.retryable ?? true,
    ...(extras.detail ? { detail: extras.detail } : {}),
  };
}

/**
 * A typed domain refusal, bound to the wizard field it is about.
 *
 * `DomainValidationError` carries the `field` the rule named, which is either
 * already a form key (`leadId`, `startDate`) or a dotted requirements path
 * that `fieldPathToFormField` flattens — the same mapping a date blocker uses.
 */
function domainFailure(error: unknown): CreateProjectFailure | null {
  if (!isDomainError(error)) return null;

  const named =
    error instanceof DomainValidationError && error.field
      ? fieldPathToFormField(error.field)
      : null;
  const fieldErrors = named ? [{ field: named, message: error.message }] : [];

  if (error instanceof DomainTransitionError) {
    // The only transition this command has: the lead already has a project.
    return createProjectFailure(
      "PROJECT_ALREADY_EXISTS_FOR_LEAD",
      "This lead already has a project",
      "Someone converted this lead while you were reviewing. Open the existing project instead of creating a second one.",
      {
        fieldErrors: [
          { field: "lead", message: "A project already exists for this lead." },
        ],
        retryable: false,
      },
    );
  }

  if (error instanceof DomainNotFoundError) {
    // The command's one not-found is the site manager; anything else that
    // reaches here is still a thing the operator has to pick again.
    return createProjectFailure(
      "SITE_MANAGER_NOT_FOUND",
      "That site manager is no longer available",
      error.message,
      {
        fieldErrors: [{ field: "siteManager", message: error.message }],
      },
    );
  }

  return createProjectFailure(
    error.status === 403 ? "FORBIDDEN" : "VALIDATION",
    error.status === 403
      ? "You cannot create a project from this lead"
      : "Some fields did not pass validation",
    error.message,
    { fieldErrors, retryable: error.status !== 403 },
  );
}

export function isCreateProjectFailure(
  value: unknown,
): value is CreateProjectFailure {
  return (
    typeof value === "object"
    && value !== null
    && (value as { kind?: unknown }).kind === "create-project-failure"
  );
}

/**
 * Last-resort conversion for anything that reaches the client without already
 * being a `CreateProjectFailure` — a serialization failure, an aborted
 * request, a Next digest error.
 */
export function toCreateProjectFailure(error: unknown): CreateProjectFailure {
  if (isCreateProjectFailure(error)) {
    return error;
  }

  if (typeof error === "string" && error.trim()) {
    return createProjectFailure(
      "UNKNOWN",
      "Could not create the project",
      error,
    );
  }

  const message =
    error instanceof Error ? error.message : "Unable to create project.";

  const isNetwork =
    error instanceof Error
    && /fetch failed|network|Failed to fetch|ECONNRESET|timeout/i.test(
      error.message,
    );

  if (isNetwork) {
    return createProjectFailure(
      "NETWORK",
      "The request never reached the server",
      "Check your connection and try again — nothing was created.",
    );
  }

  return createProjectFailure(
    "UNKNOWN",
    "Could not create the project",
    message,
    {
      detail:
        error instanceof Error && "digest" in error
          ? String((error as Error & { digest?: unknown }).digest)
          : undefined,
    },
  );
}

/**
 * Turns the date-readiness blockers into per-field errors plus a summary
 * message. Shared by the server action and the client, so the same blocker
 * renders identically whichever side produced it.
 */
export function blockersToFailure(
  blockers: readonly ProjectDateBlocker[],
): CreateProjectFailure {
  const fieldErrors = blockers.flatMap<CreateProjectFieldError>((blocker) => {
    const field = fieldPathToFormField(blocker.fieldPath);
    return field ? [{ field, message: blocker.label }] : [];
  });

  return createProjectFailure(
    "DATE_BLOCKERS",
    blockers.length === 1
      ? "One date needs correcting"
      : `${blockers.length} dates need correcting`,
    // Deliberately not "…or confirm to proceed": the server rejects a hard
    // blocker even when `confirmDateBlockers` is set, so correcting the dates
    // is the only way through.
    "The contract dates are inconsistent, and the server will not accept this combination. Correct them below and create the project again.",
    { fieldErrors, blockers, retryable: true },
  );
}

/**
 * Server-side conversion: turns whatever `createProjectWithLead` threw into a
 * serializable failure. Kept here (rather than in the `"use server"` module,
 * which may only export async functions) so both sides share one mapping.
 */
export function failureFromThrownError(error: unknown): CreateProjectFailure {
  if (error instanceof ProjectDateBlockerError) {
    return blockersToFailure(error.blockers);
  }

  // Phase 4 moved the conversion into `lib/domain/projects/creation.ts`, which
  // throws typed refusals instead of `Error`s carrying a sentinel string. They
  // are matched first, by class, so the wizard binds each one to the field
  // that caused it rather than falling through to the substring rules below —
  // those stay for the adapter's own remaining throws and for anything Prisma
  // surfaces.
  const domain = domainFailure(error);
  if (domain) return domain;

  if (error instanceof ZodError) {
    const fieldErrors = error.issues.flatMap<CreateProjectFieldError>(
      (issue) => {
        const field = fieldPathToFormField(issue.path.join("."));
        return field ? [{ field, message: issue.message }] : [];
      },
    );

    return createProjectFailure(
      "VALIDATION",
      "Some fields did not pass validation",
      fieldErrors.length > 0
        ? "Review the highlighted fields and submit again."
        : error.issues.map((issue) => issue.message).join(" "),
      { fieldErrors },
    );
  }

  const message = error instanceof Error ? error.message : String(error ?? "");

  // `createProjectWithLead` rethrows its sentinels wrapped in a sentence, so
  // match on a substring rather than equality.
  if (/LEAD_NOT_FOUND|not found\.$/i.test(message) && /lead/i.test(message)) {
    return createProjectFailure(
      "LEAD_NOT_FOUND",
      "That lead no longer exists",
      "The lead was deleted or merged while this wizard was open. Go back and pick another lead.",
      {
        fieldErrors: [
          { field: "lead", message: "This lead could not be found." },
        ],
        retryable: false,
      },
    );
  }

  if (/PROJECT_ALREADY_EXISTS_FOR_LEAD|already been created/i.test(message)) {
    return createProjectFailure(
      "PROJECT_ALREADY_EXISTS_FOR_LEAD",
      "This lead already has a project",
      "Someone converted this lead while you were reviewing. Open the existing project instead of creating a second one.",
      {
        fieldErrors: [
          {
            field: "lead",
            message: "A project already exists for this lead.",
          },
        ],
        retryable: false,
      },
    );
  }

  if (/PROJECT_DETAIL_NOT_FOUND|could not be retrieved/i.test(message)) {
    return createProjectFailure(
      "PROJECT_DETAIL_NOT_FOUND",
      "The project was created but could not be loaded",
      "The record exists — refresh the projects list rather than submitting again, or you will create a duplicate.",
      { retryable: false },
    );
  }

  if (/SITE_MANAGER_NOT_FOUND/i.test(message)) {
    return createProjectFailure(
      "SITE_MANAGER_NOT_FOUND",
      "That site manager is no longer available",
      "Pick a different site manager and submit again.",
      {
        fieldErrors: [
          {
            field: "siteManager",
            message: "This site manager could not be found.",
          },
        ],
      },
    );
  }

  if (/CUSTOMER_NOT_FOUND/i.test(message)) {
    return createProjectFailure(
      "CUSTOMER_NOT_FOUND",
      "The customer record could not be resolved",
      "The lead's customer details are incomplete. Fix the lead, then retry.",
      { fieldErrors: [{ field: "lead", message: "Customer not found." }] },
    );
  }

  // Prisma surfaces unique/foreign-key violations as `P2002` / `P2003`.
  if (/\bP2002\b/.test(message)) {
    return createProjectFailure(
      "CONFLICT",
      "That project conflicts with an existing record",
      "A project with these details already exists. Change the project name or check the projects list.",
      {
        fieldErrors: [
          {
            field: "projectName",
            message: "This value collides with an existing project.",
          },
        ],
      },
    );
  }

  if (/\bP2003\b|Foreign key/i.test(message)) {
    return createProjectFailure(
      "CONFLICT",
      "A linked record is missing",
      "One of the lead, site manager, or customer references no longer resolves. Reload and try again.",
      { retryable: false },
    );
  }

  if (/Invalid time value|Invalid Date/i.test(message)) {
    return createProjectFailure(
      "VALIDATION",
      "A date could not be parsed",
      "The signed or start date is not a real calendar date. Correct it and submit again.",
      {
        fieldErrors: [
          {
            field: "legalAdministrationSignedDate",
            message: "This date could not be parsed.",
          },
          { field: "startDate", message: "Check the start date." },
        ],
      },
    );
  }

  return createProjectFailure(
    "SERVER_ERROR",
    "The server could not create the project",
    message || "An unexpected error occurred while creating the project.",
    {
      detail:
        error instanceof Error && "digest" in error
          ? String((error as Error & { digest?: unknown }).digest)
          : undefined,
    },
  );
}
