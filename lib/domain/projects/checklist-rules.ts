import {
  ChecklistIssueStatus,
  ChecklistItemState,
  ChecklistStatus,
} from "@prisma/client";

// The checklist rules that need no database: which issue moves exist, what
// blocks closing, how progress is counted, and what the tradie is emailed by
// default. Pure, so the screen can show exactly what the server will decide
// and a test can pin each rule without a fake database.

/**
 * The issue lifecycle. Only VERIFIED stops blocking closure, and VERIFIED is
 * reached only from RESOLVED: a reported fix is not a checked one.
 *
 * VERIFIED → OPEN is a reopen. It puts the issue back in the way of closing,
 * which is the point — a fix that failed after sign-off is a defect again.
 */
export const ISSUE_TRANSITIONS: Readonly<
  Record<ChecklistIssueStatus, readonly ChecklistIssueStatus[]>
> = {
  [ChecklistIssueStatus.OPEN]: [
    ChecklistIssueStatus.IN_PROGRESS,
    ChecklistIssueStatus.RESOLVED,
  ],
  [ChecklistIssueStatus.IN_PROGRESS]: [
    ChecklistIssueStatus.OPEN,
    ChecklistIssueStatus.RESOLVED,
  ],
  [ChecklistIssueStatus.RESOLVED]: [
    ChecklistIssueStatus.IN_PROGRESS,
    ChecklistIssueStatus.VERIFIED,
  ],
  [ChecklistIssueStatus.VERIFIED]: [ChecklistIssueStatus.OPEN],
};

export function canMoveIssue(
  from: ChecklistIssueStatus,
  to: ChecklistIssueStatus,
): boolean {
  return ISSUE_TRANSITIONS[from].includes(to);
}

export const ISSUE_STATUS_LABELS: Readonly<
  Record<ChecklistIssueStatus, string>
> = {
  [ChecklistIssueStatus.OPEN]: "Open",
  [ChecklistIssueStatus.IN_PROGRESS]: "In progress",
  [ChecklistIssueStatus.RESOLVED]: "Resolved – awaiting verification",
  [ChecklistIssueStatus.VERIFIED]: "Verified / signed off",
};

/** Anything short of a reviewer's sign-off still holds the checklist open. */
export function isBlockingIssue(status: ChecklistIssueStatus): boolean {
  return status !== ChecklistIssueStatus.VERIFIED;
}

export function isReviewed(state: ChecklistItemState): boolean {
  return state !== ChecklistItemState.UNCHECKED;
}

type ProgressItem = { readonly id: string; readonly state: ChecklistItemState };
type ProgressIssue = {
  readonly id: string;
  readonly itemId: string;
  readonly status: ChecklistIssueStatus;
};

export type ChecklistProgress = {
  readonly total: number;
  readonly reviewed: number;
  readonly checked: number;
  readonly notApplicable: number;
  /** Issues that still block closure: anything not yet verified. */
  readonly openIssues: number;
  /** Of those, the ones a tradie has reported fixed and nobody has checked. */
  readonly awaitingVerification: number;
  readonly totalIssues: number;
};

export function checklistProgress(
  items: readonly ProgressItem[],
  issues: readonly ProgressIssue[],
): ChecklistProgress {
  return {
    awaitingVerification: issues.filter(
      (issue) => issue.status === ChecklistIssueStatus.RESOLVED,
    ).length,
    checked: items.filter((item) => item.state === ChecklistItemState.CHECKED)
      .length,
    notApplicable: items.filter(
      (item) => item.state === ChecklistItemState.NOT_APPLICABLE,
    ).length,
    openIssues: issues.filter((issue) => isBlockingIssue(issue.status)).length,
    reviewed: items.filter((item) => isReviewed(item.state)).length,
    total: items.length,
    totalIssues: issues.length,
  };
}

export type ChecklistDisplayStatus =
  | "not_configured"
  | "not_started"
  | "in_progress"
  | "ready_to_close"
  | "closed";

export const CHECKLIST_STATUS_LABELS: Readonly<
  Record<ChecklistDisplayStatus, string>
> = {
  closed: "Closed",
  in_progress: "In progress",
  not_configured: "Not configured",
  not_started: "Not started",
  ready_to_close: "Ready to close",
};

export function checklistDisplayStatus(
  status: ChecklistStatus,
  progress: ChecklistProgress,
): ChecklistDisplayStatus {
  if (status === ChecklistStatus.CLOSED) return "closed";
  if (progress.total === 0) return "not_configured";
  if (progress.reviewed === 0 && progress.totalIssues === 0) {
    return "not_started";
  }
  if (progress.reviewed === progress.total && progress.openIssues === 0) {
    return "ready_to_close";
  }
  return "in_progress";
}

export type ClosureBlockers<
  I extends ProgressItem = ProgressItem,
  S extends ProgressIssue = ProgressIssue,
> = {
  readonly canClose: boolean;
  readonly notConfigured: boolean;
  readonly alreadyClosed: boolean;
  readonly unreviewed: readonly I[];
  /** Open or in progress: still being fixed. */
  readonly unresolved: readonly S[];
  /** Reported fixed, waiting for the reviewer to verify. */
  readonly awaitingVerification: readonly S[];
};

/**
 * What stands between this checklist and closing it. The server runs this
 * inside the closing transaction; the screen runs it to list the blockers.
 */
