import { Prisma, ProjectStatus } from "@prisma/client";

import { paymentStagesFromLabels } from "@/lib/projects/payment-stages";
import type { OfferWorkspaceCostLine } from "@/lib/offer/workspace-model";
import { createActivityLogEntry } from "@/types/activityLog";
import type { ProjectExtractionData } from "@/types/project-extraction";
import type {
  ProjectRequirementsPayload,
  ProjectSourceDocumentReference,
} from "@/types/project-flow";

import { logActionOrThrow } from "../audit/action-log";
import type { DomainDb } from "../db";
import { DomainTransitionError, DomainValidationError } from "../errors";
import { resolveCustomersForProject } from "../identity/customers";
import { requireAssignableSiteManager } from "../identity/site-managers";
import {
  unavailableProjectInference,
  type ProjectInferencePort,
} from "../ports/project-inference";
import { attributionUserId, type DomainPrincipal } from "../principal";

import { withNormalizedSignedDate } from "./commands";
import { buildProjectRequirementsPayload, resolveProjectBudget } from "./flow";
import { createMilestonesFromTemplate } from "./milestones";
import {
  requireProjectOwners,
  withOwnerContacts,
  type ProjectOwnerInput,
} from "./owners";
import {
  collectProjectDateBlockers,
  partitionBlockers,
  ProjectDateBlockerError,
} from "./readiness";

// Converting a lead into a project.
//
// One command, and the whole conversion is one transaction. The previous
// implementation (`lib/data/projectsWrite.ts#createProjectWithLead`) already
// wrapped most of it, but the customer resolution, the site-manager check and
// the AI inference ran outside — so a failure between them left a customer
// record created for a project that never existed, and the site manager was
// never validated at all on this path (only the deprecated `createProject`
// checked). Both are inside now.
//
// Three things stayed outside the domain deliberately:
//
//   - **The inference model.** Injected as a port. It is the fallback for a
//     lead converted with no extracted documents, and a channel that cannot
//     run a model passes `unavailableProjectInference` rather than failing.
//   - **The cache tags and the Novu notification.** Post-commit work; the
//     outcome names what happened and the adapter acts on it.
//   - **Reading the created project back for the screen.** That is
//     `lib/domain/projects/queries.ts#getProjectDetail`, through whichever
//     cached adapter the caller has.

export type ProjectSourceDocuments = {
  readonly tender: ProjectSourceDocumentReference;
  readonly contract: ProjectSourceDocumentReference;
};

export type CreateProjectFromLeadInput = {
  readonly leadId: number;
  readonly projectName: string;
  readonly lotSize: number;
  readonly startDate: string;
  readonly estimatedEndDate: string;
  readonly address: string;
  readonly council: string;
  readonly siteManagerId: string;
  /**
   * Every owner the contract names, in its order; each becomes a customer
   * linked to the project, and the first is the primary (`Project.customerId`,
   * the one invoiced). Omitted, it is read from a flat extraction's
   * `legalAdministrationOwners`. There is no fallback to the lead: the person
   * who enquired is not necessarily an owner, so a project with no owners is
   * refused rather than attached to them.
   *
   * This replaced `customerName`/`customerEmail`/`customerPhone`, which named
   * one customer and fell back to the lead's contact field by field: the
   * wizard never sent them, so every wizard project was attached to whoever
   * made the enquiry rather than to the owners who signed.
   */
  readonly owners?: readonly ProjectOwnerInput[] | null;
  /** Full owner party set, preserved on `Project.parties` (ADR 0003). */
  readonly parties?: Prisma.InputJsonValue | null;
  readonly extraction?:
    | ProjectRequirementsPayload
    | ProjectExtractionData
    | null;
  readonly costLines?: readonly OfferWorkspaceCostLine[];
  readonly sourceDocuments: ProjectSourceDocuments;
  /**
   * The caller has already shown the advisory blockers and the operator
   * accepted them. Hard blockers still throw — confirmation only suppresses
   * the NEEDS_ATTENTION flag on advisory warns.
   */
  readonly confirmDateBlockers?: boolean;
};

