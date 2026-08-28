import {
  CertifierEngagementStatus,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
} from "@prisma/client";
import { getWritable, sleep } from "workflow";

import {
  buildChecklistExtractionPrompt,
  CHECKLIST_EXTRACTION_SYSTEM_PROMPT,
} from "@/lib/agent/checklist-extraction-prompts";
import { runChecklistExtraction } from "@/lib/agent/checklistExtractionAgent";
import { notifyCompliance } from "@/lib/compliance/notify";
import prisma from "@/lib/prisma";
import { ocrPagesToText, processPDFWithMistral } from "@/lib/ocr";
import { createActivityLogEntry } from "@/types/activityLog";
import {
  CHECKLIST_EXTRACTION_PROGRESS,
  COMPLIANCE_CHECKLIST_WORKFLOW,
  type ChecklistExtractionInput,
  type ChecklistExtractionResult,
  type ChecklistItem,
  type ChecklistStage,
  type ComplianceChecklistStreamEvent,
} from "@/types/compliance-workflow";
import { logAction } from "@/lib/data/actionLog";

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
 * A single createMany, which is why ComplianceDocument.order carries no unique
 * constraint: the whole set is written at once and never reordered, so paying
 * for the descending row-shift Milestone needs would buy nothing.
 *
 * Idempotent by deletion-then-insert inside a transaction, scoped to this
 * engagement's CHECKLIST_ITEM rows that nobody has uploaded against yet. A
 * retry after a write that landed but whose result was lost re-creates the same
 * set; an item that already has evidence on it is left alone rather than having
 * that evidence orphaned.
 */
async function saveChecklistItems(
  input: ChecklistExtractionInput,
  items: ChecklistItem[],
): Promise<number> {
  "use step";

  const saved = await prisma.$transaction(async (tx) => {
    await tx.complianceDocument.deleteMany({
      where: {
        engagementId: input.engagementId,
        documentType: ComplianceDocumentType.CHECKLIST_ITEM,
        status: ComplianceDocumentStatus.PENDING,
      },
    });

    const created = await tx.complianceDocument.createMany({
      data: items.map((item) => ({
        engagementId: input.engagementId,
        documentType: ComplianceDocumentType.CHECKLIST_ITEM,
        status: ComplianceDocumentStatus.PENDING,
        label: item.label,
        order: item.order,
      })),
    });

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

    return created.count;
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
    const saved = await saveChecklistItems(input, extraction.items);

    const result: ChecklistExtractionResult = {
      status: "success",
      items: extraction.items,
      message: `Extracted ${saved} checklist item${saved === 1 ? "" : "s"}.`,
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
