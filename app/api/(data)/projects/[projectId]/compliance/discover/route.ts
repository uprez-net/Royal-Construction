import {
  ComplianceDocumentStatus,
  ComplianceDocumentType,
} from "@prisma/client";
import { NextRequest } from "next/server";

import { complianceDocumentLabel } from "@/constants/complianceDocuments";
import { classifyDocumentAtUrl } from "@/lib/agent/documentClassifierAgent";
import {
  complianceAccessResponse,
  requireComplianceMutation,
} from "@/lib/compliance/access";
import { assertCanFileComplianceDocument } from "@/lib/domain/access/projects";
import { assertCanMoveComplianceFile } from "@/lib/domain/compliance/file-ownership";
import { isDomainError } from "@/lib/domain/errors";
import { userPrincipal, type DomainPrincipal } from "@/lib/domain/principal";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  parseBodyWithResponse,
  parseRouteParamsWithResponse,
  projectParamSchema,
  successResponse,
} from "@/utils/validators";
import { complianceDiscoverySchema } from "@/utils/validators/compliance";

// OCR plus a model round-trip on a scanned plan set comfortably exceeds the
// default serverless budget, the same way the HBCF extraction route does.
export const maxDuration = 300;

/**
 * Is this document already on the job?
 *
 * Called once per required document, in order, by the discovery modal, and
 * answered as cheaply as the evidence allows:
 *
 *  1. The engagement's own row already has a file — nothing to do.
 *  2. A file on the project has a name that plainly says what it is. Filename
 *     matching is crude, but it is free, and the documents in question are
 *     routinely named after themselves.
 *  3. Only then is the classifier asked, and only about project files that
 *     nothing has claimed yet.
 *
 * A classifier answer is written back onto the document row, so re-opening the
 * modal costs nothing. Without that, a six-document loop pays for six OCR
 * round-trips every single time it runs.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const routeParams = parseRouteParamsWithResponse(
    await params,
    projectParamSchema,
  );
  if (!routeParams.success) return routeParams.response;

  const body = await parseBodyWithResponse(request, complianceDiscoverySchema);
  if (!body.success) return body.response;

  const { projectId } = routeParams.data;
  const { documentType } = body.data;

  try {
    const { engagement, user } = await requireComplianceMutation(projectId);
    // Looking is filing: a found file is claimed onto the row.
    const principal = userPrincipal(user);
    assertCanFileComplianceDocument(principal, documentType);
    const engagementId = engagement!.id;

    // 1. Already collected.
    const existing = await prisma.complianceDocument.findFirst({
      where: { engagementId, documentType },
      include: { files: { orderBy: { createdAt: "asc" } } },
    });
    if (existing && existing.files.length > 0) {
      const file = existing.files[0];
      return successResponse({
        documentType,
        found: true,
        source: "collected" as const,
        file: { id: file.id, name: file.filename, url: file.url },
      });
    }

    // Project files nothing has claimed. A file already attached to another
    // compliance document is spoken for and must not be double-counted.
    const candidates = await prisma.file.findMany({
      where: { projectId, complianceDocumentId: null },
      select: { id: true, filename: true, url: true, fileType: true },
      orderBy: { createdAt: "desc" },
    });

    // 2. The name says what it is. Newest first, and past any match this
    // caller may not move: one refused file must not hide an eligible one
    // behind it and send the search to OCR for nothing.
    let byName: (typeof candidates)[number] | undefined;
    for (const file of candidates) {
      if (!matchesByName(file.filename, documentType)) continue;
      if (await mayMove(principal, projectId, file.id)) {
        byName = file;
        break;
      }
    }
    if (byName) {
      const document = await claim(
        engagementId,
        documentType,
        byName.id,
        existing?.id,
      );
      return successResponse({
        documentType,
        found: true,
        source: "filename" as const,
        documentId: document.id,
        file: { id: byName.id, name: byName.filename, url: byName.url },
      });
    }

    // 3. Read the ones that could plausibly be it. Bounded deliberately: this
    // runs inside a request the user is watching a spinner for, and a project
    // with thirty files would otherwise mean thirty OCR calls per document.
    const readable = candidates
      .filter((file) => file.fileType?.toLowerCase().includes("pdf"))
      .slice(0, MAX_CLASSIFICATIONS);

    for (const file of readable) {
      const result = await classifyDocumentAtUrl(file.url, file.filename);
      if (result.documentType !== documentType) {
        continue;
      }
      if (!(await mayMove(principal, projectId, file.id))) {
        continue;
      }
      const document = await claim(
        engagementId,
        documentType,
        file.id,
        existing?.id,
      );
      return successResponse({
        documentType,
        found: true,
        source: "classifier" as const,
        documentId: document.id,
        file: { id: file.id, name: file.filename, url: file.url },
      });
    }

    return successResponse({
      documentType,
      found: false,
      label: complianceDocumentLabel(documentType),
      documentId: existing?.id ?? null,
    });
  } catch (error) {
    const refusal = complianceAccessResponse(error);
    if (refusal) return refusal;
    const domainRefusal = domainErrorResponse(error);
    if (domainRefusal) return domainRefusal;
    console.error(
      `Discovery failed for ${documentType} on ${projectId}`,
      error,
    );
    return errorResponse("Failed to look for this document.");
  }
}

/**
 * Whether this caller may move the file onto a compliance row.
 *
 * Claiming moves a file the same way an upload does, so it answers to the same
 * rule (`assertCanMoveComplianceFile`): the project's HBCF certificate sits on
 * the project unclaimed, and a site manager's discovery must not pull it onto
 * another row. A refusal here means "not this file", and the search goes on.
 */
