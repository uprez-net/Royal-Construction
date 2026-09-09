import { createHash } from "node:crypto";

import {
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  Prisma,
} from "@prisma/client";

import {
  isChecklistMappableType,
  MAPPABLE_DOCUMENT_TYPES,
} from "@/constants/complianceDocuments";
import prisma from "@/lib/prisma";
import { checklistItemDetail } from "@/types/compliance";

/**
 * Answering a certifier's checklist from documents the file already holds.
 *
 * A checklist runs to twenty lines and around six of them are things collected
 * weeks earlier: the deposited plan, the title search, the survey, the
 * architectural set, the 10.7 certificate, the HBCF warranty. Every one of
 * those went to the certifier in the required pack, and every one of them was
 * then asked for again — so an admin opened the checklist, recognised six lines
 * as documents sitting inches up the same screen, and uploaded each of them a
 * second time. That is six file pickers, six waits, and six chances to attach
 * the wrong version of a plan set.
 *
 * So the extraction now finishes by looking. Each line that names a type the
 * file already holds gets that document copied onto it, marked with where it
 * came from, and the admin arrives at a checklist with the easy third already
 * done.
 *
 * Two decisions worth stating, because both were the other way at first.
 *
 * The file is copied rather than moved. A `File` belongs to exactly one
 * `ComplianceDocument`, so moving one would strip the survey off the surveyor's
 * row to answer a checklist line about it — the pack row would empty, the
 * progress count would fall, and the certifier's own send would start claiming
 * a document was missing. The copy is a second File row against the same blob,
 * which leaves every count, every send and every replacement path working
 * unchanged on both rows. `discardSupersededFiles` is what makes that safe: it
 * refuses to reclaim a blob another row still points at.
 *
 * And the mapping is applied rather than suggested. A row offering "we already
 * hold this — use it?" is a click per line on every job, to confirm something
 * the system is confident about and the reader can see for themselves; the
 * provenance line on the mapped row plus a control that replaces it is the same
 * information without the ceremony.
 */

/**
 * A file id derived from the row it is being copied onto and the file it copies.
 *
 * The same trick the inbound attachment path uses, for the same reason: this
 * runs inside a durable workflow step that can be replayed, and a random id
 * would mean a second File row against the same blob on the same checklist line
 * every time the step ran again.
 */
function copiedFileId(checklistDocumentId: string, sourceFileId: string): string {
  const digest = createHash("sha256")
    .update(`checklist-map:${checklistDocumentId}:file:${sourceFileId}`)
    .digest("hex");

  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join("-");
}

/**
 * Words that put a checklist line onto a document type, when the model did not.
 *
 * The extraction is asked to set `mapsToType` and is good at it, but it is a
 * model reading a scan and it is told — correctly — never to force a match. So
 * a line it left unlabelled is common, and every unlabelled line is a document
 * the file may already hold and an admin re-uploads anyway.
 *
 * This is the cheap second pass. Each entry is an AND of ORs in the shape the
 * discovery route's filename hints use: the alternatives inside one array are
 * interchangeable, and every array has to hit somewhere in the line. That
 * structure is what stops "preliminary architectural plans" answering the line
 * asking for the full set, and stops "stormwater plan" satisfying anything
 * about architectural plans.
 *
 * Deliberately conservative on the six mappable types and deliberately generous
 * on the rest, because the two mistakes cost different amounts. A wrong mapping
 * puts a document on a line the certifier will reject; a wrong consultant
 * suggestion puts a button on a row that somebody does not press.
 */
