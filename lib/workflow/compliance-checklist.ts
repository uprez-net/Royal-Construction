import {
  CertifierEngagementStatus,
  ComplianceAlertSource,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  Prisma,
} from "@prisma/client";
import { getWritable, sleep } from "workflow";

import {
  buildChecklistExtractionPrompt,
  CHECKLIST_EXTRACTION_SYSTEM_PROMPT,
} from "@/lib/agent/checklist-extraction-prompts";
import {
  runChecklistExtraction,
  type ExtractedChecklistItem,
} from "@/lib/agent/checklistExtractionAgent";
import { detectComplianceAlerts } from "@/lib/agent/complianceAlertAgent";
import { raiseComplianceAlert } from "@/lib/data/compliance-alerts";
import { notifyCompliance } from "@/lib/compliance/notify";
import {
  mapExistingDocumentsOntoChecklist,
  type ChecklistMappingResult,
} from "@/lib/compliance/checklist-mapping";
import prisma from "@/lib/prisma";
import { ocrPagesToText, processPDFWithMistral } from "@/lib/ocr";
import { createActivityLogEntry } from "@/types/activityLog";
import {
  CHECKLIST_EXTRACTION_PROGRESS,
  COMPLIANCE_CHECKLIST_WORKFLOW,
  type ChecklistExtractionInput,
  type ChecklistExtractionResult,
  type ChecklistStage,
  type ComplianceChecklistStreamEvent,
} from "@/types/compliance-workflow";
import { logAction } from "@/lib/data/actionLog";
import {
  checklistItemDetail,
  type ChecklistDocumentDetail,
} from "@/types/compliance";

/**
 * Collapses case, punctuation and spacing so two wordings of the same item
 * compare equal.
 *
 * The fallback key when a checklist numbers nothing, so it has to survive the
 * differences a re-issued document picks up on its own — a dash becoming an
 * en dash, a double space, a changed capital.
 */
function comparableLabel(value: string): string {
  // HWI is the legacy name some certifiers still use for HBCF/home warranty
  // insurance. Treat the aliases as one stable identity when a checklist is
  // extracted again, while leaving the saved label in the certifier's own
  // words for the UI and audit trail.
  return value
    .toLowerCase()
    .replace(
      /\b(?:hwi|hbcf|home\s+building\s+compensation(?:\s+fund)?|home\s+warranty(?:\s+insurance)?)\b/g,
      "home warranty insurance",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:insurance\s+)+insurance\b/g, "insurance")
    .trim();
}

/**
 * Keeps the HBCF/HWI line connected to the project's existing HBCF source
 * document even when the extraction model does not set `mapsToType` itself.
 * The original label is intentionally untouched: it is evidence of what the
 * certifier actually asked for.
 */
function normalizeChecklistInsuranceAlias(
  item: ExtractedChecklistItem,
): ExtractedChecklistItem {
  const searchable = [
    item.label,
    item.detail?.description,
    ...(item.detail?.requirements ?? []),
    ...(item.detail?.references ?? []),
  ]
    .filter(Boolean)
    .join(" ");

  if (
    item.detail?.mapsToType ||
    !/\b(?:hwi|hbcf|home\s+building\s+compensation|home\s+warranty\s+insurance)\b/i.test(
      searchable,
    )
  ) {
    return item;
  }

  return {
    ...item,
    detail: {
      version: 1,
      ...item.detail,
      mapsToType: ComplianceDocumentType.HOME_INSURANCE,
    },
  };
}

// The wire contract lives in types/compliance-workflow.ts and is re-exported
// here so existing server-side imports keep working. It cannot live in this
// file: the modal that renders the progress needs those values at runtime, and
// importing them from here would pull prisma and the OCR client into the
// browser bundle.
export {
  CHECKLIST_EXTRACTION_PROGRESS,
  COMPLIANCE_CHECKLIST_WORKFLOW,
  type ChecklistExtractionInput,
  type ChecklistExtractionResult,
  type ChecklistItem,
  type ChecklistStage,
  type ComplianceChecklistStreamEvent,
} from "@/types/compliance-workflow";