export type CreatedProjectCustomer = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly created: boolean;
};

export type CreateProjectFromLeadResult = {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectType: string;
  readonly location: string;
  readonly status: ProjectStatus;
  readonly siteManagerId: string;
  /** The primary owner: `customers[0]`. */
  readonly customer: CreatedProjectCustomer;
  /** Every owner, in the contract's order. */
  readonly customers: readonly CreatedProjectCustomer[];
  /** Advisory blockers the project was created with, for the header. */
  readonly warnings: readonly string[];
  readonly milestonesCreated: number;
  readonly filesMoved: number;
};

function isFlatExtraction(
  extraction: ProjectRequirementsPayload | ProjectExtractionData,
): extraction is ProjectExtractionData {
  return (
    "legalAdministrationSiteAddress" in extraction
    || "commercialsAndClaimsTotalContractSum" in extraction
  );
}

/**
 * Turn the flat OCR extraction into the nested requirements payload.
 *
 * A payload that is already nested is returned untouched — the offer handoff
 * builds one directly.
 */
function normalizeExtraction(
  extraction: ProjectRequirementsPayload | ProjectExtractionData,
  sourceDocuments: ProjectSourceDocuments,
): ProjectRequirementsPayload {
  if (!isFlatExtraction(extraction)) return extraction;

  return buildProjectRequirementsPayload(
    {
      projectName: extraction.projectName,
      projectType: extraction.projectType,
      summary: extraction.summary,
      legalAdministration: {
        siteAddress: extraction.legalAdministrationSiteAddress,
        // Written from the resolved owners by `withOwnerContacts`, so the
        // three lists stay aligned owner by owner.
        ownerContacts: { names: [], emails: [], phones: [] },
        commencementTrigger: extraction.legalAdministrationCommencementTrigger,
        signedDate: extraction.legalAdministrationSignedDate,
        pcaInspector: extraction.legalAdministrationPcaInspector,
        // The HBCF certificate is uploaded from the project's Overview tab
        // after handover; tender/contract extraction never carries it.
        hbcfInsuranceNumber: null,
        hbcfInsuranceDocument: null,
      },
      commercialsAndClaims: {
        totalContractSum: extraction.commercialsAndClaimsTotalContractSum,
        gstIncluded: extraction.commercialsAndClaimsGstIncluded,
        gstAmount: extraction.commercialsAndClaimsGstAmount,
        depositValue: extraction.commercialsAndClaimsDepositValue,
        claimStageSlabPercentage:
          extraction.commercialsAndClaimsClaimStageSlabPercentage,
        claimStageSlabDollarValue:
          extraction.commercialsAndClaimsClaimStageSlabDollarValue,
        variationAdminFee: extraction.commercialsAndClaimsVariationAdminFee,
        latePenaltyRate: extraction.commercialsAndClaimsLatePenaltyRate,
        paymentStages: paymentStagesFromLabels(
          extraction.commercialsAndClaimsPaymentStages,
          extraction.commercialsAndClaimsTotalContractSum,
        ),
      },
      subStructureAndGround: {
        concreteSlabClass: extraction.subStructureAndGroundConcreteSlabClass,
        concreteStrengthMpa:
          extraction.subStructureAndGroundConcreteStrengthMpa,
        vapourBarrier: extraction.subStructureAndGroundVapourBarrier,
        termiteSystem: extraction.subStructureAndGroundTermiteSystem,
        sewerConnection: extraction.subStructureAndGroundSewerConnection,
      },
      inclusionsAndExclusions: {
        inclusions: extraction.inclusionsAndExclusionsInclusions,
        exclusions: extraction.inclusionsAndExclusionsExclusions,
      },
      utilityInfrastructure: {
        electricalPhase: extraction.utilityInfrastructureElectricalPhase,
        communicationConduit:
          extraction.utilityInfrastructureCommunicationConduit,
        gasConnection: extraction.utilityInfrastructureGasConnection,
        fridgeWaterPoint: extraction.utilityInfrastructureFridgeWaterPoint,
        smartLockBrand: extraction.utilityInfrastructureSmartLockBrand,
      },
      wetAreaCompliance: {
        waterproofingStandard:
          extraction.wetAreaComplianceWaterproofingStandard,
        showerScreenType: extraction.wetAreaComplianceShowerScreenType,
        tiledNicheCount: extraction.wetAreaComplianceTiledNicheCount,
        showerCount: extraction.wetAreaComplianceShowerCount,
        floorToCeilingTiles: extraction.wetAreaComplianceFloorToCeilingTiles,
        floorWasteType: extraction.wetAreaComplianceFloorWasteType,
      },
      safetyAndSiteLogistics: {
        roofGuardrails: extraction.safetyAndSiteLogisticsRoofGuardrails,
        sedimentControl: extraction.safetyAndSiteLogisticsSedimentControl,
        scaffoldingSafety: extraction.safetyAndSiteLogisticsScaffoldingSafety,
        tradeWaste: extraction.safetyAndSiteLogisticsTradeWaste,
        finalCleanStatus: extraction.safetyAndSiteLogisticsFinalCleanStatus,
      },
      conflicts: [],
      automationTriggers: {
        orderReminders: true,
        rainDelayCalculations: true,
        noticeCountdowns: true,
      },
    },
    {
      tender: { ...sourceDocuments.tender, kind: "tender" },
      contract: { ...sourceDocuments.contract, kind: "contract" },
    },
    [],
  );
}