export function closureBlockers<
  I extends ProgressItem,
  S extends ProgressIssue,
>(input: {
  readonly status: ChecklistStatus;
  readonly items: readonly I[];
  readonly issues: readonly S[];
}): ClosureBlockers<I, S> {
  const unreviewed = input.items.filter((item) => !isReviewed(item.state));
  const unresolved = input.issues.filter(
    (issue) =>
      issue.status === ChecklistIssueStatus.OPEN
      || issue.status === ChecklistIssueStatus.IN_PROGRESS,
  );
  const awaitingVerification = input.issues.filter(
    (issue) => issue.status === ChecklistIssueStatus.RESOLVED,
  );
  const notConfigured = input.items.length === 0;
  const alreadyClosed = input.status === ChecklistStatus.CLOSED;
  return {
    alreadyClosed,
    awaitingVerification,
    canClose:
      !alreadyClosed
      && !notConfigured
      && unreviewed.length === 0
      && unresolved.length === 0
      && awaitingVerification.length === 0,
    notConfigured,
    unreviewed,
    unresolved,
  };
}

/** The sentence an operator reads when closing is refused. */
export function describeClosureBlockers(blockers: ClosureBlockers): string {
  if (blockers.alreadyClosed) return "This checklist is already closed.";
  if (blockers.notConfigured) {
    return "This checklist has no inspection items yet, so there is nothing to sign off.";
  }
  const parts: string[] = [];
  if (blockers.unreviewed.length > 0) {
    parts.push(
      `${blockers.unreviewed.length} inspection item${blockers.unreviewed.length === 1 ? " has" : "s have"} not been reviewed`,
    );
  }
  if (blockers.unresolved.length > 0) {
    parts.push(
      `${blockers.unresolved.length} issue${blockers.unresolved.length === 1 ? " is" : "s are"} still open or in progress`,
    );
  }
  if (blockers.awaitingVerification.length > 0) {
    parts.push(
      `${blockers.awaitingVerification.length} resolved issue${blockers.awaitingVerification.length === 1 ? " needs" : "s need"} your verification`,
    );
  }
  return `The checklist cannot be closed yet: ${parts.join("; ")}.`;
}

/**
 * The email the reviewer starts from when raising an issue, worded as the
 * client's specification suggests. Always editable before it is sent.
 */
export function defaultIssueEmail(input: {
  readonly projectName: string;
  readonly siteAddress: string;
  readonly checklistTitle: string;
  readonly section: string;
  readonly itemLabel: string;
  readonly description: string;
  readonly tradieName?: string | null;
  readonly photoCount: number;
}): { subject: string; body: string } {
  const inspection = input.checklistTitle.toLowerCase().includes("handover")
    ? "handover inspection"
    : `${input.checklistTitle.replace(/ checklist$/i, "").toLowerCase()} inspection`;
  const greeting = input.tradieName?.trim()
    ? `Hi ${input.tradieName.trim().split(/\s+/)[0]},`
    : "Hi,";
  const photos =
    input.photoCount > 0
      ? `Please review the attached photograph${input.photoCount === 1 ? "" : "s"}, arrange rectification, and confirm the expected completion date.`
      : "Please arrange rectification and confirm the expected completion date.";
  const detail = input.description.trim();
  return {
    body: [
      greeting,
      "",
      `During the ${inspection} at ${input.siteAddress}, we identified an issue with ${input.section} – ${input.itemLabel}. The delivered work does not meet the expected quality/finish standard.`,
      ...(detail ? ["", `Issue: ${detail}`] : []),
      "",
      photos,
      "",
      "Thank you,",
      "Royal Constructions",
    ].join("\n"),
    subject: `Rectification required – ${input.projectName}: ${input.section} – ${input.itemLabel}`,
  };
}

export type RankableTradie = {
  readonly id: string;
  readonly trades: readonly string[];
};

/**
 * Split the job's tradies into the ones whose trade matches the inspected
 * work and the rest. Nobody is dropped: the reviewer may know better than the
 * template who laid that floor, but the likely ones come first.
 */
export function rankTradiesForWork<T extends RankableTradie>(
  tradies: readonly T[],
  trades: readonly string[],
): { readonly matching: T[]; readonly others: T[] } {
  const wanted = new Set(trades.map((trade) => trade.trim().toLowerCase()));
  const matching: T[] = [];
  const others: T[] = [];
  for (const tradie of tradies) {
    const hit = tradie.trades.some((trade) =>
      wanted.has(trade.trim().toLowerCase()),
    );
    (hit ? matching : others).push(tradie);
  }
  return { matching, others };
}

/** A drawn signature, as the pad exports it. */
const SIGNATURE_PREFIX = "data:image/png;base64,";
/** About 200 KB of PNG: a drawn signature is a few KB. */
export const MAX_SIGNATURE_LENGTH = 280_000;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function isValidSignatureDataUrl(value: string): boolean {
  if (!value.startsWith(SIGNATURE_PREFIX)) return false;
  if (value.length > MAX_SIGNATURE_LENGTH) return false;
  const data = value.slice(SIGNATURE_PREFIX.length);
  return data.length >= 64 && BASE64.test(data);
}

export const CHECKLIST_LIMITS = {
  comments: 5000,
  description: 4000,
  emailBody: 10000,
  emailSubject: 300,
  naReason: 300,
  note: 2000,
  photosPerUpload: 20,
  reviewerName: 120,
} as const;
