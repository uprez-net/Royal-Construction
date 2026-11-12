import {
  ChecklistIssueStatus,
  ChecklistItemState,
  ChecklistNotificationStatus,
  ChecklistSignaturePurpose,
  ChecklistStatus,
  type ChecklistIssueEventKind,
  type ProjectStage,
} from "@prisma/client";

import { PROJECT_STAGE_LABELS } from "@/types/project";

import { authorizeProject } from "../access/projects";
import { logActionOrThrow } from "../audit/action-log";
import type { DomainDb, TransactionalDomainDb } from "../db";
import {
  DomainNotFoundError,
  DomainStaleVersionError,
  DomainTransitionError,
  DomainValidationError,
} from "../errors";
import type { BlobDeletePort } from "../ports/blob";
import {
  requireAdminPrincipal,
  requireUserPrincipal,
  type DomainPrincipal,
} from "../principal";
import {
  CHECKLIST_LIMITS,
  checklistDisplayStatus,
  checklistProgress,
  closureBlockers,
  describeClosureBlockers,
  isBlockingIssue,
  isValidSignatureDataUrl,
  type ChecklistDisplayStatus,
  type ChecklistProgress,
} from "./checklist-rules";
import {
  CHECKLIST_COUNT,
  checklistDefinition,
  templateItems,
  tradesForItem,
} from "./checklist-templates";

// A project's six stage checklists (issue #420): reading them, reviewing their
// rows, attaching photos, and closing one once every row is answered and every
// defect raised against it has been verified and signed off.
//
// Defects themselves are `checklist-issues.ts`; the downloaded document is
// `checklist-export.ts`. Every command here runs `authorizeProject` first, so
// a checklist id copied from another project reads as absent, and a closed
// checklist refuses every write until it is reopened on purpose.

// ---------------------------------------------------------------------------
// Creating the six checklists
// ---------------------------------------------------------------------------

/**
 * Make sure all six checklists exist for this project, with the handover rows
 * copied onto the sixth. Idempotent: the unique keys make a second call, or
 * two tabs opening the tab at once, a no-op rather than a duplicate.
 *
 * Projects predate checklists, so this runs when the checklists are first
 * read rather than when the project was created.
 */
