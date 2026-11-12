import {
  ChecklistIssueStatus,
  ChecklistSignaturePurpose,
  ChecklistStatus,
  type ChecklistIssueEventKind,
  type ChecklistItemState,
  type ChecklistNotificationStatus,
  type ProjectStage,
} from "@prisma/client";

import { PROJECT_STAGE_LABELS } from "@/types/project";

import { authorizeProject } from "../access/projects";
import { canReadTradieDirectory } from "../access/tradies";
import type { DomainDb } from "../db";
import { DomainNotFoundError } from "../errors";
import type { DomainPrincipal } from "../principal";
import {
  checklistDisplayStatus,
  checklistProgress,
  type ChecklistDisplayStatus,
  type ChecklistProgress,
} from "./checklist-rules";
import { ensureProjectChecklists } from "./checklist-setup";
import { CHECKLIST_COUNT, tradesForItem } from "./checklist-templates";

// Reading a project's six stage checklists (issue #420): the overview and one
// checklist's inspection screen. The writes are split by what they decide:
// rows and photos in `checklist-review.ts`, closing in `checklist-closure.ts`,
// defects in `checklist-issue-*.ts`, the document in `checklist-export.ts`.
// Every one runs `authorizeProject` first, so a checklist id copied from
// another project reads as absent.

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

  const tradies = await checklistTradieOptions(principal, input.projectId, db);
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
 *
 * The rest of the directory goes only to a caller who may browse it
 * (`canReadTradieDirectory`). Everyone `authorizeProject` admits today can,
 * but the two rules are separate, and widening the first must not hand the
 * directory's emails to whoever it admits.
 */
async function checklistTradieOptions(
  principal: DomainPrincipal,
  projectId: string,
  db: DomainDb,
): Promise<ChecklistTradieOption[]> {
  const bookings = await db.tradieSchedule.findMany({
    select: { trade: true, tradieId: true },
    where: { projectId, status: { not: "CANCELLED" } },
  });
  const directory = await db.tradie.findMany({
    orderBy: { name: "asc" },
    select: { email: true, id: true, name: true, trade: true, trades: true },
    where: {
      archivedAt: null,
      ...(canReadTradieDirectory(principal)
        ? {}
        : { id: { in: bookings.map((booking) => booking.tradieId) } }),
    },
  });
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
