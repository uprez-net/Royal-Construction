"use server";
import prisma from "@/lib/prisma";
import { createCustomerForProject, findCustomerByContact, findCustomerById } from "@/lib/data/customers";
import { getSiteManagerById } from "@/lib/data/siteManagers";
import type { CreateProjectInput } from "@/utils/validators";
import { CACHE_PROFILES } from "@/types/cache";
import { revalidateTag } from "next/cache";
import { createNotification } from "@/types/notification";
import { triggerNotification } from "../notification/novu";
import { createMilestonesFromTemplateForProject } from "./milestones";
import { ProjectDetail } from "@/types/project";
import { getCachedProjectById } from "./projects";
import { after } from "next/server"
import { handleProjectSpecsGeneration } from "../agent/projectCreationAgent";
import { createLeadProjectInferencePrompt } from "../agent/project-prompt";
import { createActivityLogEntry } from "@/types/activityLog";
import { logAction } from "./actionLog";
import { Prisma } from "@prisma/client";
import type { ProjectRequirementsPayload, ProjectSourceDocumentReference } from "@/types/project-flow";
import { buildProjectRequirementsPayload, resolveProjectBudget } from "@/lib/data/projectFlow";
import type { ProjectExtractionData } from "@/types/project-extraction";

/**
 * Creates a new project from manually entered project data.
 *
 * @deprecated Use {@link createProjectWithLead} instead. This function exists only
 * for legacy flows and intentionally fails if used without an associated lead.
 *
 * The function performs the following operations:
 * - Resolves or creates the customer depending on the selected customer mode.
 * - Validates the assigned site manager (if provided).
 * - Creates the project record.
 * - Schedules cache revalidation after the request completes.
 * - Sends a project creation notification to the assigned site manager.
 *
 * @param projectData - Validated project creation payload.
 * @returns The ID of the newly created project.
 *
 * @throws {Error} CUSTOMER_NOT_FOUND
 * Thrown when an existing customer ID cannot be found.
 *
 * @throws {Error} SITE_MANAGER_NOT_FOUND
 * Thrown when the supplied site manager ID is invalid.
 */
export async function createProject(projectData: CreateProjectInput) {
  const customerMode = projectData.customerMode;

  let customerId = "";

  if (customerMode === "existing") {
    const existingCustomer = await findCustomerById(projectData.customerId!);
    if (!existingCustomer) {
      throw new Error("CUSTOMER_NOT_FOUND");
    }
    customerId = existingCustomer.id;
  } else {
    const existingCustomer = await findCustomerByContact(projectData.customerEmail!, projectData.customerPhone!);
    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      const createdCustomer = await createCustomerForProject({
        name: projectData.customerName!,
        email: projectData.customerEmail!,
        phone: projectData.customerPhone!,
      });
      customerId = createdCustomer.id;
    }
  }

  const siteManagerId = projectData.siteManagerId?.trim() || null;
  let siteManager = null;

  if (siteManagerId) {
    siteManager = await getSiteManagerById(siteManagerId);
    if (!siteManager) {
      throw new Error("SITE_MANAGER_NOT_FOUND");
    }
  }

  const project = await prisma.project.create({
    data: {
      name: projectData.name,
      buildingType: projectData.propertyType,
      description: projectData.notes?.trim() || null,
      customerId,
      location: projectData.location,
      siteManagerId: siteManager?.id ?? null,
      totalBudget: String(projectData.budget),
      lotSize: String(projectData.lotSize),
      startDate: projectData.startDate,
      estimatedEndDate: projectData.estimatedEndDate || projectData.startDate,
      requirements: {
        notes: projectData.notes?.trim() || null,
        customerMode,
      },
      leadId: 0, // To make this function fail
    },
    include: { customer: true },
  });

  after(async () => {
    revalidateTag("projects", CACHE_PROFILES.MEDIUM);
    revalidateTag(`project-${project.id}`, CACHE_PROFILES.MEDIUM);
    const notificationPayload = createNotification("projectCreated", {
      projectId: project.id,
      projectName: project.name,
      projectType: project.buildingType,
      location: project.location,
      customerName: project.customer.name,
      customerEmail: project.customer.email,
      customerPhone: project.customer.phone,
    });
    await triggerNotification(project.siteManagerId ? [project.siteManagerId] : [], notificationPayload);
  })

  return project.id;
}

/**
 * Input required to create a project directly from an existing lead.
 */