// Matches the budget lib/workflow/project.ts gives the same OCR endpoint.
// processPDFWithMistral has no timeout of its own.
const OCR_TIMEOUT_MS = 75_000;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`${label} timed out after ${Math.ceil(timeoutMs / 1000)}s.`),
      );
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Steps — every side-effecting or non-deterministic operation (OCR, the model
// call, stream writes, the database) lives in a 'use step' function so it is
// checkpointed and replay-safe.
// ---------------------------------------------------------------------------

async function writeToStream(data: ComplianceChecklistStreamEvent) {
  "use step";
  // Stream operations must happen in steps.
  const writable = getWritable<ComplianceChecklistStreamEvent>();
  const writer = writable.getWriter();
  try {
    await writer.write(data);
  } finally {
    writer.releaseLock();
  }
}

async function closeWorkflowStream() {
  "use step";
  try {
    await getWritable<ComplianceChecklistStreamEvent>().close();
  } catch (error) {
    console.warn("Failed to close checklist workflow stream", error);
  }
}

/**
 * `emitStage` is not itself a step — the index is a deterministic lookup that
 * replays identically — it only delegates the write.
 */
async function emitStage(stage: ChecklistStage) {
  const index = CHECKLIST_EXTRACTION_PROGRESS.indexOf(stage);
  await writeToStream({
    workflow: COMPLIANCE_CHECKLIST_WORKFLOW,
    type: "stage",
    stage,
    index,
    total: CHECKLIST_EXTRACTION_PROGRESS.length,
  });
}

/**
 * Finds the checklist document's file.
 *
 * The url is read here rather than taken from the client: the request only
 * names a document id, so a caller cannot point the extraction at an arbitrary
 * document of their choosing.
 */
async function readChecklistDocument(documentId: string) {
  "use step";

  const document = await prisma.complianceDocument.findUnique({
    where: { id: documentId },
    include: { files: { orderBy: { createdAt: "asc" } } },
  });

  if (!document) {
    throw new Error(`Compliance document ${documentId} not found.`);
  }

  const file = document.files[0];
  if (!file) {
    throw new Error("The checklist document has no file attached to it.");
  }

  return { url: file.url, filename: file.filename };
}

async function ocrChecklist(url: string, label: string) {
  "use step";
  const pages = await withTimeout(
    processPDFWithMistral(url),
    OCR_TIMEOUT_MS,
    label,
  );
  return ocrPagesToText(pages);
}

async function extractItems(markdown: string) {
  "use step";
  return runChecklistExtraction({
    system: CHECKLIST_EXTRACTION_SYSTEM_PROMPT,
    prompt: buildChecklistExtractionPrompt(markdown),
  });
}

/**
 * Writes one tracked row per checklist item.
 *
 * Matches rather than replaces. The previous version deleted this engagement's
 * PENDING checklist rows and re-created the whole set, which left every item
 * that already had a file behind it standing beside a fresh empty twin — the
 * delete could not reach it, and the insert did not know it existed. So a second
 * run of the extraction quietly doubled half the checklist.
 *
 * Matching also buys the thing that makes re-extraction safe to offer at all: a
 * revised checklist can be read over the top of a live one without touching a
 * status, a rejection reason, or an uploaded file. Those three are the whole
 * record of work already done, and an extraction has no business rewriting them.
 *
 * Still one transaction and still idempotent — a retry after a write that landed
 * but whose result was lost matches every row it wrote the first time and
 * changes nothing.
 */
async function saveChecklistItems(
  input: ChecklistExtractionInput,
  items: ExtractedChecklistItem[],
  document: ChecklistDocumentDetail | null,
): Promise<number> {
  "use step";

  const saved = await prisma.$transaction(async (tx) => {
    const existing = await tx.complianceDocument.findMany({
      where: {
        engagementId: input.engagementId,
        documentType: ComplianceDocumentType.CHECKLIST_ITEM,
      },
      select: {
        id: true,
        label: true,
        status: true,
        detail: true,
        _count: { select: { files: true } },
      },
      orderBy: { order: "asc" },
    });

    // Claimed once each: two rows worded the same must not both match the same
    // extracted item and leave the other looking like it was dropped.
    const unclaimed = new Set(existing.map((row) => row.id));
    const claim = (id: string) => {
      unclaimed.delete(id);
      return id;
    };

    /**
     * Finds the row an extracted item is a new reading of.
     *
     * Clause first — "4a" is the certifier's own identifier for the line and it
     * survives a rewording, which is exactly the case where matching on text
     * fails. Normalised label second, for the checklists that number nothing.
     */
    const matchExisting = (item: ExtractedChecklistItem): string | null => {
      const clause = item.detail?.clause;
      if (clause) {
        const byClause = existing.find(
          (row) =>
            unclaimed.has(row.id) &&
            checklistItemDetail(row.detail)?.clause === clause,
        );
        if (byClause) return claim(byClause.id);
      }
      const wanted = comparableLabel(item.label);
      const byLabel = existing.find(
        (row) =>
          unclaimed.has(row.id) && comparableLabel(row.label ?? "") === wanted,
      );
      return byLabel ? claim(byLabel.id) : null;
    };

    for (const item of items.map(normalizeChecklistInsuranceAlias)) {
      const matchedId = matchExisting(item);
      const detail = (item.detail ?? null) as Prisma.InputJsonValue | null;

      if (matchedId) {
        await tx.complianceDocument.update({
          where: { id: matchedId },
          data: {
            label: item.label,
            order: item.order,
            detail: detail ?? Prisma.DbNull,
            // status, rejectionReason and files are deliberately absent. A
            // re-read of the checklist is not a verdict on work already done.
          },
        });
        continue;
      }

      await tx.complianceDocument.create({
        data: {
          engagementId: input.engagementId,
          documentType: ComplianceDocumentType.CHECKLIST_ITEM,
          status: ComplianceDocumentStatus.PENDING,
          label: item.label,
          order: item.order,
          detail: detail ?? Prisma.DbNull,
        },
      });
    }

    // Rows the revised checklist no longer lists. Only the untouched ones go:
    // anything carrying a file, or already settled one way or the other, is
    // evidence of work and outlives the line that asked for it.
    const removable = existing.filter(
      (row) =>
        unclaimed.has(row.id) &&
        row.status === ComplianceDocumentStatus.PENDING &&
        row._count.files === 0,
    );
    if (removable.length > 0) {
      await tx.complianceDocument.deleteMany({
        where: { id: { in: removable.map((row) => row.id) } },
      });
    }

    // What the document says about itself lives on the document's own row —
    // the same row the extraction was run against, so a revised checklist
    // overwrites it in the step that rewrites the items.
    if (document) {
      await tx.complianceDocument.update({
        where: { id: input.documentId },
        data: { detail: document as unknown as Prisma.InputJsonValue },
      });
    }

    await tx.certifierEngagement.updateMany({
      where: {
        id: input.engagementId,
        status: {
          in: [
            CertifierEngagementStatus.RESPONSE_RECEIVED,
            CertifierEngagementStatus.SIGNING,
            CertifierEngagementStatus.CHECKLIST_EXTRACTING,
          ],
        },
      },
      data: { status: CertifierEngagementStatus.CHECKLIST_TRACKING },
    });

    return items.length;
  });

  await logAction(
    createActivityLogEntry("checklistExtracted", {
      projectId: input.projectId,
      engagementId: input.engagementId,
      itemCount: saved,
    }),
  );

  // The admin who pressed "Get Checklist" is watching the modal, but the site
  // manager who has to supply the documents is not — this is the first they
  // hear that the work exists.
  await notifyCompliance("complianceChecklistExtracted", input.projectId, {
    itemCount: saved,
  });

  return saved;
}

/**
 * Answers the lines the file already holds documents for.
 *
 * Its own step, after the rows exist and outside their transaction, because the
 * two are different kinds of work with different failure costs. Writing the
 * checklist is the thing the admin asked for and must be all-or-nothing;
 * mapping is a convenience over the top of it, and a checklist that lands
 * unmapped is a checklist somebody fills in the way they did last week.
 *
 * Its own step also means a retry re-runs only the mapping. The mapper is
 * idempotent three ways over precisely so that is safe — see
 * `mapExistingDocumentsOntoChecklist`.
 */
async function mapCollectedDocuments(
  input: ChecklistExtractionInput,
): Promise<ChecklistMappingResult> {
  "use step";

  const result = await mapExistingDocumentsOntoChecklist({
    engagementId: input.engagementId,
    projectId: input.projectId,
  });

  if (result.mapped > 0) {
    await logAction(
      createActivityLogEntry("complianceChecklistMapped", {
        projectId: input.projectId,
        engagementId: input.engagementId,
        mappedCount: result.mapped,
        documentTypes: result.documentTypes,
      }),
    );
  }

  return result;
}

/**
 * Reads the checklist itself for a job that cannot go through as a CDC.
 *
 * The certifier is the one who decides this, and the checklist is very often
 * where they say it first — they look at the plans, conclude the proposal
 * misses a complying-development standard, and write so at the top of the
 * document they were producing anyway. Until now nothing read that: the
 * condition was only ever picked up off a reply on the thread, so a job whose
 * certifier said it in the checklist collected twenty documents for an
 * assessment that was never going to start.
 *
 * The same agent that reads the mail threads, told it is reading a document.
 * One set of rules for one condition, rather than a second prompt that could
 * come to disagree with the first about what "needs a DA" sounds like.
 *
 * Never throws. It runs after the checklist has been written, and a model call
 * that times out must not cost the twenty rows that already landed — the
 * condition is still readable on the document itself, and an admin can raise
 * the alert by hand.
 */
async function detectDevelopmentApproval(
  input: ChecklistExtractionInput,
  markdown: string,
): Promise<number> {
  "use step";

  try {
    const detected = await detectComplianceAlerts({
      source: ComplianceAlertSource.CERTIFIER,
      subject: "Certifier checklist",
      body: markdown,
      kind: "document",
    });

    let raised = 0;
    for (const alert of detected) {
      const result = await raiseComplianceAlert({
        projectId: input.projectId,
        engagementId: input.engagementId,
        type: alert.type,
        raisedBySource: ComplianceAlertSource.CERTIFIER,
        detail: alert.detail,
      });
      // Only a new one counts. A re-extraction of the same checklist says the
      // same thing, and `raiseComplianceAlert` collapses it onto the row that
      // is already open.
      if (result.created) raised += 1;
    }
    return raised;
  } catch (error) {
    console.error(
      "  Failed to read the checklist for a DA requirement:",
      error,
    );
    return 0;
  }
}

async function failWorkflow(message: string) {
  "use step";
  try {
    console.error(`Checklist extraction failed: ${message}`);
    const writable = getWritable<ComplianceChecklistStreamEvent>();
    const writer = writable.getWriter();
    try {
      await writer.write({
        workflow: COMPLIANCE_CHECKLIST_WORKFLOW,
        type: "error",
        message,
      });
    } finally {
      writer.releaseLock();
    }
  } catch (error) {
    console.error("Error reporting checklist workflow failure:", error);
  }
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

/**
 * Turns the certifier's checklist document into tracked, uploadable items.
 *
 * A workflow rather than a request because it is two slow calls back to back —
 * OCR over a scanned checklist and a structured model call over the result —
 * either of which can outlive a serverless invocation on a bad day. Running it
 * durably means a rate-limited model call costs a retry rather than making the
 * admin re-request the whole thing, and the progress the modal shows survives a
 * dropped connection because it is replayed from the run's stream.
 */
export const extractComplianceChecklist = async (
  input: ChecklistExtractionInput,
): Promise<ChecklistExtractionResult> => {
  "use workflow";

  try {
    await emitStage("Reading checklist");
    const document = await readChecklistDocument(input.documentId);
    const markdown = await ocrChecklist(
      document.url,
      `Checklist OCR (${document.filename})`,
    );

    if (!markdown.trim()) {
      const result: ChecklistExtractionResult = {
        status: "error",
        items: [],
        message: "The checklist was read, but produced no readable text.",
        error: "Unable to read the checklist document.",
      };
      await writeToStream({
        workflow: COMPLIANCE_CHECKLIST_WORKFLOW,
        type: "result",
        result,
      });
      await sleep(2000);
      await closeWorkflowStream();
      return result;
    }

    await emitStage("Extracting items");
    const extraction = await extractItems(markdown);

    if (extraction.items.length === 0) {
      const result: ChecklistExtractionResult = {
        status: "error",
        items: [],
        message: extraction.message,
        error: "No checklist items could be read from the document.",
      };
      await writeToStream({
        workflow: COMPLIANCE_CHECKLIST_WORKFLOW,
        type: "result",
        result,
      });
      await sleep(2000);
      await closeWorkflowStream();
      return result;
    }

    await emitStage("Saving checklist");
    const saved = await saveChecklistItems(
      input,
      extraction.items,
      extraction.document,
    );

    // Before the mapping, because it changes what the file is for. A checklist
    // that says the job needs development approval freezes the very rows the
    // mapping is about to fill — they are still worth filling, since the DA
    // wants most of them too, but the reader has to see the condition first
    // rather than discover it under a list that has gone read-only.
    await detectDevelopmentApproval(input, markdown);

    await emitStage("Matching what we already hold");
    const mapping = await mapCollectedDocuments(input);

    // Said out loud rather than left to be noticed. Six lines answering
    // themselves is the single most surprising thing this workflow does, and an
    // admin who opens the checklist expecting twenty empty rows and finds
    // fourteen needs to be told why before they conclude something went wrong.
    const message =
      mapping.mapped > 0
        ? `Extracted ${saved} checklist item${saved === 1 ? "" : "s"}, and answered ${mapping.mapped} of them from documents already on the file.`
        : `Extracted ${saved} checklist item${saved === 1 ? "" : "s"}.`;

    const result: ChecklistExtractionResult = {
      status: "success",
      items: extraction.items,
      message,
    };

    await writeToStream({
      workflow: COMPLIANCE_CHECKLIST_WORKFLOW,
      type: "result",
      result,
    });
    await sleep(2000);
    await closeWorkflowStream();
    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Checklist extraction failed.";
    await failWorkflow(message);
    // Give the client time to receive the error before the stream closes.
    await sleep(5000);
    await closeWorkflowStream();
    throw new Error(`Failed to extract the certifier checklist: ${message}`);
  }
};