async function mayMove(
  principal: DomainPrincipal,
  projectId: string,
  fileId: string,
): Promise<boolean> {
  try {
    await assertCanMoveComplianceFile(principal, { projectId, fileId }, prisma);
    return true;
  } catch (error) {
    if (isDomainError(error)) return false;
    throw error;
  }
}

// A project carrying more unclaimed PDFs than this is a document dump, and the
// first few are the ones a person just uploaded for this step.
const MAX_CLASSIFICATIONS = 6;

/**
 * Links a found file to its compliance document, creating the row if the type
 * was never seeded.
 *
 * Marked UPLOADED rather than RECEIVED: the file was already on the project
 * because a person put it there, which is the same provenance as uploading it
 * through the modal.
 */
async function claim(
  engagementId: string,
  documentType: ComplianceDocumentType,
  fileId: string,
  documentId?: string,
) {
  return prisma.$transaction(async (tx) => {
    const document = documentId
      ? await tx.complianceDocument.update({
          where: { id: documentId },
          data: {
            status: ComplianceDocumentStatus.UPLOADED,
            rejectionReason: null,
          },
        })
      : await tx.complianceDocument.create({
          data: {
            engagementId,
            documentType,
            status: ComplianceDocumentStatus.UPLOADED,
            order: await tx.complianceDocument.count({
              where: { engagementId },
            }),
          },
        });

    await tx.file.update({
      where: { id: fileId },
      data: { complianceDocumentId: document.id },
    });

    return document;
  });
}

/**
 * Filename keywords per document type.
 *
 * Every group is an AND of ORs: the terms in one inner array are alternatives,
 * and each inner array must hit somewhere in the name. That is what stops
 * "preliminary architectural plans.pdf" satisfying the full design, and stops
 * "stormwater plan.pdf" satisfying either.
 */