/** The payload a lead with no extracted documents starts from. */
function inferredRequirements(input: {
  projectName: string;
  address: string;
  specs: { projectType: string; summary: string; budget: number };
}): ProjectRequirementsPayload {
  return buildProjectRequirementsPayload(
    {
      projectName: input.projectName,
      projectType: input.specs.projectType,
      summary: input.specs.summary,
      legalAdministration: {
        siteAddress: input.address,
        // Written from the resolved owners by `withOwnerContacts`.
        ownerContacts: { names: [], emails: [], phones: [] },
        commencementTrigger: "",
        signedDate: "",
        pcaInspector: "",
        hbcfInsuranceNumber: null,
        hbcfInsuranceDocument: null,
      },
      commercialsAndClaims: {
        totalContractSum: input.specs.budget,
        gstIncluded: null,
        gstAmount: null,
        depositValue: null,
        claimStageSlabPercentage: null,
        claimStageSlabDollarValue: null,
        variationAdminFee: null,
        latePenaltyRate: null,
        paymentStages: [],
      },
      subStructureAndGround: {
        concreteSlabClass: "",
        concreteStrengthMpa: null,
        vapourBarrier: "",
        termiteSystem: "",
        sewerConnection: "",
      },
      inclusionsAndExclusions: { inclusions: [], exclusions: [] },
      utilityInfrastructure: {
        electricalPhase: "",
        communicationConduit: "",
        gasConnection: "",
        fridgeWaterPoint: "",
        smartLockBrand: "",
      },
      wetAreaCompliance: {
        waterproofingStandard: "",
        showerScreenType: "",
        tiledNicheCount: null,
        showerCount: null,
        floorToCeilingTiles: "",
        floorWasteType: "",
      },
      safetyAndSiteLogistics: {
        roofGuardrails: "",
        sedimentControl: "",
        scaffoldingSafety: "",
        tradeWaste: "",
        finalCleanStatus: "",
      },
      conflicts: [],
      automationTriggers: {
        orderReminders: true,
        rainDelayCalculations: true,
        noticeCountdowns: true,
      },
    },
    {
      tender: { fileId: "", fileName: "", url: "", kind: "tender" },
      contract: { fileId: "", fileName: "", url: "", kind: "contract" },
    },
    [],
  );
}

