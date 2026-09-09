"use server";

import {
  ComplianceAlertSource,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  Prisma,
} from "@prisma/client";
import { revalidateTag } from "next/cache";

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
 * What a consent authority asks for after the application is lodged.
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
 * A label reduced to what is actually being compared.
 *
 * Same normalisation `comparableLabel` uses on the checklist, and for the same
 * reason: a council writing "Shadow Diagrams" in March and "shadow diagram" in
 * April is asking for one thing twice, and two rows would have somebody
 * commissioning it again.
 */
function comparable(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    // Crude, and enough for the job: the difference between "diagram" and
    // "diagrams" is not a difference in what is being asked for. Applied to
    // whole words only, so "address" does not become "addres".
    .replace(/\b(\w{4,}?)s\b/g, "$1");
}

/**
 * Every DA row a rejection could be about, with the names it might be called.
 *
 * Built from the fixed DA list plus whatever DA_ITEM rows exist, because a
 * council rejects both kinds: the stormwater drawings that went in with the
 * pack, and the shadow diagram they asked for in round two and did not like.
 */
async function rejectionCandidates(engagementId: string) {
  const rows = await prisma.complianceDocument.findMany({
    where: {
      engagementId,
      OR: [
        { documentType: ComplianceDocumentType.DA_ITEM },
        {
          documentType: {
            in: DA_DOCUMENTS.map((document) => document.type),
          },
        },
      ],
    },
    select: { id: true, documentType: true, label: true },
  });

  return rows.map((row) => ({
    ...row,
    // A DA item is known by the council's own wording; a typed row is known by
    // ours. Both are compared, because a council refusing "the hydraulic plans"
    // is refusing the row we call "Hydraulic/stormwater drawings & design
    // certificate" and neither name contains the other.
    names: [
      row.label ?? "",
      complianceDocumentLabel(row.documentType, row.label),
      row.documentType.replace(/_/g, " "),
    ]
      .map(comparable)
      .filter(Boolean),
  }));
}

/**
 * The row a council's objection is about, or null.
 *
 * Deliberately requires a real overlap rather than picking the closest match. A
 * rejection landing on the wrong row is worse than one landing on none: the row
 * it lands on goes back to outstanding with an objection that is not about it,
 * and the row it should have hit still reads as accepted. An unmatched
 * rejection is reported on the thread and in the notification, where somebody
 * can place it.
 *
 * Matching is on whole words shared between the council's name for the document
 * and ours, ignoring the words every document name contains.
 */
function matchRejection(
  documentName: string,
  candidates: Awaited<ReturnType<typeof rejectionCandidates>>,
): string | null {
  const wanted = comparable(documentName);
  if (!wanted) return null;

  // Substring either way first, which is what most of these are: "stormwater
  // drawings" against "hydraulic stormwater drawings and design certificate".
  for (const candidate of candidates) {
    if (
      candidate.names.some(
        (name) => name.includes(wanted) || wanted.includes(name),
      )
    ) {
      return candidate.id;
    }
  }

  // Otherwise a shared distinctive word. "the BASIX certificate" against a row
  // called "BASIX Certificate" is already caught above; this is for "amended
  // stormwater plan" against "hydraulic/stormwater drawings", where neither
  // contains the other and one word decides it.
  const wantedWords = new Set(
    wanted.split(" ").filter((word) => word.length > 3 && !GENERIC.has(word)),
  );
  if (wantedWords.size === 0) return null;

  for (const candidate of candidates) {
    for (const name of candidate.names) {
      const shared = name
        .split(" ")
        .filter((word) => wantedWords.has(word));
      if (shared.length > 0) {
        return candidate.id;
      }
    }
  }

  return null;
}

/**
 * Words that appear in half the document names on a compliance file.
 *
 * Excluded from the distinctive-word match because matching on one of them is
 * matching on nothing: a council refusing "the amended plan" would otherwise
 * land on whichever row happens to have "plan" in its name first.
 */
const GENERIC: ReadonlySet<string> = new Set([
  "plan",
  "plans",
  "drawing",
  "drawings",
  "certificate",
  "report",
  "document",
  "documents",
  "amended",
  "revised",
  "updated",
  "copy",
  "development",
  "application",
  "plane",
]);

export type DaCorrespondenceOutcome = {
  /** DA_ITEM rows written for things the council newly asked for. */
  created: number;
  /** Rejections landed on a row. */
  rejected: number;
  /** Rejections we could not place, with the council's own wording. */
  unmatched: string[];
};

/**
 * Records what a council's message asked for and what it sent back.
 *
 * Idempotent in both halves, which matters because a durable workflow retries
 * and because a council routinely re-sends the same letter. A request whose
 * wording already exists as a row is not written again, and a rejection whose
 * reason is already on the row it names changes nothing.
 */
export async function applyDaCorrespondence(params: {
  projectId: string;
  engagementId: string;
  requested: { label: string; description: string }[];
  rejected: { documentName: string; reason: string }[];
}): Promise<DaCorrespondenceOutcome> {
  const outcome: DaCorrespondenceOutcome = {
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
        documentType: ComplianceDocumentType.DA_ITEM,
      },
      select: { label: true, order: true },
      orderBy: { order: "desc" },
    });

    const seen = new Set(
      existing.map((row) => comparable(row.label ?? "")).filter(Boolean),
    );
    // Appended after whatever is there. Order is the order they were asked for,
    // which is the order somebody works through them in — a council's round
    // three sits under its round two rather than being interleaved by wording.
    let order = (existing[0]?.order ?? 0) + 1;

    for (const item of params.requested) {
      const key = comparable(item.label);
      if (!key || seen.has(key)) {
        // Already on the list. A council re-sending its request letter, or a
        // workflow retry, is the same request rather than a second one.
        continue;
      }
      seen.add(key);

      await prisma.complianceDocument.create({
        data: {
          engagementId: params.engagementId,
          documentType: ComplianceDocumentType.DA_ITEM,
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
    const candidates = await rejectionCandidates(params.engagementId);

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
          rejectedBySource: ComplianceAlertSource.COUNCIL,
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
    createActivityLogEntry("complianceDaItemsRecorded", {
      projectId: params.projectId,
      engagementId: params.engagementId,
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