export interface CreateProjectWithLeadInput {
  projectName: string;
  leadId: number;
  lotSize: number;
  startDate: string;
  estimatedEndDate: string;
  address: string;
  council: string;
  siteManagerId: string;
  // Primary owner identity, promoted to the Customer at handoff so Project
  // screens/notifications show the legal owner, not the original lead contact
  // (ADR 0003; codex #7). Each falls back to the lead value when absent.
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  // Primary owner's Current Location, promoted to Customer.address (ADR 0003).
  customerAddress?: string | null;
  // Full owner party set (owners[]) preserved on Project.parties (ADR 0003).
  parties?: Prisma.InputJsonValue | null;
  extraction?: ProjectRequirementsPayload | ProjectExtractionData | null;
  sourceDocuments: {
    tender: ProjectSourceDocumentReference;
    contract: ProjectSourceDocumentReference;
  };
}

function isFlatExtraction(extraction: ProjectRequirementsPayload | ProjectExtractionData): extraction is ProjectExtractionData {
  return "legalAdministrationSiteAddress" in extraction || "commercialsAndClaimsContractPrice" in extraction;
}

const LABEL_PERCENTAGE_RECORD: Record<string, number> = {
  deposit: 5,
  slab: 15,
  frame: 25,
  "lock up": 25,
  "interior fit out": 20,
  final: 10,
};

const calculatePercentageAmount = (
  label: string,
  totalContractSum: number | null,
) => {
  const percentageMatch = label.match(/(\d+(?:\.\d+)?)\s*%/);

  const normalizedLabel = label.toLowerCase();

  const percentage = percentageMatch
    ? Number(percentageMatch[1])
    : Object.entries(LABEL_PERCENTAGE_RECORD).find(([key]) =>
      new RegExp(`\\b${key}\\b`).test(normalizedLabel),
    )?.[1] ?? null;

  return {
    label,
    percentage,
    amount:
      percentage !== null && totalContractSum !== null
        ? (totalContractSum * percentage) / 100
        : null,
  };
};

