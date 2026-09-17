import "server-only";

import {
  ComplianceAlertSource,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  Prisma,
} from "@prisma/client";
import { revalidateTag } from "next/cache";

import type { AssessorKind } from "@/lib/agent/assessorCorrespondenceAgent";
import {
  comparableName,
  matchRejection,
  type RejectionCandidate,
} from "@/lib/compliance/rejection-matching";
import {
  complianceDocumentLabel,
  DA_DOCUMENTS,
} from "@/constants/complianceDocuments";
import { notifyCompliance } from "@/lib/compliance/notify";
import prisma from "@/lib/prisma";
import { createActivityLogEntry } from "@/types/activityLog";
import { CACHE_PROFILES } from "@/types/cache";
import { logAction } from "./actionLog";

/**
 * What an assessing body asks for once it holds the pack.
 *
 * The council's half of the DA, and the mirror of what
 * lib/workflow/compliance-checklist.ts does with a certifier's checklist. The
 * shapes are close enough to be worth naming the differences.
 *
 * A checklist arrives once, as a document, and is re-extracted whole — so that
 * code reconciles a new reading against the rows it wrote last time and removes
 * lines the revised checklist dropped. Council requests arrive as a series of
 * emails over months, each one adding to what came before, and nothing is ever
 * withdrawn: a request that has been answered stays answered, and one that has
 * not is still outstanding. So this only ever adds, and the only reconciliation
 * it does is refusing to write the same request twice.
 *
 * The other difference is that a council rejects things. A certifier does too,
 * but only through the screen — an admin reads their reply and presses Reject.
 * A council does it in prose, naming a document we already hold, and the whole
 * value of reading it is landing the objection on the row it belongs to.
 */

function revalidateEngagement(projectId: string) {
  revalidateTag(`project-${projectId}`, CACHE_PROFILES.SHORT);
  revalidateTag(`compliance-${projectId}`, CACHE_PROFILES.SHORT);
}

/**
 * Every row a rejection could be about, with the names it might be called.
 *
 * The matching itself is in lib/compliance/rejection-matching.ts, which is a
 * plain module: it is the one genuinely uncertain step in this pipeline and it
 * has to be reachable from a test, which a `"use server"` module is not.
 */
async function rejectionCandidates(
  engagementId: string,
  documentTypes: readonly ComplianceDocumentType[],
): Promise<RejectionCandidate[]> {
  const rows = await prisma.complianceDocument.findMany({
    where: { engagementId, documentType: { in: [...documentTypes] } },
    select: { id: true, documentType: true, label: true, order: true },
  });

  return rows.map((row) => ({
    id: row.id,
    // An issued item is known by the sender's own wording; a typed row is known
    // by ours. Both are compared, because a council refusing "the hydraulic
    // plans" is refusing the row we call "Hydraulic/stormwater drawings &
    // design certificate" and neither name contains the other.
    names: [
      row.label ?? "",
      complianceDocumentLabel(row.documentType, row.label),
      row.documentType.replace(/_/g, " "),
    ]
      .map(comparableName)
      .filter(Boolean),
    // Only a row on a numbered list has one that means anything. A certifier
    // saying "item 7" means the seventh line of their checklist; nothing on the
    // DA's fixed groups is numbered, and `order` there is assembly order.
    order: ISSUED_ITEM_TYPES.has(row.documentType) ? row.order : null,
  }));
}

/** The two row types that belong to a numbered list somebody issued. */
const ISSUED_ITEM_TYPES: ReadonlySet<ComplianceDocumentType> = new Set([
  ComplianceDocumentType.CHECKLIST_ITEM,
  ComplianceDocumentType.DA_ITEM,
]);

export type IssuedItemOutcome = {
  /** Rows written for things the sender newly asked for. */
  created: number;
  /** Rejections landed on a row. */
  rejected: number;
  /** Rejections we could not place, with the sender's own wording. */
  unmatched: string[];
};

/**
 * How each body's correspondence lands on the file.
 *
 * A table rather than two near-identical functions, because everything that
 * differs between them is here: which row type a new request becomes, which
 * rows a refusal can be about, and whose name goes on the refusal. The
 * behaviour -- add without reconciling, refuse to write the same request twice,
 * place an objection or report that it could not be placed -- is genuinely
 * identical, and was worth writing once.
 */
const ASSESSOR_ROWS: Readonly<
  Record<
    AssessorKind,
    {
      itemType: ComplianceDocumentType;
      rejectable: readonly ComplianceDocumentType[];
      source: ComplianceAlertSource;
    }
  >