const LABEL_HINTS: Partial<Record<ComplianceDocumentType, string[][]>> = {
  [ComplianceDocumentType.DEPOSITED_PLAN]: [["deposited plan"]],
  [ComplianceDocumentType.TITLE_SEARCH_DETAIL_AND_LEVEL]: [
    ["title search", "title detail", "certificate of title", "folio"],
  ],
  [ComplianceDocumentType.SURVEY]: [
    ["survey"],
    ["signed", "identification", "detail", "contour", "report", "plan", "level"],
  ],
  [ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN]: [
    ["architectural", "architect"],
    ["drawing", "plan", "design", "documentation", "set"],
  ],
  [ComplianceDocumentType.PLANNING_CERTIFICATE_10_7]: [
    ["10.7", "10-7", "planning certificate", "section 149"],
  ],
  [ComplianceDocumentType.HOME_INSURANCE]: [
    ["hbcf", "home warranty", "home building compensation", "insurance"],
  ],

  // The consultants' and the portals' work. Labelled here so an unlabelled line
  // still offers the control that gets the document, which is the whole value
  // of naming a type at all.
  [ComplianceDocumentType.BASIX_CERTIFICATE]: [
    ["basix", "nathers", "thermal performance"],
  ],
  // The wording that prompted this pass. A certifier writes "BAL Risk
  // Assessment Certificate", or "Bushfire Certificate", far more often than
  // "bushfire attack level report" — and a line reading "BAL Risk Assessment
  // Certificate (Bushfire Certificate)" was landing unlabelled, so the row that
  // should have offered to ring a bushfire assessor offered an Upload button
  // and nothing else.
  [ComplianceDocumentType.BUSHFIRE_REPORT]: [
    ["bushfire", "bush fire", "bal risk", "bal rating", "bal report", "bal assessment", "attack level"],
  ],
  [ComplianceDocumentType.STRUCTURAL_DRAWINGS]: [
    ["structural"],
    ["drawing", "plan", "design", "certificate", "detail", "engineer"],
  ],
  [ComplianceDocumentType.HYDRAULIC_STORMWATER_DRAWINGS]: [
    ["hydraulic", "stormwater", "storm water", "drainage", "on-site detention", "osd"],
  ],
  [ComplianceDocumentType.GEOTECH_REPORT]: [
    ["geotech", "geotechnical", "soil classification", "soil report", "site classification"],
  ],
  [ComplianceDocumentType.WATER_SERVICING_APPROVAL]: [
    ["tap in", "tap-in", "water servicing", "servicing coordinator", "sydney water approval"],
  ],
  [ComplianceDocumentType.SECTION_73_NOTICE]: [
    ["section 73", "s73", "notice of requirements"],
  ],
  [ComplianceDocumentType.ROAD_OPENING_PERMIT]: [
    ["road opening", "vehicle crossing", "driveway crossing", "kerb and gutter", "footpath crossing"],
  ],
  [ComplianceDocumentType.LONG_SERVICE_LEVY]: [["long service"]],
  [ComplianceDocumentType.MINE_SUBSIDENCE_APPROVAL]: [
    ["mine subsidence", "subsidence advisory"],
  ],
  [ComplianceDocumentType.WASTE_MANAGEMENT_PLAN]: [
    ["waste"],
    ["management", "plan", "minimisation"],
  ],
  [ComplianceDocumentType.TRAFFIC_CONTROL_PLAN]: [
    ["traffic"],
    ["control", "management", "plan"],
  ],
  [ComplianceDocumentType.BUILD_COST_SUMMARY]: [
    ["cost"],
    ["summary", "estimate", "breakdown", "genuine estimate", "works"],
  ],
  [ComplianceDocumentType.OWNER_CONSENT_FORM]: [["owner"], ["consent"]],
};

/**
 * The document type a checklist line is asking for.
 *
 * The extraction's answer where it gave one, and the keyword pass above where
 * it did not. In that order deliberately: the model has read the whole line
 * with its description and its requirements, and this has read a string.
 *
 * `text` is the label and the description together, because the description is
 * routinely where the identifying word is — "Long Service Levy" says nothing on
 * its own, and the sentence under it names the Long Service Payments
 * Corporation and the 0.25%.
 */