/**
 * Convert a lead into a project, its owners' customers, its milestones and
 * its history, in one transaction.
 *
 * Authorizes nobody by itself beyond needing a caller: whether the principal
 * may open `leadId` is the lead rule (`lib/domain/access/leads.ts`), which the
 * adapters check before they get here — converting a lead is a lead-scoped
 * action, not a project-scoped one, because the project does not exist yet.
 *
 * @throws {ProjectDateBlockerError} A hard date blocker. Carries the blocker
 * list, so the wizard can bind each one to the field that caused it.
 * @throws {DomainTransitionError} The lead already has a project.
 * @throws {DomainValidationError} An owner list the owner rule refuses
 * (`lib/domain/projects/owners.ts`), named by `legalAdministrationOwners`.
 */
export async function createProjectFromLead(
  principal: DomainPrincipal,
  input: CreateProjectFromLeadInput,
  db: DomainDb,
  ports: { inferProjectSpecs?: ProjectInferencePort } = {},
): Promise<CreateProjectFromLeadResult> {
  const inferProjectSpecs =
    ports.inferProjectSpecs ?? unavailableProjectInference;

  const startDate = new Date(input.startDate);
  const estimatedEndDate = new Date(input.estimatedEndDate);
  for (const [field, value] of [
    ["startDate", startDate],
    ["estimatedEndDate", estimatedEndDate],
  ] as const) {
    if (Number.isNaN(value.getTime())) {
      throw new DomainValidationError(
        `${field} is not a calendar date.`,
        field,
      );
    }
  }

  const lead = await db.lead.findUnique({
    where: { id: input.leadId },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      project: { select: { id: true } },
    },
  });
  if (!lead) {
    throw new DomainValidationError(
      `Lead with ID ${input.leadId} not found.`,
      "leadId",
    );
  }
  if (lead.project) {
    throw new DomainTransitionError(
      `A project has already been created for lead ID ${input.leadId}.`,
    );
  }

  // The owners are checked before anything is written, so a contract with an
  // owner the office has not finished filling in is refused with the owner
  // named, rather than failing on a customer insert halfway through.
  const owners = requireProjectOwners(
    input.owners
      ?? (input.extraction && isFlatExtraction(input.extraction)
        ? input.extraction.legalAdministrationOwners
        : []),
  );

  // Validated before anything is written. The previous implementation only
  // checked the site manager on the deprecated manual path, so a stale id from
  // the wizard reached `project.create` and failed as a foreign-key violation
  // halfway through the transaction.
  const siteManager = await requireAssignableSiteManager(
    input.siteManagerId,
    db,
  );

  // Inference runs only when the wizard extracted nothing — it is the
  // fallback, and it costs a model call.
  const specs = input.extraction
    ? null
    : await inferProjectSpecs({ leadId: lead.id });

  const extractedSummary =
    input.extraction && typeof input.extraction === "object"
      ? ((input.extraction as { summary?: string }).summary ?? "")
      : "";
  const extractedProjectType =
    input.extraction && typeof input.extraction === "object"
      ? ((input.extraction as { projectType?: string }).projectType
        ?? "Unknown")
      : "Unknown";

  const projectDescription =
    extractedSummary || specs?.projectDescription || "";
  const projectType = extractedProjectType || (specs?.projectType ?? "Unknown");
  const projectBudget = input.extraction
    ? isFlatExtraction(input.extraction)
      ? (input.extraction.commercialsAndClaimsTotalContractSum ?? 0)
      : resolveProjectBudget(input.extraction)
    : (specs?.projectBudget ?? 0);

  const requirements = withOwnerContacts(
    withNormalizedSignedDate(
      input.extraction
        ? normalizeExtraction(input.extraction, input.sourceDocuments)
        : inferredRequirements({
            address: input.address,
            projectName: input.projectName,
            specs: {
              budget: specs?.projectBudget ?? 0,
              projectType: specs?.projectType ?? "",
              summary: specs?.projectDescription ?? "",
            },
          }),
    ),
    owners,
  );

  const legal = (
    requirements as ProjectRequirementsPayload & {
      legalAdministration?: {
        signedDate?: string | null;
        pcaInspector?: string | null;
        hbcfInsuranceNumber?: string | null;
      };
    }
  ).legalAdministration;

  const blockers = collectProjectDateBlockers({
    hbcfInsuranceNumber: legal?.hbcfInsuranceNumber ?? null,
    pcaInspector: legal?.pcaInspector ?? null,
    signedDate: legal?.signedDate ?? null,
    startDate: input.startDate,
    status: ProjectStatus.ACTIVE,
  });
  const { blocks, warns } = partitionBlockers(blockers);
  if (blocks.length > 0) throw new ProjectDateBlockerError(blocks);

  // Advisory warns (missing PCA, missing HBCF, unparseable signed date) create
  // the project as NEEDS_ATTENTION so the gap is visible rather than silent.
  //
  // Otherwise the status is LEFT OFF, so `Project.status @default(DRAFT)`
  // applies. Setting ACTIVE here would declare a build under way on the day it
  // was created — which is exactly what DRAFT replaced ACTIVE as the default
  // to stop. The readiness gate above still asks its question against ACTIVE:
  // it is checking what stands between this project and going on site, not
  // asserting that it has.
  const flagNeedsAttention = warns.length > 0 && !input.confirmDateBlockers;

  const customers = await resolveCustomersForProject(owners, db);
  // `requireProjectOwners` refuses an empty list, so there is always a first.
  const customer = customers[0].customer;

  const project = await db.project.create({
    data: {
      leadId: lead.id,
      name: input.projectName,
      description: projectDescription,
      buildingType: projectType,
      location: input.address,
      council: input.council,
      totalBudget: new Prisma.Decimal(projectBudget),
      lotSize: String(input.lotSize),
      startDate,
      estimatedEndDate,
      siteManagerId: siteManager.id,
      requirements: requirements as unknown as Prisma.InputJsonValue,
      ...(input.parties ? { parties: input.parties } : {}),
      ...(flagNeedsAttention ? { status: ProjectStatus.NEEDS_ATTENTION } : {}),
      customerId: customer.id,
      customers: {
        create: customers.map((owner, position) => ({
          customerId: owner.customer.id,
          position,
        })),
      },
    },
    select: { id: true, location: true, name: true, status: true },
  });

  const { created: milestonesCreated } = await createMilestonesFromTemplate(
    { costLines: input.costLines, projectId: project.id, startDate },
    db,
  );

  await logActionOrThrow(
    {
      ...createActivityLogEntry("projectCreated", {
        customerEmail: customer.email,
        // Every owner, so the history reads "created for Jane & John Smith"
        // rather than naming only the primary.
        customerName: customers.map((owner) => owner.customer.name).join(" & "),
        customerPhone: customer.phone,
        location: project.location,
        projectId: project.id,
        projectName: project.name,
        projectType,
      }),
      authorId: attributionUserId(principal),
    },
    db,
  );

  // Only this lead's files. The tender and the contract are among them: the
  // wizard uploads both with this leadId and the offer handoff creates their
  // rows on the lead. Matching the `sourceDocuments` URLs as well — which the
  // wizard's action takes from the browser — moved whatever File row had that
  // URL, including another project's signed contract.
  const { count: filesMoved } = await db.file.updateMany({
    where: { leadId: lead.id },
    data: { projectId: project.id },
  });

  const createdCustomers = customers.map(
    ({ created, customer: owner }): CreatedProjectCustomer => ({
      created,
      email: owner.email,
      id: owner.id,
      name: owner.name,
      phone: owner.phone,
    }),
  );

  return {
    customer: createdCustomers[0],
    customers: createdCustomers,
    filesMoved,
    location: project.location,
    milestonesCreated,
    projectId: project.id,
    projectName: project.name,
    projectType,
    siteManagerId: siteManager.id,
    status: project.status,
    warnings: warns.map((warn) => warn.label),
  };
}