const NAME_HINTS: Record<ComplianceDocumentType, string[][]> = {
  [ComplianceDocumentType.DEPOSITED_PLAN]: [["deposited plan", "dp plan"]],
  [ComplianceDocumentType.TITLE_SEARCH_DETAIL_AND_LEVEL]: [
    ["title search", "title detail", "folio"],
  ],
  [ComplianceDocumentType.SURVEY]: [["survey"]],
  [ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS]: [
    ["preliminary", "prelim", "concept", "sketch", "draft"],
    ["plan", "architectural", "drawing"],
  ],
  [ComplianceDocumentType.PLANNING_CERTIFICATE_10_7]: [
    ["10.7", "10-7", "107", "planning certificate", "section 149"],
  ],
  [ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN]: [
    ["architectural", "design", "working drawing"],
    ["full", "final", "complete", "design", "for construction"],
  ],
  // Not part of the required pack, and never found by discovery -- the deed is
  // uploaded by hand when a surveyor is engaged. Listed so the record stays
  // exhaustive over the enum, which is what makes a new document type a
  // compile error here rather than a silently unmatchable one.
  [ComplianceDocumentType.LAND_DEED]: [
    ["land deed", "certificate of title", "deed"],
  ],
  [ComplianceDocumentType.INVOICE]: [["invoice", "tax invoice"]],
  [ComplianceDocumentType.FEE_PROPOSAL]: [
    ["fee proposal", "quotation", "quote"],
  ],
  [ComplianceDocumentType.CDC_FORM]: [["cdc"], ["form", "application"]],
  [ComplianceDocumentType.CHECKLIST]: [["checklist"]],
  [ComplianceDocumentType.SIGNED_FEE_PROPOSAL]: [
    ["signed"],
    ["fee", "proposal"],
  ],
  [ComplianceDocumentType.SIGNED_CDC_FORM]: [["signed"], ["cdc"]],
  [ComplianceDocumentType.CHECKLIST_ITEM]: [],
  // A line of a council's request for more information, written by the DA
  // extraction rather than found on disk -- the same reason CHECKLIST_ITEM
  // above matches nothing.
  [ComplianceDocumentType.DA_ITEM]: [],
  [ComplianceDocumentType.HOME_INSURANCE]: [
    ["hbcf", "home warranty", "home building compensation"],
  ],
  [ComplianceDocumentType.BASIX_CERTIFICATE]: [["basix"]],
  // Deliberately demanding two hits. "Certificate" alone appears in the
  // filename of half the documents on a compliance file, and reading a BASIX
  // certificate as the construction certificate would mark the job finished.
  [ComplianceDocumentType.CONSTRUCTION_CERTIFICATE]: [
    ["construction"],
    ["certificate", "cc "],
  ],
  // The same two-hit demand, for the same reason and with one more: "cdc" on
  // its own is also the CDC *application form*, which is a document the file
  // holds from the other end of the engagement entirely. Reading the form as the
  // issued certificate would mark a job finished before it had been lodged.
  [ComplianceDocumentType.COMPLYING_DEVELOPMENT_CERTIFICATE]: [
    ["complying development", "cdc"],
    ["certificate", "cdc "],
  ],
  [ComplianceDocumentType.BUSHFIRE_REPORT]: [
    ["bushfire", "bush fire", "bal ", "bal-", "bal report", "bal rating"],
  ],
  // Never found by discovery — the loop only ever asks about the six required
  // documents. Listed because the record is exhaustive over the enum, which is
  // what makes a new document type a compile error here rather than a silently
  // unmatchable one, and because `matchesByName` is the same function the
  // needs-identifying queue could use later.
  [ComplianceDocumentType.STRUCTURAL_DRAWINGS]: [
    ["structural"],
    ["drawing", "plan", "design", "certificate", "detail"],
  ],
  [ComplianceDocumentType.HYDRAULIC_STORMWATER_DRAWINGS]: [
    ["hydraulic", "stormwater", "storm water", "drainage"],
  ],
  [ComplianceDocumentType.GEOTECH_REPORT]: [
    ["geotech", "geotechnical", "soil classification", "soil report"],
  ],
  [ComplianceDocumentType.WATER_SERVICING_APPROVAL]: [
    ["tap in", "tap-in", "water servicing", "servicing coordinator", "wsc"],
  ],
  [ComplianceDocumentType.SECTION_73_NOTICE]: [
    ["section 73", "s73", "notice of requirements"],
  ],
  [ComplianceDocumentType.ROAD_OPENING_PERMIT]: [
    ["road opening", "vehicle crossing", "driveway crossing", "kerb"],
  ],
  [ComplianceDocumentType.LONG_SERVICE_LEVY]: [["long service"]],
  [ComplianceDocumentType.MINE_SUBSIDENCE_APPROVAL]: [
    ["mine subsidence", "subsidence advisory"],
  ],
  [ComplianceDocumentType.WASTE_MANAGEMENT_PLAN]: [
    ["waste"],
    ["management", "plan", "wmp"],
  ],
  [ComplianceDocumentType.TRAFFIC_CONTROL_PLAN]: [
    ["traffic"],
    ["control", "management", "plan", "tcp"],
  ],
  [ComplianceDocumentType.BUILD_COST_SUMMARY]: [
    ["cost"],
    ["summary", "estimate", "breakdown", "schedule", "works"],
  ],
  [ComplianceDocumentType.OWNER_CONSENT_FORM]: [
    ["owner", "owners"],
    ["consent"],
  ],
  [ComplianceDocumentType.DEVELOPMENT_CONSENT]: [
    [
      "development consent",
      "notice of determination",
      "da approval",
      "da consent",
    ],
  ],
  [ComplianceDocumentType.UNKNOWN]: [],
};

function matchesByName(
  filename: string,
  documentType: ComplianceDocumentType,
): boolean {
  const groups = NAME_HINTS[documentType];
  if (!groups || groups.length === 0) {
    return false;
  }
  const name = filename.toLowerCase();
  return groups.every((alternatives) =>
    alternatives.some((term) => name.includes(term)),
  );
}