> = {
  council: {
    itemType: ComplianceDocumentType.DA_ITEM,
    // Both kinds: the stormwater drawings that went in with the pack, and the
    // shadow diagram they asked for in round two and did not like.
    rejectable: [
      ComplianceDocumentType.DA_ITEM,
      ...DA_DOCUMENTS.map((document) => document.type),
    ],
    source: ComplianceAlertSource.COUNCIL,
  },
  certifier: {
    itemType: ComplianceDocumentType.CHECKLIST_ITEM,
    // Only their own checklist. The required pack and the signed copies are
    // documents they already hold and were never asked to pass judgement on --
    // the same narrowing `isApprovableDocumentType` makes on the screen, and
    // for the same reason: a refusal landed on one of those freezes a row
    // nobody can then re-upload.
    rejectable: [ComplianceDocumentType.CHECKLIST_ITEM],
    source: ComplianceAlertSource.CERTIFIER,
  },
};

/**
 * Records what an assessing body's message asked for and what it sent back.
 *
 * Idempotent in both halves, which matters because a durable workflow retries
 * and because both bodies routinely re-send the same letter. A request whose
 * wording already exists as a row is not written again, and a rejection whose
 * reason is already on the row it names changes nothing.
 */
export async function applyAssessorCorrespondence(params: {
  projectId: string;
  engagementId: string;
  assessor: AssessorKind;
  requested: { label: string; description: string }[];
  rejected: { documentName: string; reason: string }[];
}): Promise<IssuedItemOutcome> {
  const rows = ASSESSOR_ROWS[params.assessor];
  const outcome: IssuedItemOutcome = {
    created: 0,
    rejected: 0,
    unmatched: [],
  };

  // ------------------------------------------------------------------
  // What they asked for.
  // ------------------------------------------------------------------
  if (params.requested.length > 0) {
    const existing = await prisma.complianceDocument.findMany({
      where: {
        engagementId: params.engagementId,
        documentType: rows.itemType,
      },
      select: { label: true, order: true },
      orderBy: { order: "desc" },
    });

    const seen = new Set(
      existing.map((row) => comparableName(row.label ?? "")).filter(Boolean),
    );
    // Appended after whatever is there. Order is the order they were asked for,
    // which is the order somebody works through them in — a council's round
    // three sits under its round two rather than being interleaved by wording.
    let order = (existing[0]?.order ?? 0) + 1;

    for (const item of params.requested) {
      const key = comparableName(item.label);
      if (!key || seen.has(key)) {
        // Already on the list. A sender re-sending their request letter, or a
        // workflow retry, is the same request rather than a second one.
        continue;
      }
      seen.add(key);

      await prisma.complianceDocument.create({
        data: {
          engagementId: params.engagementId,
          documentType: rows.itemType,
          status: ComplianceDocumentStatus.PENDING,
          label: item.label,
          order: order++,
          // The same shape a checklist item's detail carries, so the row
          // component that renders the certifier's conditions renders these
          // without knowing which body wrote them.
          detail: item.description
            ? ({ description: item.description } as Prisma.InputJsonValue)
            : Prisma.DbNull,
        },
      });
      outcome.created += 1;
    }
  }

  // ------------------------------------------------------------------
  // What they sent back.
  // ------------------------------------------------------------------
  if (params.rejected.length > 0) {
    const candidates = await rejectionCandidates(
      params.engagementId,
      rows.rejectable,
    );

    for (const rejection of params.rejected) {
      const documentId = matchRejection(rejection.documentName, candidates);
      if (!documentId) {
        outcome.unmatched.push(rejection.documentName);
        continue;
      }

      // Back to outstanding with the reason on it, which is what the row reads
      // to offer an upload control again. Deliberately the same shape a
      // certifier rejection leaves — `resolveComplianceDocument` does exactly
      // this — so one row component handles a refusal from either body, and
      // `rejectedBySource` is what tells them apart on screen.
      await prisma.complianceDocument.update({
        where: { id: documentId },
        data: {
          status: ComplianceDocumentStatus.PENDING,
          rejectionReason: rejection.reason,
          rejectedBySource: rows.source,
        },
      });
      outcome.rejected += 1;
    }
  }

  if (outcome.created === 0 && outcome.rejected === 0) {
    return outcome;
  }

  revalidateEngagement(params.projectId);

  await logAction(
    createActivityLogEntry("complianceIssuedItemsRecorded", {
      projectId: params.projectId,
      engagementId: params.engagementId,
      assessor: params.assessor,
      requestedCount: outcome.created,
      rejectedCount: outcome.rejected,
      unmatched: outcome.unmatched,
    }),
  );

  await notifyCompliance("complianceDaItemsRequested", params.projectId, {
    requestedCount: outcome.created,
    rejectedCount: outcome.rejected,
  });

  return outcome;
}