export function checklistDocumentType(item: {
  label: string | null;
  detail: Prisma.JsonValue;
}): ComplianceDocumentType | null {
  const detail = checklistItemDetail(item.detail);
  if (detail?.mapsToType) {
    return detail.mapsToType;
  }

  const text = [item.label, detail?.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!text.trim()) return null;

  // Ordered by the enum's own order rather than by score. A line that matches
  // two entries is a line whose wording is genuinely ambiguous, and the
  // alternative — picking whichever matched more words — is a rule nobody
  // reading the table could predict.
  for (const type of MAPPABLE_DOCUMENT_TYPES) {
    const groups = LABEL_HINTS[type];
    if (!groups?.length) continue;
    if (groups.every((alternatives) => alternatives.some((term) => text.includes(term)))) {
      return type;
    }
  }

  return null;
}

/**
 * The HBCF certificate the project holds, as a File row, or null.
 *
 * Read through the project's requirements blob rather than by looking for a
 * File with a likely name, because the blob is where the Overview tab records
 * which certificate the recorded HBCF number was read off — that reference is
 * the authoritative answer, and a filename search is a guess.
 *
 * Returns the File row rather than the reference, because the copy needs a
 * size and a content type that the four-field reference does not carry.
 */
async function projectHbcfFile(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { requirements: true },
  });

  const requirements = (project?.requirements ?? {}) as Record<string, unknown>;
  const legal = (requirements.legalAdministration ?? {}) as Record<
    string,
    unknown
  >;
  const reference = legal.hbcfInsuranceDocument as
    | { fileId?: unknown }
    | null
    | undefined;
  const fileId =
    reference && typeof reference.fileId === "string" ? reference.fileId : null;
  if (!fileId) return null;

  return prisma.file.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      url: true,
      filename: true,
      fileType: true,
      filesize: true,
      uploadedBy: true,
      projectId: true,
    },
  });
}

/** What one pass of the mapper did, for the log entry and the modal's copy. */
export type ChecklistMappingResult = {
  mapped: number;
  documentTypes: ComplianceDocumentType[];
};

/**
 * Copies the documents the file already holds onto the checklist lines asking
 * for them.
 *
 * Idempotent in three separate ways, because it runs from a durable workflow
 * step that replays and from a re-extraction an admin can trigger by hand:
 * a line that already has a file is skipped, a line already mapped from the
 * same document is skipped, and the copied File row's id is derived from the
 * pair so a retry writes the row it wrote last time.
 *
 * Never throws. It runs at the tail of an extraction that has already written
 * the checklist, and a checklist that lands unmapped is a checklist an admin
 * fills in the old way — which is where they were yesterday. Failing the
 * extraction over it would throw away the twenty rows to save the six.
 */