export async function ensureProjectChecklists(
  projectId: string,
  db: DomainDb,
): Promise<void> {
  const existing = await db.projectChecklist.findMany({
    select: {
      _count: { select: { items: true } },
      id: true,
      number: true,
      templateKey: true,
    },
    where: { projectId },
  });

  const missing = Array.from({ length: CHECKLIST_COUNT }, (_, index) =>
    checklistDefinition(index + 1),
  ).filter(
    (definition) => !existing.some((row) => row.number === definition.number),
  );
  let rows = existing;
  if (missing.length > 0) {
    await db.projectChecklist.createMany({
      data: missing.map((definition) => ({
        number: definition.number,
        projectId,
        stage: definition.stage,
        templateKey: definition.templateKey,
        title: definition.title,
      })),
      skipDuplicates: true,
    });
    rows = await db.projectChecklist.findMany({
      select: {
        _count: { select: { items: true } },
        id: true,
        number: true,
        templateKey: true,
      },
      where: { projectId },
    });
  }

  for (const row of rows) {
    const template = templateItems(row.templateKey);
    if (template.length === 0 || row._count.items >= template.length) continue;
    await db.checklistItem.createMany({
      data: template.map((item) => ({
        checklistId: row.id,
        key: item.key,
        label: item.label,
        order: item.order,
        section: item.section,
        sectionOrder: item.sectionOrder,
      })),
      skipDuplicates: true,
    });
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type ChecklistSummary = {
  readonly id: string;
  readonly number: number;
  readonly stage: ProjectStage;
  readonly stageLabel: string;
  readonly title: string;
  readonly status: ChecklistStatus;
  readonly displayStatus: ChecklistDisplayStatus;
  readonly progress: ChecklistProgress;
  readonly updatedAt: Date;
  readonly closedAt: Date | null;
};

/** The Checklists tab's overview: all six, with their counts. */
export async function listProjectChecklists(
  principal: DomainPrincipal,
  input: { readonly projectId: string },
  db: DomainDb,
): Promise<ChecklistSummary[]> {
  await authorizeProject(principal, input.projectId, db);
  await ensureProjectChecklists(input.projectId, db);
  const rows = await db.projectChecklist.findMany({
    include: {
      issues: { select: { id: true, itemId: true, status: true } },
      items: { select: { id: true, state: true } },
    },
    orderBy: { number: "asc" },
    where: { projectId: input.projectId },
  });
  return rows.map((row) => {
    const progress = checklistProgress(row.items, row.issues);
    return {
      closedAt: row.closedAt,
      displayStatus: checklistDisplayStatus(row.status, progress),
      id: row.id,
      number: row.number,
      progress,
      stage: row.stage,
      stageLabel: PROJECT_STAGE_LABELS[row.stage],
      status: row.status,
      title: row.title,
      updatedAt: row.updatedAt,
    };
  });
}

export type ChecklistPhoto = {
  readonly id: string;
  readonly fileId: string;
  readonly url: string;
  readonly filename: string;
  readonly contentType: string;
  readonly issueId: string | null;
  readonly createdAt: Date;
};

export type ChecklistTradieOption = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly trades: readonly string[];
  /** Booked on this project. */
  readonly onProject: boolean;
};

export type ChecklistIssueView = {
  readonly id: string;
  readonly number: number;
  readonly itemId: string;
  readonly section: string;
  readonly itemLabel: string;
  readonly description: string;
  readonly comments: string | null;
  readonly status: ChecklistIssueStatus;
  readonly assignedTradie: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
  } | null;
  readonly notificationStatus: ChecklistNotificationStatus;
  readonly notificationError: string | null;
  readonly notifiedAt: Date | null;
  readonly notifiedTo: string | null;
  readonly emailSubject: string | null;
  readonly emailBody: string | null;
  readonly resolvedAt: Date | null;
  readonly verifiedAt: Date | null;
  readonly verificationNote: string | null;
  readonly verification: {
    readonly reviewerName: string;
    readonly signedAt: Date;
  } | null;
  readonly photos: readonly ChecklistPhoto[];
  readonly events: ReadonlyArray<{
    readonly id: string;
    readonly kind: ChecklistIssueEventKind;
    readonly fromStatus: ChecklistIssueStatus | null;
    readonly toStatus: ChecklistIssueStatus | null;
    readonly note: string | null;
    readonly actorName: string | null;
    readonly createdAt: Date;
  }>;
  readonly createdAt: Date;
};

export type ChecklistItemView = {
  readonly id: string;
  readonly key: string;
  readonly section: string;
  readonly label: string;
  readonly state: ChecklistItemState;
  readonly naReason: string | null;
  readonly reviewedAt: Date | null;
  /** The trades that usually did this work, for ranking tradies. */
  readonly trades: readonly string[];
  readonly photos: readonly ChecklistPhoto[];
  readonly issueIds: readonly string[];
};

export type ChecklistDetail = {
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly address: string;
    readonly houseType: string;
  };
  readonly id: string;
  readonly number: number;
  readonly stage: ProjectStage;
  readonly stageLabel: string;
  readonly title: string;
  readonly templateKey: string;
  readonly status: ChecklistStatus;
  readonly displayStatus: ChecklistDisplayStatus;
  readonly version: number;
  readonly comments: string | null;
  readonly checkedBy: string | null;
  readonly updatedAt: Date;
  readonly closedAt: Date | null;
  readonly closure: {
    readonly reviewerName: string;
    readonly signatureDataUrl: string;
    readonly signedAt: Date;
  } | null;
  readonly progress: ChecklistProgress;
  readonly sections: ReadonlyArray<{
    readonly section: string;
    readonly items: readonly ChecklistItemView[];
  }>;
  readonly issues: readonly ChecklistIssueView[];
  readonly tradies: readonly ChecklistTradieOption[];
  readonly exports: ReadonlyArray<{
    readonly id: string;
    readonly version: number;
    readonly final: boolean;
    readonly reviewerName: string;
    readonly generatedAt: Date;
  }>;
};