function normalizeExtraction(extraction: ProjectRequirementsPayload | ProjectExtractionData,
  sourceDocuments: {
    tender: ProjectSourceDocumentReference;
    contract: ProjectSourceDocumentReference;
  }
): ProjectRequirementsPayload {
  if (!isFlatExtraction(extraction)) {
    return extraction;
  }

  return buildProjectRequirementsPayload(
    {
      projectName: extraction.projectName,
      projectType: extraction.projectType,
      summary: extraction.summary,
      legalAdministration: {
        siteAddress: extraction.legalAdministrationSiteAddress,
        ownerContacts: {
          names: extraction.legalAdministrationOwnerNames,
          emails: extraction.legalAdministrationOwnerEmails,
          phones: extraction.legalAdministrationOwnerPhones,
        },
        commencementTrigger: extraction.legalAdministrationCommencementTrigger,
        signedDate: extraction.legalAdministrationSignedDate,
        pcaInspector: extraction.legalAdministrationPcaInspector,
      },
      commercialsAndClaims: {
        totalContractSum: extraction.commercialsAndClaimsTotalContractSum,
        tenderTotalPrice: extraction.commercialsAndClaimsTenderTotalPrice,
        contractPrice: extraction.commercialsAndClaimsContractPrice,
        gstIncluded: extraction.commercialsAndClaimsGstIncluded,
        gstAmount: extraction.commercialsAndClaimsGstAmount,
        depositValue: extraction.commercialsAndClaimsDepositValue,
        claimStageSlabPercentage: extraction.commercialsAndClaimsClaimStageSlabPercentage,
        claimStageSlabDollarValue: extraction.commercialsAndClaimsClaimStageSlabDollarValue,
        variationAdminFee: extraction.commercialsAndClaimsVariationAdminFee,
        latePenaltyRate: extraction.commercialsAndClaimsLatePenaltyRate,
        paymentStages: extraction.commercialsAndClaimsPaymentStages.map((label) => calculatePercentageAmount(label, extraction.commercialsAndClaimsTotalContractSum)),
      },
      subStructureAndGround: {
        concreteSlabClass: extraction.subStructureAndGroundConcreteSlabClass,
        concreteStrengthMpa: extraction.subStructureAndGroundConcreteStrengthMpa,
        vapourBarrier: extraction.subStructureAndGroundVapourBarrier,
        termiteSystem: extraction.subStructureAndGroundTermiteSystem,
        sewerConnection: extraction.subStructureAndGroundSewerConnection,
      },
      shellAndExternal: {
        ceilingHeightGroundFloor: extraction.shellAndExternalCeilingHeightGroundFloor,
        ceilingHeightFirstFloor: extraction.shellAndExternalCeilingHeightFirstFloor,
        roofingMaterial: extraction.shellAndExternalRoofingMaterial,
        brickAllowance: extraction.shellAndExternalBrickAllowance,
        brickCount: extraction.shellAndExternalBrickCount,
        selectedBrickPrice: extraction.shellAndExternalSelectedBrickPrice,
        windowProvider: extraction.shellAndExternalWindowProvider,
        floorAreaM2: extraction.shellAndExternalFloorAreaM2,
      },
      mechanicalDetails: {
        acSystemZones: extraction.mechanicalDetailsAcSystemZones,
        acRequiredCapacityKw: extraction.mechanicalDetailsAcRequiredCapacityKw,
        acInstalledCapacityKw: extraction.mechanicalDetailsAcInstalledCapacityKw,
        lightingCount: extraction.mechanicalDetailsLightingCount,
        tenderLightingCount: extraction.mechanicalDetailsTenderLightingCount,
        powerPointCount: extraction.mechanicalDetailsPowerPointCount,
        externalPower: extraction.mechanicalDetailsExternalPower,
        jointSealants: extraction.mechanicalDetailsJointSealants,
      },
      internalFitOutAndFinishes: {
        internalDoorHeight: extraction.internalFitOutAndFinishesInternalDoorHeight,
        skirtingSize: extraction.internalFitOutAndFinishesSkirtingSize,
        stoneThickness: extraction.internalFitOutAndFinishesStoneThickness,
        waterfallEnds: extraction.internalFitOutAndFinishesWaterfallEnds,
        tapwareFinish: extraction.internalFitOutAndFinishesTapwareFinish,
        tilesProvisionRate: extraction.internalFitOutAndFinishesTilesProvisionRate,
        tileAllowance: extraction.internalFitOutAndFinishesTileAllowance,
        selectedTilePrice: extraction.internalFitOutAndFinishesSelectedTilePrice,
        wetAreaSizeM2: extraction.internalFitOutAndFinishesWetAreaSizeM2,
      },
      exclusionsAndRisks: {
        retainingWalls: extraction.exclusionsAndRisksRetainingWalls,
        fencing: extraction.exclusionsAndRisksFencing,
        blinds: extraction.exclusionsAndRisksBlinds,
        solarProvisions: extraction.exclusionsAndRisksSolarProvisions,
        rockExcavation: extraction.exclusionsAndRisksRockExcavation,
        ownerResponsibility: extraction.exclusionsAndRisksOwnerResponsibility,
        variationRequired: extraction.exclusionsAndRisksVariationRequired,
      },
      utilityInfrastructure: {
        electricalPhase: extraction.utilityInfrastructureElectricalPhase,
        communicationConduit: extraction.utilityInfrastructureCommunicationConduit,
        gasConnection: extraction.utilityInfrastructureGasConnection,
        fridgeWaterPoint: extraction.utilityInfrastructureFridgeWaterPoint,
        smartLockBrand: extraction.utilityInfrastructureSmartLockBrand,
      },
      wetAreaCompliance: {
        waterproofingStandard: extraction.wetAreaComplianceWaterproofingStandard,
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
      tender: {
        fileId: sourceDocuments.tender.fileId,
        fileName: sourceDocuments.tender.fileName,
        url: sourceDocuments.tender.url,
        kind: "tender",
      },
      contract: {
        fileId: sourceDocuments.contract.fileId,
        fileName: sourceDocuments.contract.fileName,
        url: sourceDocuments.contract.url,
        kind: "contract",
      },
    },
    [],
  );
}
/**
 * Creates a new project from an existing lead.
 *
 * This is the preferred project creation workflow as it guarantees data
 * consistency between leads, customers, projects, milestones, and activity logs.
 *
 * The entire creation process is executed inside a database transaction and
 * performs the following operations:
 *
 * - Validates that the lead exists.
 * - Ensures the lead has not already been converted into a project.
 * - Creates a customer from the lead details.
 * - Uses the AI project inference agent to determine:
 *   - Project type
 *   - Estimated budget
 *   - Structured project requirements
 * - Creates the project.
 * - Generates the default milestone template.
 * - Records an activity log entry for auditing.
 * - Retrieves the fully populated cached project details.
 * - Schedules cache revalidation after the response is sent.
 * - Sends a project creation notification to the assigned site manager.
 *
 * @param input - Project creation information along with the source lead.
 * @param input.leadId - ID of the lead being converted into a project.
 * @param input.projectName - Name of the new project.
 * @param input.lotSize - Size of the construction lot.
 * @param input.startDate - Planned project start date (ISO string).
 * @param input.estimatedEndDate - Estimated project completion date (ISO string).
 * @param input.address - Project site address.
 * @param input.council - Responsible local council.
 * @param input.siteManagerId - Assigned site manager ID.
 *
 * @returns The complete project details for the newly created project.
 *
 * @throws {Error} `LEAD_NOT_FOUND`
 * Thrown when the specified lead does not exist.
 *
 * @throws {Error} `PROJECT_ALREADY_EXISTS_FOR_LEAD`
 * Thrown when the lead has already been converted into a project.
 *
 * @throws {Error} `PROJECT_DETAIL_NOT_FOUND`
 * Thrown if the project is successfully created but cannot be retrieved afterwards.
 *
 * @throws {Error}
 * Re-throws any database, AI inference, milestone generation, notification,
 * or transaction errors encountered during execution.
 */
export async function createProjectWithLead({ leadId, lotSize, startDate, estimatedEndDate, address, council, siteManagerId, projectName, customerName, customerEmail, customerPhone, customerAddress, parties, extraction, sourceDocuments }: CreateProjectWithLeadInput): Promise<ProjectDetail> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        project: true,
      }
    });

    if (!lead) {
      throw new Error("LEAD_NOT_FOUND");
    }

    if (lead.project) {
      throw new Error("PROJECT_ALREADY_EXISTS_FOR_LEAD");
    }

    const inferredSpecs = extraction
      ? null
      : await handleProjectSpecsGeneration(createLeadProjectInferencePrompt(lead));

    const extractedSummary = extraction && typeof extraction === "object"
      ? (extraction as { summary?: string }).summary ?? ""
      : "";
    const extractedProjectType = extraction && typeof extraction === "object"
      ? (extraction as { projectType?: string }).projectType ?? "Unknown"
      : "Unknown";
    const projectDescription = extractedSummary || inferredSpecs?.projectDescription || "";
    const projectType = extractedProjectType || (inferredSpecs?.projectType ?? "Unknown");
    const normalizedExtraction = extraction ? normalizeExtraction(extraction, sourceDocuments) : null;
    const projectBudget = extraction
      ? (isFlatExtraction(extraction)
        ? extraction.commercialsAndClaimsContractPrice ?? extraction.commercialsAndClaimsTotalContractSum ?? extraction.commercialsAndClaimsTenderTotalPrice ?? 0
        : resolveProjectBudget(extraction))
      : inferredSpecs?.projectBudget ?? 0;
    const projectRequirements = normalizedExtraction
      ? normalizedExtraction
      : buildProjectRequirementsPayload(
        {
          projectName,
          projectType: inferredSpecs?.projectType ?? "",
          summary: inferredSpecs?.projectDescription ?? "",
          legalAdministration: {
            siteAddress: address,
            ownerContacts: {
              names: [lead.name],
              emails: lead.email ? [lead.email] : [],
              phones: lead.phone ? [lead.phone] : [],
            },
            commencementTrigger: "",
            signedDate: "",
            pcaInspector: "",
          },
          commercialsAndClaims: {
            totalContractSum: inferredSpecs?.projectBudget ?? 0,
            tenderTotalPrice: inferredSpecs?.projectBudget ?? 0,
            contractPrice: inferredSpecs?.projectBudget ?? 0,
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
          shellAndExternal: {
            ceilingHeightGroundFloor: "",
            ceilingHeightFirstFloor: "",
            roofingMaterial: "",
            brickAllowance: null,
            brickCount: null,
            selectedBrickPrice: null,
            windowProvider: "",
            floorAreaM2: lotSize,
          },
          mechanicalDetails: {
            acSystemZones: "",
            acRequiredCapacityKw: null,
            acInstalledCapacityKw: null,
            lightingCount: null,
            tenderLightingCount: null,
            powerPointCount: null,
            externalPower: "",
            jointSealants: "",
          },
          internalFitOutAndFinishes: {
            internalDoorHeight: "",
            skirtingSize: "",
            stoneThickness: "",
            waterfallEnds: "",
            tapwareFinish: "",
            tilesProvisionRate: "",
            tileAllowance: null,
            selectedTilePrice: null,
            wetAreaSizeM2: null,
          },
          exclusionsAndRisks: {
            retainingWalls: "",
            fencing: "",
            blinds: "",
            solarProvisions: "",
            rockExcavation: "",
            ownerResponsibility: [],
            variationRequired: [],
          },
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
          tender: {
            fileId: "",
            fileName: "",
            url: "",
            kind: "tender",
          },
          contract: {
            fileId: "",
            fileName: "",
            url: "",
            kind: "contract",
          },
        },
        [],
      );
    const newProjectId = await prisma.$transaction(async (tx) => {
      // Create customer first, then reference by customerId to satisfy Prisma types
      const customer = await createCustomerForProject({
        name: customerName?.trim() || lead.name,
        email: customerEmail?.trim() || lead.email,
        phone: customerPhone?.trim() || lead.phone,
        address: customerAddress ?? null,
      }, tx);

      const normalisedStartDate = new Date(startDate);
      const normalisedEstimatedEndDate = new Date(estimatedEndDate);

      const newProject = await tx.project.create({
        data: {
          leadId: lead.id,
          name: projectName,
          description: projectDescription,
          buildingType: projectType,
          location: address,
          council: council,
          totalBudget: new Prisma.Decimal(projectBudget),
          lotSize: String(lotSize),
          startDate: normalisedStartDate,
          estimatedEndDate: normalisedEstimatedEndDate,
          siteManagerId: siteManagerId,
          requirements: projectRequirements as unknown as Prisma.InputJsonValue,
          ...(parties ? { parties } : {}),
          customerId: customer.id,
        }
      });

      await createMilestonesFromTemplateForProject(newProject.id, normalisedStartDate, tx);

      const activityLogEntry = createActivityLogEntry("projectCreated", {
        projectType: projectType,
        customerEmail: customer.email,
        customerPhone: customer.phone,
        projectId: newProject.id,
        projectName: newProject.name,
        location: newProject.location,
        customerName: customer.name
      });
      await logAction(activityLogEntry, tx);
      await tx.file.updateMany({
        where: {
          OR: [
            {
              url: {
                in: [sourceDocuments.tender.url, sourceDocuments.contract.url]
              }
            },
            {
              leadId: lead.id
            }
          ]
        },
        data: {
          projectId: newProject.id
        }
      })

      return newProject.id;
    });

    // The customer was created/updated INSIDE the transaction above, so its cache
    // invalidation is deferred to here — firing it pre-commit let another request
    // refill the "customers" cache from uncommitted data with nothing to correct
    // it afterwards (PR #124 review). Runs before the detail read so the tag is
    // cleared even if that read fails.
    revalidateTag("customers", CACHE_PROFILES.MEDIUM);

    const newProjectDetail = await getCachedProjectById(newProjectId);
    if (!newProjectDetail) {
      throw new Error("PROJECT_DETAIL_NOT_FOUND");
    }

    after(async () => {
      revalidateTag("projects", CACHE_PROFILES.MEDIUM);
      revalidateTag(`project-${newProjectDetail.id}`, CACHE_PROFILES.MEDIUM);

      const notificationPayload = createNotification("projectCreated", {
        projectId: newProjectDetail.id,
        projectName: newProjectDetail.name,
        projectType: newProjectDetail.buildingType,
        location: newProjectDetail.location,
        customerName: newProjectDetail.customer.name,
        customerEmail: newProjectDetail.customer.email,
        customerPhone: newProjectDetail.customer.phone,
      });
      await triggerNotification(newProjectDetail.siteManagerId ? [newProjectDetail.siteManagerId] : [], notificationPayload);
    })

    return newProjectDetail;
  } catch (error) {
    console.error("Error creating project from lead:", error);
    if (error instanceof Error) {
      switch (error.message) {
        case "LEAD_NOT_FOUND":
          throw new Error(`Lead with ID ${leadId} not found.`);
        case "PROJECT_ALREADY_EXISTS_FOR_LEAD":
          throw new Error(`A project has already been created for lead ID ${leadId}.`);
        case "PROJECT_DETAIL_NOT_FOUND":
          throw new Error(`Project was created but could not be retrieved for lead ID ${leadId}.`);
        default:
          throw new Error(`An unexpected error occurred while creating the project: ${error.message}`);
      }
    }
    else {
      throw new Error("An unknown error occurred while creating the project.");
    }
  }
}