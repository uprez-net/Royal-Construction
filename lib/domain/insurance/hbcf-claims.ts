import { normalizeIsoDate } from "@/lib/projects/insurance-claim-dates";
import type {
  HbcfClaimDocument,
  ProjectLegalAdministrationSection,
} from "@/types/project-flow";

// The HBCF claim documents on a project, and the two facts read from them
// (issues #421 and #423):
//
//   - the Total HBCF Claim Amount, which is the sum of the confirmed amounts,
//     each claim counted once;
//   - whether the documents agree about the claim date. They are never used to
//     choose it: the project's claim date is `insuranceClaimStartDate`, set by
//     a person, and a document that disagrees is flagged for review.
//
// Pure, so the Overview tab shows exactly the total and the warnings the
// server works from. The HBCF pool (`./hbcf.ts`) reads the same total.

type LegalAdministrationDraft =
  | Partial<ProjectLegalAdministrationSection>
  | null
  | undefined;

/**
 * Every HBCF claim document on the project.
 *
 * A payload written before multiple documents existed has only the single
 * `hbcfInsuranceDocument`. It is read as a one-document list with no amount,
 * so the certificate already on the project is still shown, and still has to
 * have an amount confirmed before it counts.
 */
export function readHbcfClaimDocuments(
  legal: LegalAdministrationDraft,
): HbcfClaimDocument[] {
  if (Array.isArray(legal?.hbcfClaimDocuments)) {
    return legal.hbcfClaimDocuments;
  }
  const single = legal?.hbcfInsuranceDocument;
  if (!single?.fileId) return [];
  return [
    {
      amountConfirmed: false,
      certificateNumber: legal?.hbcfInsuranceNumber?.trim() || null,
      claimAmount: null,
      coverStartDate: null,
      fileId: single.fileId,
      fileName: single.fileName,
      url: single.url,
    },
  ];
}

/**
 * An amount that can be counted: a finite, positive number, held to cents.
 * Anything else -- blank, zero, negative, NaN -- is null, so it cannot reach
 * a total as a plausible-looking figure.
 */
export function normalizeClaimAmount(value: unknown): number | null {
  const amount = typeof value === "string" ? Number(value) : value;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return Math.round(amount * 100) / 100;
}

function certificateKey(document: HbcfClaimDocument): string | null {
  const key = document.certificateNumber?.replace(/\s+/g, "").toUpperCase();
  return key ? key : null;
}

export type HbcfClaimExclusionReason =
  | "unconfirmed"
  | "missing"
  | "duplicate-file"
  | "duplicate-certificate";

export interface HbcfClaimTotal {
  /** The Total HBCF Claim Amount: every counted amount, summed. */
  readonly total: number;
  /** Documents whose amount is in the total. */
  readonly counted: readonly string[];
  /** Why each other document is not, keyed by file id. */
  readonly excluded: ReadonlyMap<string, HbcfClaimExclusionReason>;
}

/**
 * The project's Total HBCF Claim Amount.
 *
 * A document counts when its amount is valid **and** confirmed. A claim is
 * counted once: the same file twice is one document, and two documents
 * carrying the same certificate number are the same claim -- the first one
 * added is counted, the later one is reported as a duplicate rather than
 * silently added on top.
 */
export function hbcfClaimTotal(
  documents: readonly HbcfClaimDocument[],
): HbcfClaimTotal {
  const excluded = new Map<string, HbcfClaimExclusionReason>();
  const counted: string[] = [];
  const seenFiles = new Set<string>();
  const seenCertificates = new Set<string>();
  let cents = 0;

  for (const document of documents) {
    if (seenFiles.has(document.fileId)) {
      excluded.set(document.fileId, "duplicate-file");
      continue;
    }
    seenFiles.add(document.fileId);

    const amount = normalizeClaimAmount(document.claimAmount);
    if (amount === null) {
      excluded.set(document.fileId, "missing");
      continue;
    }
    if (!document.amountConfirmed) {
      excluded.set(document.fileId, "unconfirmed");
      continue;
    }
    const certificate = certificateKey(document);
    if (certificate && seenCertificates.has(certificate)) {
      excluded.set(document.fileId, "duplicate-certificate");
      continue;
    }
    if (certificate) seenCertificates.add(certificate);

    counted.push(document.fileId);
    cents += Math.round(amount * 100);
  }

  return { counted, excluded, total: cents / 100 };
}

/**
 * The cover start dates the documents print that disagree with the project's
 * claim date -- or, while the project has none, with each other.
 *
 * Returned for the Overview tab to ask about. Nothing here picks a date.
 */
export function hbcfClaimDateConflicts(
  documents: readonly HbcfClaimDocument[],
  claimDate: string | null | undefined,
): {
  readonly documentDates: readonly string[];
  readonly conflicting: readonly HbcfClaimDocument[];
} {
  const designated = normalizeIsoDate(claimDate);
  const dated = documents.filter((document) =>
    normalizeIsoDate(document.coverStartDate),
  );
  const documentDates = [
    ...new Set(dated.map((document) => document.coverStartDate as string)),
  ].sort();

  if (designated) {
    return {
      conflicting: dated.filter(
        (document) => document.coverStartDate !== designated,
      ),
      documentDates,
    };
  }
  return {
    conflicting: documentDates.length > 1 ? dated : [],
    documentDates,
  };
}

/**
 * Add newly uploaded documents to the list, keeping every one already there.
 *
 * A file already on the list is not added a second time -- uploading the same
 * certificate twice is the commonest way to count one claim twice.
 */
export function appendHbcfClaimDocuments(
  current: readonly HbcfClaimDocument[],
  added: readonly HbcfClaimDocument[],
): HbcfClaimDocument[] {
  const known = new Set(current.map((document) => document.fileId));
  const next = [...current];
  for (const document of added) {
    if (known.has(document.fileId)) continue;
    known.add(document.fileId);
    next.push(document);
  }
  return next;
}

/** The project's HBCF claim date (`insuranceClaimStartDate`), when it is a real calendar day. */
export function hbcfClaimDate(
  legal:
    | { readonly insuranceClaimStartDate?: string | null }
    | null
    | undefined,
): string | null {
  return normalizeIsoDate(legal?.insuranceClaimStartDate ?? null);
}
