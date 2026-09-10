import {
  ComplianceAlertStatus,
  ComplianceAlertType,
  ComplianceDocumentType,
  ComplianceExternalApplicationKind,
} from "@prisma/client";

import {
  documentTypesForParty,
  EXTERNAL_APPLICATION_DOCUMENT_TYPE,
  isNotRequired,
} from "@/constants/complianceDocuments";
import { COMPLIANCE_ALERT_PARTY } from "@/lib/compliance/alert-parties";
import {
  outreachForParty,
  type CertifierEngagementDetail,
  type ComplianceDocumentWithFiles,
} from "@/types/compliance";

/**
 * Which rows on the file an open overdue alert is actually about.
 *
 * The panel has always said *that* a surveyor is eleven working days late. It
 * has never said which of the three documents on their block is the one nobody
 * has sent -- so a reader who saw the alert still had to scroll to the section,
 * open it, and work out from three rows reading "Not collected yet" which was
 * the late one and which was simply not due. This is that answer, worked out
 * from the alerts the sweep raised rather than from a second set of clocks.
 *
 * Derived rather than stored, and derived from open alerts only. An overdue
 * badge is exactly as true as the alert behind it: the moment the sweep closes
 * one -- the documents arrive, a line is marked not required, a DA takes the
 * certificate out of the pack -- the badge goes with it, which is what stops
 * the file accumulating red marks nobody can clear.
 *
 * Two sets rather than one, because the rows are addressed two different ways.
 * A required-pack row is identified by its type and may not exist yet; a
 * checklist line is a row with an id and no type worth matching, since twenty of
 * them share `CHECKLIST_ITEM`.
 */
export type OverdueDocuments = {
  /** Document types with an open alert against them and nothing supplied. */
  types: ReadonlySet<ComplianceDocumentType>;
  /** Checklist and DA rows, by id, that a consultant is late on. */
  documentIds: ReadonlySet<string>;
};

const EMPTY: OverdueDocuments = {
  types: new Set(),
  documentIds: new Set(),
};

/**
 * Whether a row still wants something. A settled row is never late.
 *
 * A file on the row is not enough, because a rejection leaves one there. When a
 * document is sent back, `resolveComplianceDocument` puts the row to PENDING
 * and records the reason while the refused file stays attached — it is the only
 * evidence of what was tried, and the row renders it struck through. So a row
 * carrying a rejection is outstanding despite having a file, and reading the
 * file count alone suppressed exactly the badges the revision alerts exist for:
 * the architect redrawing plans the client sent back, and the bushfire
 * consultant reissuing a report the developer refused.
 *
 * The reason clears on the replacement upload, in the same write that
 * supersedes the file, so the two move together without a marker of their own.
 */
function isOutstanding(
  document: ComplianceDocumentWithFiles | undefined,
): boolean {
  if (!document) return true;
  if (isNotRequired(document.status)) return false;
  return document.files.length === 0 || Boolean(document.rejectionReason);
}

/**
 * The alerts that mean "somebody is late with a document", and nothing else.
 *
 * `STALE_TITLE_SEARCH` is deliberately not among them though it is raised
 * against a surveyor: the title search is on the file, on time, and wrong. A
 * row carrying a document and an "Overdue" badge is a row saying two things
 * that cannot both be true, and the alert already says the honest one.
 *
 * `DA_APPROVAL_REQUIRED` is likewise absent. It is a fact about the route the
 * job is taking rather than a document anybody is late with.
 */
const NOT_A_LATE_DOCUMENT: ReadonlySet<ComplianceAlertType> = new Set([
  ComplianceAlertType.STALE_TITLE_SEARCH,
  ComplianceAlertType.DA_APPROVAL_REQUIRED,
]);

/**
 * The external application each portal alert is waiting on.
 *
 * These have no party and no thread, so `COMPLIANCE_ALERT_PARTY` returns null
 * for every one of them and the party branch below would drop them. Their
 * document is named directly instead.
 */
const APPLICATION_ALERT_KIND: Readonly<
  Partial<Record<ComplianceAlertType, ComplianceExternalApplicationKind>>
> = {
  [ComplianceAlertType.PLANNING_CERTIFICATE_DELAYED]:
    ComplianceExternalApplicationKind.PLANNING_CERTIFICATE_10_7,
  [ComplianceAlertType.ROAD_OPENING_DELAYED]:
    ComplianceExternalApplicationKind.ROAD_OPENING,
  [ComplianceAlertType.LONG_SERVICE_LEVY_DELAYED]:
    ComplianceExternalApplicationKind.LONG_SERVICE_LEVY,
  [ComplianceAlertType.MINE_SUBSIDENCE_DELAYED]:
    ComplianceExternalApplicationKind.MINE_SUBSIDENCE,
  [ComplianceAlertType.DA_DETERMINATION_OVERDUE]:
    ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION,
};

