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
export async function createProjectWithLead({ leadId, lotSize, startDate, estimatedEndDate, address, council, siteManagerId, projectName }: CreateProjectWithLeadInput): Promise<ProjectDetail> {
  try {
    const newProjectId = await prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findUnique({
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

      // Create customer first, then reference by customerId to satisfy Prisma types
      const customer = await createCustomerForProject({
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
      }, tx);

      const {
        projectType,
        projectBudget,
        projectRequirements
      } = await handleProjectSpecsGeneration(createLeadProjectInferencePrompt(lead));

      const newProject = await tx.project.create({
        data: {
          leadId: lead.id,
          name: projectName,
          buildingType: projectType,
          description: lead.notes,
          location: address,
          council: council,
          totalBudget: projectBudget,
          lotSize: String(lotSize),
          startDate: new Date(startDate),
          estimatedEndDate: new Date(estimatedEndDate),
          siteManagerId: siteManagerId,
          requirements: projectRequirements,
          customerId: customer.id,
        }
      });

      await createMilestonesFromTemplateForProject(newProject.id, new Date(startDate), tx);

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

      return newProject.id;
    });

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
    throw error;
  }
}