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
import { normalizeFileTags } from "@/lib/domain/file-tags";
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
function copiedFileId(
  checklistDocumentId: string,
  sourceFileId: string,
): string {
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
    [
      "signed",
      "identification",
      "detail",
      "contour",
      "report",
      "plan",
      "level",
    ],
  ],
  [ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN]: [
    ["architectural", "architect"],
    ["drawing", "plan", "design", "documentation", "set"],
  ],
  [ComplianceDocumentType.PLANNING_CERTIFICATE_10_7]: [
    ["10.7", "10-7", "planning certificate", "section 149"],
  ],
  [ComplianceDocumentType.HOME_INSURANCE]: [
    ["hwi", "hbcf", "home warranty", "home building compensation", "insurance"],
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
    [
      "bushfire",
      "bush fire",
      "bal risk",
      "bal rating",
      "bal report",
      "bal assessment",
      "attack level",
    ],
  ],
  [ComplianceDocumentType.STRUCTURAL_DRAWINGS]: [
    ["structural"],
    ["drawing", "plan", "design", "certificate", "detail", "engineer"],
  ],
  [ComplianceDocumentType.HYDRAULIC_STORMWATER_DRAWINGS]: [
    [
      "hydraulic",
      "stormwater",
      "storm water",
      "drainage",
      "on-site detention",
      "osd",
    ],
  ],
  [ComplianceDocumentType.GEOTECH_REPORT]: [
    [
      "geotech",
      "geotechnical",
      "soil classification",
      "soil report",
      "site classification",
    ],
  ],
  [ComplianceDocumentType.WATER_SERVICING_APPROVAL]: [
    [
      "tap in",
      "tap-in",
      "water servicing",
      "servicing coordinator",
      "sydney water approval",
    ],
  ],
  [ComplianceDocumentType.SECTION_73_NOTICE]: [
    ["section 73", "s73", "notice of requirements"],
  ],
  [ComplianceDocumentType.ROAD_OPENING_PERMIT]: [
    [
      "road opening",
      "vehicle crossing",
      "driveway crossing",
      "kerb and gutter",
      "footpath crossing",
    ],
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
    if (
      groups.every((alternatives) =>
        alternatives.some((term) => text.includes(term)),
      )
    ) {
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

/**
 * A document to copy from, reduced to what copying needs.
 *
 * Structural rather than the Prisma row, because one of the sources is not a
 * compliance document at all: the HBCF certificate can be sitting on the
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
  tags?: readonly string[];
  origin?: string | null;
};
type SourceDocument = { id: string | null; files: SourceFile[] };

/** A checklist row, reduced to what deciding about it needs. */
type TargetLine = {
  id: string;
  files: { id: string; url: string }[];
  mappedFromDocumentId: string | null;
  mappedFromProject: boolean;
};

/**
 * Whether the copy on this line is one the mapper made.
 *
 * The question both guards below are actually asking, and it has two answers
 * because a source is one of two things: a document on the compliance file,
 * which leaves an id, and the project's own HBCF certificate, which has no
 * compliance row to point at and leaves the boolean instead.
 *
 * Reading the id alone was the bug. An HBCF line mapped from the project had
 * `mappedFromDocumentId` null, so every pass after the first read it as a line
 * somebody had filled in by hand and left it alone -- and a certificate
 * replaced on the project left the superseded copy on the checklist for good,
 * which is the copy that then went to the certifier.
 *
 * Exported for the tests, which is the only part of this decision that can be
 * pinned without a database. Structural rather than taking a `TargetLine`, so a
 * test does not have to build a row to ask a question about two fields.
 */
export function isMappedCopy(line: {
  mappedFromDocumentId: string | null;
  mappedFromProject: boolean;
}): boolean {
  return line.mappedFromDocumentId !== null || line.mappedFromProject;
}

/**
 * Puts one document's files onto one checklist line, or leaves it alone.
 *
 * Returns whether anything was written, which is what the caller counts.
 *
 * Three cases, and the third is the one that earns this its own function. A
 * line with nothing on it is filled. A line already carrying a copy of these
 * exact files is left alone, which is what a replayed step and a re-extraction
 * both look like. A line carrying a copy of a document that has since been
 * *replaced* — somebody uploaded a corrected survey onto the pack row — is
 * refreshed, because the old copy points at a blob the replacement deleted and
 * the certifier would otherwise be sent a dead link to last month's survey.
 */
/**
 * What copying one document onto one line would change, or null for nothing.
 *
 * The decision half, split out from the write for the reason
 * `assessOverdueConditions` is split from the sweep that runs it: everything
 * here is a comparison between two sets of file ids and a flag, none of it needs
 * a database, and the cases that matter — a replaced source, a line that already
 * holds exactly this, which provenance mark to set — are then pinned by tests
 * rather than argued about.
 *
 * Returning null rather than an empty plan, because "nothing to do" is the
 * common answer on a replayed step and a re-extraction, and the caller counts
 * what it actually wrote.
 */
export function planChecklistCopy(
  line: TargetLine,
  source: SourceDocument,
): {
  /** Copies this line holds that the source no longer accounts for. */
  staleFileIds: string[];
  /** The File rows to write, ids already derived. */
  createFileIds: string[];
  mappedFromDocumentId: string | null;
  mappedFromProject: boolean;
} | null {
  const wanted = source.files.map((file) => copiedFileId(line.id, file.id));
  const held = new Set(line.files.map((file) => file.id));

  // Already holds exactly this. Compared by the derived id rather than by the
  // source document, so a replacement — which produces different file ids — is
  // correctly read as something new even though it came from the same row.
  if (wanted.length === held.size && wanted.every((id) => held.has(id))) {
    return null;
  }

  return {
    staleFileIds: line.files
      .filter((file) => !wanted.includes(file.id))
      .map((file) => file.id),
    createFileIds: wanted,
    mappedFromDocumentId: source.id,
    // The other half of the provenance, and the only one the HBCF case has.
    // Derived from the absence of a source id rather than passed in, so the two
    // cannot disagree about where one copy came from.
    mappedFromProject: source.id === null,
  };
}

async function copyOntoChecklistLine(
  line: TargetLine,
  source: SourceDocument,
): Promise<boolean> {
  const plan = planChecklistCopy(line, source);
  if (!plan) return false;

  const stale = plan.staleFileIds;

  await prisma.$transaction(async (tx) => {
    // The copies this line used to hold. Deleted rather than left beside the
    // new ones, because a checklist line holds one document rather than a pile
    // of attempts at it — the same rule `placeConsultantDeliverable` follows.
    //
    // Only the File rows go. The blobs behind them are shared with the pack row
    // this was copied from, and `discardSupersededFiles` is what decides when
    // one is genuinely unreferenced.
    if (stale.length > 0) {
      await tx.file.deleteMany({ where: { id: { in: stale } } });
    }

    await tx.file.createMany({
      data: source.files.map((file) => ({
        id: copiedFileId(line.id, file.id),
        // The blob is shared, and everything else about the row is a copy.
        // `uploadedBy` in particular: the person who put the survey on the file
        // is the person this document came from, and attributing the copy to
        // whoever happened to run the extraction would be a worse answer than
        // the true one.
        uploadedBy: file.uploadedBy,
        projectId: file.projectId,
        complianceDocumentId: line.id,
        url: file.url,
        filename: file.filename,
        fileType: file.fileType,
        filesize: file.filesize,
        // Where the original came from stays true of the copy; that it now
        // also answers a checklist line is the new fact.
        tags: normalizeFileTags(file.tags, ["Compliance", "Checklist"]),
        origin: file.origin ?? null,
      })),
      // The replay guard. A step that ran, wrote its rows and then lost its
      // result finds them already here.
      skipDuplicates: true,
    });

    await tx.complianceDocument.update({
      where: { id: line.id },
      data: {
        // UPLOADED rather than RECEIVED: this document is on the file because a
        // person put it there, which is what UPLOADED means. That it was a
        // person weeks ago rather than a person just now is what
        // `mappedFromDocumentId` records.
        status: ComplianceDocumentStatus.UPLOADED,
        rejectionReason: null,
        mappedFromDocumentId: plan.mappedFromDocumentId,
        mappedFromProject: plan.mappedFromProject,
      },
    });
  });

  return true;
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
      // A line somebody filled in by hand is not improved by a second opinion.
      // A line carrying a *mapped* copy is a different matter and is handled in
      // `copyOntoChecklistLine`, because the document it copied may since have
      // been replaced.
      if (item.files.length > 0 && !isMappedCopy(item)) continue;

      const wanted = checklistDocumentType(item);
      if (!isChecklistMappableType(wanted)) continue;

      const source = sources.get(wanted!);
      if (!source || source.id === item.id) continue;

      const copied = await copyOntoChecklistLine(item, source);
      if (copied) mapped.push(wanted!);
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

/**
 * Fills the checklist lines asking for one document that has just landed.
 *
 * The same copy as the extraction-time pass, triggered by an upload instead of
 * by a checklist being read. Two things made it necessary.
 *
 * The first is ordering. The extraction maps what the file holds *at that
 * moment*, and half of what a checklist asks for arrives afterwards — a
 * geotechnical report three weeks later, a levy receipt the day it is paid.
 * Without this, every one of those had to be uploaded a second time against its
 * checklist row, which is the problem the mapping exists to solve, arriving a
 * fortnight late.
 *
 * The second is the development application. A DA and a CDC are assessed on
 * very nearly the same evidence, so most of the DA list is also a line on the
 * certifier's checklist — and the two run side by side rather than one after
 * the other. A structural drawing supplied for the DA is the same drawing the
 * certifier asked for, and asking for it twice is asking the same question
 * twice.
 *
 * Deliberately one-directional. A document filed under its type fills the
 * checklist lines asking for it; a document uploaded onto a checklist line does
 * not create a typed row. The checklist is the certifier's own wording and its
 * rows exist because they asked — a line answered by hand is evidence for that
 * assessment and nothing more, and inventing a typed document from it would put
 * a row on the DA list that nobody chose to collect there.
 *
 * Never throws, for the reason the whole module does not: it runs behind an
 * upload that has already succeeded, and a line left unmapped is a line
 * somebody fills in the way they did last week.
 */
export async function fillChecklistLinesFor(params: {
  engagementId: string;
  documentType: ComplianceDocumentType;
}): Promise<ChecklistMappingResult> {
  const empty: ChecklistMappingResult = { mapped: 0, documentTypes: [] };
  if (!isChecklistMappableType(params.documentType)) return empty;

  try {
    const documents = await prisma.complianceDocument.findMany({
      where: {
        engagementId: params.engagementId,
        documentType: {
          in: [params.documentType, ComplianceDocumentType.CHECKLIST_ITEM],
        },
      },
      include: { files: { orderBy: { createdAt: "asc" } } },
      orderBy: { order: "asc" },
    });

    // The row every other part of the tab reads this category by: the first of
    // its type in `order`. A category holding two rows is what
    // `placeInboundDocument` exists to prevent, and reading the first here
    // keeps this agreeing with the rest of the tab if one ever slips through.
    const source = documents.find(
      (document) =>
        document.documentType === params.documentType &&
        document.files.length > 0,
    );
    if (!source) return empty;

    let mapped = 0;
    for (const item of documents) {
      if (item.documentType !== ComplianceDocumentType.CHECKLIST_ITEM) continue;
      // Filled in by hand. Only a mapped copy is ours to refresh.
      if (item.files.length > 0 && !isMappedCopy(item)) continue;
      if (checklistDocumentType(item) !== params.documentType) continue;

      if (await copyOntoChecklistLine(item, source)) mapped += 1;
    }

    return {
      mapped,
      documentTypes: mapped > 0 ? [params.documentType] : [],
    };
  } catch (error) {
    console.error(
      `Could not fill checklist lines for ${params.documentType} on engagement ${params.engagementId}`,
      error,
    );
    return empty;
  }
}