/**
 * The one document an alert names outright, where it names one.
 *
 * Three cases the party lookup gets wrong rather than misses.
 *
 * The architect owns two rows on the pack and is only ever late with the first.
 * The sweep starts their clock at the client meeting and stops it when the
 * preliminary plans land -- the full design is explicitly not something the
 * outreach waits for -- so going by party would put a red badge on a drawing
 * set nobody is waiting for on a job whose plans are a fortnight late.
 *
 * The waste management plan is chased on the architect's thread but is not one
 * of the architect's pack documents, so going by party would redden their
 * drawings instead. The developer's two alerts are about the bushfire report,
 * which the bushfire consultant produced.
 */
const NAMED_DOCUMENT: Readonly<
  Partial<Record<ComplianceAlertType, ComplianceDocumentType>>
> = {
  [ComplianceAlertType.ARCHITECT_PLANS_OVERDUE]:
    ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS,
  [ComplianceAlertType.ARCHITECT_REVISION_OVERDUE]:
    ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS,
  [ComplianceAlertType.WASTE_MANAGEMENT_PLAN_OVERDUE]:
    ComplianceDocumentType.WASTE_MANAGEMENT_PLAN,
  [ComplianceAlertType.DEVELOPER_RESPONSE_OVERDUE]:
    ComplianceDocumentType.BUSHFIRE_REPORT,
  [ComplianceAlertType.BUSHFIRE_REVISION_OVERDUE]:
    ComplianceDocumentType.BUSHFIRE_REPORT,
};

export function overdueComplianceDocuments(
  engagement: CertifierEngagementDetail | null | undefined,
): OverdueDocuments {
  if (!engagement) return EMPTY;

  const open = engagement.alerts.filter(
    (alert) => alert.status === ComplianceAlertStatus.OPEN,
  );
  if (open.length === 0) return EMPTY;

  const types = new Set<ComplianceDocumentType>();
  const documentIds = new Set<string>();

  const byType = new Map<ComplianceDocumentType, ComplianceDocumentWithFiles>();
  for (const document of engagement.documents) {
    if (!byType.has(document.documentType)) {
      byType.set(document.documentType, document);
    }
  }

  const markType = (type: ComplianceDocumentType) => {
    if (isOutstanding(byType.get(type))) types.add(type);
  };

  for (const alert of open) {
    if (NOT_A_LATE_DOCUMENT.has(alert.type)) continue;

    const named = NAMED_DOCUMENT[alert.type];
    if (named) {
      markType(named);
      continue;
    }

    const kind = APPLICATION_ALERT_KIND[alert.type];
    if (kind) {
      const documentType = EXTERNAL_APPLICATION_DOCUMENT_TYPE[kind];
      if (documentType) markType(documentType);
      continue;
    }

    const party = COMPLIANCE_ALERT_PARTY[alert.type];
    if (!party) continue;

    // What is left is the surveyor, who owes three types off the required pack,
    // and the consultants, who owe whichever checklist lines they were engaged
    // against. The two are marked differently because they are addressed
    // differently -- a pack row by type, a checklist line by id, since twenty
    // of those share one type and reddening the type would redden the list.
    const packTypes = documentTypesForParty(party);
    if (packTypes.length > 0) {
      for (const type of packTypes) markType(type);
    }

    const outreach = outreachForParty(engagement, party);
    if (!outreach) continue;

    const lineIds = new Set(
      outreach.deliverables
        .map((deliverable) => deliverable.checklistDocumentId)
        .filter((id): id is string => id !== null),
    );
    if (lineIds.size === 0 && outreach.checklistDocumentId) {
      lineIds.add(outreach.checklistDocumentId);
    }

    for (const document of engagement.documents) {
      if (lineIds.has(document.id) && isOutstanding(document)) {
        documentIds.add(document.id);
      }
    }
  }

  return { types, documentIds };
}

/**
 * Whether one row is late, addressed either way.
 *
 * The predicate the sections take, matching the shape of `isRowBusy` they
 * already take: a row that may not exist yet is named by its type, and one that
 * does is checked by id as well. Both, because a checklist line has an id and a
 * type that says nothing, and a pack row has a type and often no row at all.
 */
export function isDocumentOverdue(
  overdue: OverdueDocuments,
  document: ComplianceDocumentWithFiles | undefined,
  documentType: ComplianceDocumentType | undefined,
): boolean {
  if (document && overdue.documentIds.has(document.id)) return true;
  if (documentType === ComplianceDocumentType.CHECKLIST_ITEM) {
    // A checklist line is only ever late by id. Its type is shared with every
    // other line on the list, so matching on it would redden all twenty.
    return false;
  }
  return documentType !== undefined && overdue.types.has(documentType);
}

/** How many rows across the whole file are late — the tab badge's figure. */
export function overdueCount(overdue: OverdueDocuments): number {
  return overdue.types.size + overdue.documentIds.size;
}