export async function mapExistingDocumentsOntoChecklist(params: {
  engagementId: string;
  /** The HBCF certificate on the project, where the engagement has none. */
  projectId: string;
}): Promise<ChecklistMappingResult> {
  const empty: ChecklistMappingResult = { mapped: 0, documentTypes: [] };

  try {
    const documents = await prisma.complianceDocument.findMany({
      where: { engagementId: params.engagementId },
      include: { files: { orderBy: { createdAt: "asc" } } },
      orderBy: { order: "asc" },
    });

    const checklistItems = documents.filter(
      (document) =>
        document.documentType === ComplianceDocumentType.CHECKLIST_ITEM,
    );
    if (checklistItems.length === 0) return empty;

    /**
     * The document holding each mappable type, where one has a file.
     *
     * The first row of that type in `order`, which is the row every other part
     * of the tab reads a category by. A category holding two rows is what
     * `placeInboundDocument` exists to prevent, and reading the first here
     * keeps this agreeing with the rest of the tab if one ever slips through.
     */
    /**
     * A document to copy from, reduced to what copying needs.
     *
     * Structural rather than the Prisma row, because one of the sources is not
     * a compliance document at all: the HBCF certificate can be sitting on the
     * project with no engagement row behind it, and a type that insisted on a
     * document id could not describe it.
     */
    type SourceFile = {
      id: string;
      url: string;
      filename: string;
      fileType: string;
      filesize: number;
      uploadedBy: string;
      projectId: string | null;
    };
    type SourceDocument = { id: string | null; files: SourceFile[] };

    const sources = new Map<ComplianceDocumentType, SourceDocument>();
    for (const document of documents) {
      if (!isChecklistMappableType(document.documentType)) continue;
      if (document.files.length === 0) continue;
      if (!sources.has(document.documentType)) {
        sources.set(document.documentType, document);
      }
    }

    // The HBCF certificate, where the engagement has no row for it.
    //
    // The one mappable document that does not have to be on the compliance file
    // at all. Cover is raised on the Overview tab long before a certifier is
    // engaged and lands in the project's own requirements, and a job that did
    // it in that order arrives at a checklist line asking for the warranty with
    // an engagement holding nothing — while the certificate sits two tabs away.
    // The compliance upload already syncs the other direction
    // (`recordHomeInsuranceOnProject`); this is that road read backwards.
    if (!sources.has(ComplianceDocumentType.HOME_INSURANCE)) {
      const held = await projectHbcfFile(params.projectId);
      if (held) {
        // A null id, because there is no compliance document behind it. The row
        // still records that it was mapped — `mappedFromDocumentId` stays null,
        // which reads as "from the project" rather than "from a pack row", and
        // the provenance line says so.
        sources.set(ComplianceDocumentType.HOME_INSURANCE, {
          id: null,
          files: [held],
        });
      }
    }

    const mapped: ComplianceDocumentType[] = [];

    for (const item of checklistItems) {
      // Already answered, one way or another. A line carrying a file is not
      // improved by a second opinion, and a line somebody has already mapped
      // is what a replay of this step looks like.
      if (item.files.length > 0) continue;

      const wanted = checklistDocumentType(item);
      if (!isChecklistMappableType(wanted)) continue;

      const source = sources.get(wanted!);
      if (!source || source.id === item.id) continue;
      // Already mapped from this document. Null-safe on both sides: the HBCF
      // certificate read off the project has no source row, so a row mapped
      // from it is caught by the files check above rather than by this one.
      if (source.id !== null && item.mappedFromDocumentId === source.id) {
        continue;
      }

      await prisma.$transaction(async (tx) => {
        await tx.file.createMany({
          data: source.files.map((file) => ({
            id: copiedFileId(item.id, file.id),
            // The blob is shared, and everything else about the row is a copy.
            // `uploadedBy` in particular: the person who put the survey on the
            // file is the person this document came from, and attributing the
            // copy to whoever happened to run the extraction would be a worse
            // answer than the true one.
            uploadedBy: file.uploadedBy,
            projectId: file.projectId,
            complianceDocumentId: item.id,
            url: file.url,
            filename: file.filename,
            fileType: file.fileType,
            filesize: file.filesize,
          })),
          // The replay guard. A step that ran, wrote its rows and then lost its
          // result finds them already here.
          skipDuplicates: true,
        });

        await tx.complianceDocument.update({
          where: { id: item.id },
          data: {
            // UPLOADED rather than RECEIVED: this document is on the file
            // because a person put it there, which is what UPLOADED means. That
            // it was a person weeks ago rather than a person just now is what
            // `mappedFromDocumentId` records.
            status: ComplianceDocumentStatus.UPLOADED,
            rejectionReason: null,
            mappedFromDocumentId: source.id,
          },
        });
      });

      mapped.push(wanted!);
    }

    return { mapped: mapped.length, documentTypes: [...new Set(mapped)] };
  } catch (error) {
    console.error(
      `Could not map existing documents onto the checklist for engagement ${params.engagementId}`,
      error,
    );
    return empty;
  }
}