function photoView(attachment: {
  id: string;
  issueId: string | null;
  createdAt: Date;
  file: { id: string; url: string; filename: string; fileType: string };
}): ChecklistPhoto {
  return {
    contentType: attachment.file.fileType,
    createdAt: attachment.createdAt,
    fileId: attachment.file.id,
    filename: attachment.file.filename,
    id: attachment.id,
    issueId: attachment.issueId,
    url: attachment.file.url,
  };
}

const PHOTO_INCLUDE = {
  file: { select: { fileType: true, filename: true, id: true, url: true } },
} as const;

/** One checklist, everything its inspection screen shows. */
export async function getChecklistDetail(
  principal: DomainPrincipal,
  input: { readonly projectId: string; readonly number: number },
  db: DomainDb,
): Promise<ChecklistDetail> {
  await authorizeProject(principal, input.projectId, db);
  if (
    !Number.isInteger(input.number)
    || input.number < 1
    || input.number > CHECKLIST_COUNT
  ) {
    throw new DomainNotFoundError("There is no such checklist.");
  }
  await ensureProjectChecklists(input.projectId, db);

  const row = await db.projectChecklist.findUnique({
    include: {
      exports: {
        orderBy: { generatedAt: "desc" },
        select: {
          final: true,
          generatedAt: true,
          id: true,
          reviewerName: true,
          version: true,
        },
        take: 10,
      },
      issues: {
        include: {
          assignedTradie: { select: { email: true, id: true, name: true } },
          attachments: {
            include: PHOTO_INCLUDE,
            orderBy: { createdAt: "asc" },
          },
          events: { orderBy: { createdAt: "asc" } },
          signatures: {
            orderBy: { signedAt: "desc" },
            select: { reviewerName: true, signedAt: true },
            take: 1,
            where: { purpose: ChecklistSignaturePurpose.ISSUE_VERIFICATION },
          },
        },
        orderBy: { number: "asc" },
      },
      items: {
        include: {
          attachments: {
            include: PHOTO_INCLUDE,
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { order: "asc" },
      },
      project: {
        select: { buildingType: true, id: true, location: true, name: true },
      },
      signatures: {
        orderBy: { signedAt: "desc" },
        select: { imageDataUrl: true, reviewerName: true, signedAt: true },
        take: 1,
        where: { purpose: ChecklistSignaturePurpose.CHECKLIST_CLOSURE },
      },
    },
    where: {
      projectId_number: { number: input.number, projectId: input.projectId },
    },
  });
  if (!row) throw new DomainNotFoundError("There is no such checklist.");

  const tradies = await checklistTradieOptions(input.projectId, db);
  const progress = checklistProgress(row.items, row.issues);
  const itemsById = new Map(row.items.map((item) => [item.id, item]));

  const sections: { section: string; items: ChecklistItemView[] }[] = [];
  for (const item of row.items) {
    let group = sections.at(-1);
    if (!group || group.section !== item.section) {
      group = { items: [], section: item.section };
      sections.push(group);
    }
    group.items.push({
      id: item.id,
      issueIds: row.issues
        .filter((issue) => issue.itemId === item.id)
        .map((issue) => issue.id),
      key: item.key,
      label: item.label,
      naReason: item.naReason,
      photos: item.attachments.map(photoView),
      reviewedAt: item.reviewedAt,
      section: item.section,
      state: item.state,
      trades: tradesForItem(row.templateKey, item.key),
    });
  }

  const closure =
    row.status === ChecklistStatus.CLOSED ? row.signatures[0] : undefined;

  return {
    checkedBy: row.checkedBy,
    closedAt: row.closedAt,
    closure: closure
      ? {
          reviewerName: closure.reviewerName,
          signatureDataUrl: closure.imageDataUrl,
          signedAt: closure.signedAt,
        }
      : null,
    comments: row.comments,
    displayStatus: checklistDisplayStatus(row.status, progress),
    exports: row.exports,
    id: row.id,
    issues: row.issues.map((issue) => {
      const item = itemsById.get(issue.itemId);
      const verification = issue.signatures[0];
      return {
        assignedTradie: issue.assignedTradie,
        comments: issue.comments,
        createdAt: issue.createdAt,
        description: issue.description,
        emailBody: issue.emailBody,
        emailSubject: issue.emailSubject,
        events: issue.events.map((event) => ({
          actorName: event.actorName,
          createdAt: event.createdAt,
          fromStatus: event.fromStatus,
          id: event.id,
          kind: event.kind,
          note: event.note,
          toStatus: event.toStatus,
        })),
        id: issue.id,
        itemId: issue.itemId,
        itemLabel: item?.label ?? "",
        notificationError: issue.notificationError,
        notificationStatus: issue.notificationStatus,
        notifiedAt: issue.notifiedAt,
        notifiedTo: issue.notifiedTo,
        number: issue.number,
        photos: issue.attachments.map(photoView),
        resolvedAt: issue.resolvedAt,
        section: item?.section ?? "",
        status: issue.status,
        verification:
          issue.status === ChecklistIssueStatus.VERIFIED && verification
            ? verification
            : null,
        verificationNote: issue.verificationNote,
        verifiedAt: issue.verifiedAt,
      };
    }),
    number: row.number,
    progress,
    project: {
      address: row.project.location,
      houseType: row.project.buildingType,
      id: row.project.id,
      name: row.project.name,
    },
    sections,
    stage: row.stage,
    stageLabel: PROJECT_STAGE_LABELS[row.stage],
    status: row.status,
    templateKey: row.templateKey,
    title: row.title,
    tradies,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

/**
 * Who an issue can be assigned to: every tradie booked on this project first,
 * then the rest of the directory, so the reviewer can choose another
 * contractor when nobody on the job did the work.
 */
async function checklistTradieOptions(
  projectId: string,
  db: DomainDb,
): Promise<ChecklistTradieOption[]> {
  const [bookings, directory] = await Promise.all([
    db.tradieSchedule.findMany({
      select: { trade: true, tradieId: true },
      where: { projectId, status: { not: "CANCELLED" } },
    }),
    db.tradie.findMany({
      orderBy: { name: "asc" },
      select: { email: true, id: true, name: true, trade: true, trades: true },
      where: { archivedAt: null },
    }),
  ]);
  const bookedTrades = new Map<string, Set<string>>();
  for (const booking of bookings) {
    const trades = bookedTrades.get(booking.tradieId) ?? new Set<string>();
    if (booking.trade) trades.add(booking.trade);
    bookedTrades.set(booking.tradieId, trades);
  }
  const options = directory.map((tradie) => {
    const booked = bookedTrades.get(tradie.id);
    const trades = [
      ...new Set([
        ...(booked ?? []),
        ...(tradie.trades.length > 0 ? tradie.trades : [tradie.trade]),
      ]),
    ];
    return {
      email: tradie.email,
      id: tradie.id,
      name: tradie.name,
      onProject: booked !== undefined,
      trades,
    };
  });
  return [
    ...options.filter((option) => option.onProject),
    ...options.filter((option) => !option.onProject),
  ];
}

// ---------------------------------------------------------------------------
// Shared write helpers
// ---------------------------------------------------------------------------

export type ChecklistActor = { readonly id: string; readonly name: string };

/** Who is writing, with a name snapshot for the history. */
export async function checklistActor(
  principal: DomainPrincipal,
  db: DomainDb,
): Promise<ChecklistActor> {
  const user = requireUserPrincipal(principal);
  const row = await db.user.findUnique({
    select: { name: true },
    where: { id: user.userId },
  });
  return { id: user.userId, name: row?.name ?? "Unknown user" };
}

type LoadedChecklist = {
  readonly id: string;
  readonly projectId: string;
  readonly number: number;
  readonly title: string;
  readonly status: ChecklistStatus;
  readonly version: number;
  readonly templateKey: string;
};

/**
 * The checklist, checked against the project it was named with. A checklist
 * id copied from another project reads as absent.
 */
export async function loadChecklist(
  input: { readonly projectId: string; readonly checklistId: string },
  db: DomainDb,
  options: { readonly requireOpen?: boolean } = {},
): Promise<LoadedChecklist> {
  const row = await db.projectChecklist.findFirst({
    select: {
      id: true,
      number: true,
      projectId: true,
      status: true,
      templateKey: true,
      title: true,
      version: true,
    },
    where: { id: input.checklistId, projectId: input.projectId },
  });
  if (!row)
    throw new DomainNotFoundError("That checklist is not on this project.");
  if (options.requireOpen && row.status === ChecklistStatus.CLOSED) {
    throw new DomainTransitionError(
      "This checklist is closed. Reopen it before making changes.",
      row.status,
      "EDIT",
    );
  }
  return row;
}

/** Record that the checklist changed: a new revision for its next document. */
export async function touchChecklist(
  checklistId: string,
  db: DomainDb,
): Promise<void> {
  await db.projectChecklist.update({
    data: { version: { increment: 1 } },
    where: { id: checklistId },
  });
}

function trimmed(value: string | null | undefined, max: number, field: string) {
  const text = value?.trim() ?? "";
  if (text.length > max) {
    throw new DomainValidationError(
      `Keep this under ${max.toLocaleString("en-AU")} characters.`,
      field,
    );
  }
  return text;
}

export function requireReviewerName(value: string): string {
  const name = trimmed(value, CHECKLIST_LIMITS.reviewerName, "reviewerName");
  if (!name) {
    throw new DomainValidationError(
      "Enter the reviewer's name.",
      "reviewerName",
    );
  }
  return name;
}

export function requireSignature(value: string): string {
  if (!isValidSignatureDataUrl(value)) {
    throw new DomainValidationError(
      "Draw or upload the reviewer's signature.",
      "signature",
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Reviewing rows
// ---------------------------------------------------------------------------

export type SetChecklistItemStateInput = {
  readonly projectId: string;
  readonly checklistId: string;
  readonly itemId: string;
  readonly state: ChecklistItemState;
  /** Required when the row does not apply to this house. */
  readonly naReason?: string | null;
};

/** Tick a row, untick it, or mark it not applicable with a reason. */
export async function setChecklistItemState(
  principal: DomainPrincipal,
  input: SetChecklistItemStateInput,
  db: DomainDb,
  now: Date = new Date(),
): Promise<{ readonly itemId: string; readonly state: ChecklistItemState }> {
  await authorizeProject(principal, input.projectId, db);
  const actor = requireUserPrincipal(principal);
  const checklist = await loadChecklist(input, db, { requireOpen: true });
  const item = await db.checklistItem.findFirst({
    select: {
      id: true,
      issues: { select: { status: true } },
    },
    where: { checklistId: checklist.id, id: input.itemId },
  });
  if (!item)
    throw new DomainNotFoundError("That row is not on this checklist.");

  let naReason: string | null = null;
  if (input.state === ChecklistItemState.NOT_APPLICABLE) {
    naReason = trimmed(input.naReason, CHECKLIST_LIMITS.naReason, "naReason");
    if (!naReason) {
      throw new DomainValidationError(
        "Say why this does not apply to the house, so the document records it.",
        "naReason",
      );
    }
    if (item.issues.some((issue) => isBlockingIssue(issue.status))) {
      throw new DomainValidationError(
        "This row has an open issue. Resolve and verify it before marking the row not applicable.",
        "state",
      );
    }
  }

  await db.checklistItem.update({
    data: {
      naReason,
      reviewedAt: input.state === ChecklistItemState.UNCHECKED ? null : now,
      reviewedById:
        input.state === ChecklistItemState.UNCHECKED ? null : actor.userId,
      state: input.state,
    },
    where: { id: item.id },
  });
  await touchChecklist(checklist.id, db);
  return { itemId: item.id, state: input.state };
}

/** The source document's header and footer fields. */
export async function updateChecklistDetails(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly checklistId: string;
    readonly comments?: string | null;
    readonly checkedBy?: string | null;
  },
  db: DomainDb,
): Promise<{
  readonly comments: string | null;
  readonly checkedBy: string | null;
}> {
  await authorizeProject(principal, input.projectId, db);
  requireUserPrincipal(principal);
  const checklist = await loadChecklist(input, db, { requireOpen: true });
  const data: { comments?: string | null; checkedBy?: string | null } = {};
  if (input.comments !== undefined) {
    data.comments =
      trimmed(input.comments, CHECKLIST_LIMITS.comments, "comments") || null;
  }
  if (input.checkedBy !== undefined) {
    data.checkedBy =
      trimmed(input.checkedBy, CHECKLIST_LIMITS.reviewerName, "checkedBy")
      || null;
  }
  const updated = await db.projectChecklist.update({
    data: { ...data, version: { increment: 1 } },
    select: { checkedBy: true, comments: true },
    where: { id: checklist.id },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export type AttachChecklistPhotosInput = {
  readonly projectId: string;
  readonly checklistId: string;
  readonly itemId: string;
  /** Project File ids, already uploaded and confirmed. */
  readonly fileIds: readonly string[];
  /** Attach as evidence for this issue on the same row. */
  readonly issueId?: string | null;
};

/**
 * Link uploaded photos to an inspection row, and optionally to one of its
 * issues as evidence. Idempotent for a retry: a photo already on this row is
 * left where it is (and becomes evidence if asked); one on another row is
 * refused rather than moved.
 */
export async function attachChecklistPhotos(
  principal: DomainPrincipal,
  input: AttachChecklistPhotosInput,
  db: DomainDb,
): Promise<{ readonly attached: number }> {
  await authorizeProject(principal, input.projectId, db);
  const actor = requireUserPrincipal(principal);
  const checklist = await loadChecklist(input, db, { requireOpen: true });
  const fileIds = [...new Set(input.fileIds)];
  if (fileIds.length === 0) return { attached: 0 };
  if (fileIds.length > CHECKLIST_LIMITS.photosPerUpload) {
    throw new DomainValidationError(
      `Attach up to ${CHECKLIST_LIMITS.photosPerUpload} photos at a time.`,
      "fileIds",
    );
  }

  const item = await db.checklistItem.findFirst({
    select: { id: true },
    where: { checklistId: checklist.id, id: input.itemId },
  });
  if (!item)
    throw new DomainNotFoundError("That row is not on this checklist.");

  let issueId: string | null = null;
  if (input.issueId) {
    const issue = await db.checklistIssue.findFirst({
      select: { id: true, itemId: true },
      where: { checklistId: checklist.id, id: input.issueId },
    });
    if (!issue || issue.itemId !== item.id) {
      throw new DomainNotFoundError("That issue is not on this row.");
    }
    issueId = issue.id;
  }

  const files = await db.file.findMany({
    select: { fileType: true, id: true },
    where: { id: { in: fileIds }, projectId: input.projectId },
  });
  if (files.length !== fileIds.length) {
    throw new DomainNotFoundError(
      "One of those photos is not on this project. Upload it again.",
    );
  }
  if (files.some((file) => !file.fileType.startsWith("image/"))) {
    throw new DomainValidationError(
      "Only photos can be attached to an inspection row.",
      "fileIds",
    );
  }

  const existing = await db.checklistAttachment.findMany({
    select: { fileId: true, issueId: true, itemId: true },
    where: { fileId: { in: fileIds } },
  });
  if (existing.some((row) => row.itemId !== item.id)) {
    throw new DomainValidationError(
      "One of those photos is already on another inspection row.",
      "fileIds",
    );
  }
  if (
    issueId
    && existing.some((row) => row.issueId !== null && row.issueId !== issueId)
  ) {
    throw new DomainValidationError(
      "One of those photos is already evidence for another issue.",
      "fileIds",
    );
  }

  const fresh = fileIds.filter(
    (fileId) => !existing.some((row) => row.fileId === fileId),
  );
  if (fresh.length > 0) {
    await db.checklistAttachment.createMany({
      data: fresh.map((fileId) => ({
        fileId,
        issueId,
        itemId: item.id,
        uploadedById: actor.userId,
      })),
      skipDuplicates: true,
    });
  }
  if (issueId) {
    await db.checklistAttachment.updateMany({
      data: { issueId },
      where: { fileId: { in: fileIds }, issueId: null, itemId: item.id },
    });
    const who = await checklistActor(principal, db);
    await db.checklistIssueEvent.create({
      data: {
        actorId: who.id,
        actorName: who.name,
        issueId,
        kind: "EVIDENCE_ADDED",
        note: `${fileIds.length} photo${fileIds.length === 1 ? "" : "s"} added`,
      },
    });
  }
  await touchChecklist(checklist.id, db);
  return { attached: fileIds.length };
}

/**
 * Remove a photo attached by mistake. Evidence for an issue is kept: once it
 * has been sent to a tradie or verified against, it is the record.
 */
export async function removeChecklistPhoto(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly checklistId: string;
    readonly attachmentId: string;
  },
  db: DomainDb,
  deleteBlob: BlobDeletePort,
): Promise<{ readonly removed: true }> {
  await authorizeProject(principal, input.projectId, db);
  requireUserPrincipal(principal);
  const checklist = await loadChecklist(input, db, { requireOpen: true });
  const attachment = await db.checklistAttachment.findFirst({
    include: {
      file: true,
      issue: { select: { number: true } },
    },
    where: { id: input.attachmentId, item: { checklistId: checklist.id } },
  });
  if (!attachment) {
    throw new DomainNotFoundError("That photo is not on this checklist.");
  }
  if (attachment.issueId) {
    throw new DomainValidationError(
      `This photo is evidence for issue #${attachment.issue?.number ?? ""} and is kept with it.`,
      "attachmentId",
    );
  }

  const file = attachment.file;
  // A photo uploaded for this row is only this row's. One that is also on a
  // lead, a milestone or a compliance document keeps its file.
  const ownedHere =
    file.leadId === null
    && file.milestoneId === null
    && file.complianceDocumentId === null
    && file.incidentId === null;
  if (ownedHere) {
    // Cascades the attachment row.
    await db.file.delete({ where: { id: file.id } });
  } else {
    await db.checklistAttachment.delete({ where: { id: attachment.id } });
  }
  await touchChecklist(checklist.id, db);
  if (ownedHere) {
    try {
      await deleteBlob(file.url);
    } catch (error) {
      // The rows are gone; an orphaned object costs storage, not data.
      console.error("[checklists] photo storage cleanup failed", error);
    }
  }
  return { removed: true };
}

// ---------------------------------------------------------------------------
// Closing and reopening
// ---------------------------------------------------------------------------

export type CloseChecklistInput = {
  readonly projectId: string;
  readonly checklistId: string;
  /** The revision the reviewer is looking at. A stale page is refused. */
  readonly expectedVersion: number;
  readonly reviewerName: string;
  readonly signatureDataUrl: string;
};

/**
 * Close the checklist: every row reviewed, every issue verified and signed
 * off, and the reviewer's name and signature captured. Checked here, inside
 * the transaction that closes it, not trusted from a disabled button.
 */
export async function closeChecklist(
  principal: DomainPrincipal,
  input: CloseChecklistInput,
  db: TransactionalDomainDb,
  now: Date = new Date(),
): Promise<{ readonly closedAt: Date; readonly version: number }> {
  const reviewerName = requireReviewerName(input.reviewerName);
  const signature = requireSignature(input.signatureDataUrl);

  return db.$transaction(async (tx) => {
    const project = await authorizeProject(principal, input.projectId, tx);
    const actor = await checklistActor(principal, tx);
    const checklist = await loadChecklist(input, tx);
    if (checklist.version !== input.expectedVersion) {
      throw new DomainStaleVersionError(
        "This checklist changed since you opened it. Review the latest version before signing it off.",
        input.expectedVersion,
        checklist.version,
      );
    }
    const [items, issues] = await Promise.all([
      tx.checklistItem.findMany({
        select: { id: true, state: true },
        where: { checklistId: checklist.id },
      }),
      tx.checklistIssue.findMany({
        select: { id: true, itemId: true, status: true },
        where: { checklistId: checklist.id },
      }),
    ]);
    const blockers = closureBlockers({
      issues,
      items,
      status: checklist.status,
    });
    if (!blockers.canClose) {
      throw new DomainTransitionError(
        describeClosureBlockers(blockers),
        checklist.status,
        ChecklistStatus.CLOSED,
      );
    }

    // Guarded on the version read above, so a second tab closing at the same
    // moment finds nothing to update instead of signing twice.
    const closed = await tx.projectChecklist.updateMany({
      data: {
        closedAt: now,
        closedById: actor.id,
        status: ChecklistStatus.CLOSED,
        version: { increment: 1 },
      },
      where: {
        id: checklist.id,
        status: ChecklistStatus.OPEN,
        version: input.expectedVersion,
      },
    });
    if (closed.count !== 1) {
      throw new DomainStaleVersionError(
        "This checklist changed while you were signing it. Reload and try again.",
      );
    }
    await tx.checklistSignature.create({
      data: {
        checklistId: checklist.id,
        imageDataUrl: signature,
        purpose: ChecklistSignaturePurpose.CHECKLIST_CLOSURE,
        reviewerName,
        signedAt: now,
        signedById: actor.id,
      },
    });
    await logActionOrThrow(
      {
        authorId: actor.id,
        message: `${checklist.title} closed and signed off by ${reviewerName} for ${project.name}`,
        projectId: input.projectId,
        timestamp: now,
        type: "checklistClosed",
      },
      tx,
    );
    return { closedAt: now, version: input.expectedVersion + 1 };
  });
}

/**
 * Reopen a closed checklist. Admin only, with a reason, because it takes back
 * a signed-off inspection.
 */
export async function reopenChecklist(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly checklistId: string;
    readonly reason: string;
  },
  db: TransactionalDomainDb,
  now: Date = new Date(),
): Promise<{ readonly version: number }> {
  requireAdminPrincipal(principal);
  const reason = trimmed(input.reason, CHECKLIST_LIMITS.note, "reason");
  if (!reason) {
    throw new DomainValidationError(
      "Say why the checklist is being reopened. It is kept in the project history.",
      "reason",
    );
  }
  return db.$transaction(async (tx) => {
    const project = await authorizeProject(principal, input.projectId, tx);
    const actor = await checklistActor(principal, tx);
    const checklist = await loadChecklist(input, tx);
    if (checklist.status !== ChecklistStatus.CLOSED) {
      throw new DomainTransitionError(
        "This checklist is not closed.",
        checklist.status,
        ChecklistStatus.OPEN,
      );
    }
    const updated = await tx.projectChecklist.update({
      data: {
        closedAt: null,
        closedById: null,
        status: ChecklistStatus.OPEN,
        version: { increment: 1 },
      },
      select: { version: true },
      where: { id: checklist.id },
    });
    await logActionOrThrow(
      {
        authorId: actor.id,
        message: `${checklist.title} reopened by ${actor.name} for ${project.name}: ${reason}`,
        projectId: input.projectId,
        timestamp: now,
        type: "checklistReopened",
      },
      tx,
    );
    return { version: updated.version };
  });
}
