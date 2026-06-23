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
import { Prisma } from "@prisma/client";

/**
 * @deprecated This function is not to be used use `createProjectWithLead` instead which creates a project directly from a lead and ensures data consistency.
 * Creates a new project with the provided data. Handles both existing and new customers, and optionally associates a site manager.
 * Also triggers a notification for the site manager if assigned.
 * @param projectData 
 * @returns new project ID
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


  revalidateTag("projects", CACHE_PROFILES.MEDIUM);
  revalidateTag(`project-${project.id}`, CACHE_PROFILES.MEDIUM);

  return project.id;
}

export interface CreateProjectWithLeadInput {
  leadId: number;
  lotSize: number;
  startDate: string;
  estimatedEndDate: string;
  address: string;
  council: string;
  siteManagerId: string;
}

const parseBudget = (value: unknown): Prisma.Decimal => {
  if (Prisma.Decimal.isDecimal(value)) {
    return value;
  }

  const normalized = String(value ?? "")
    .replace(/[^0-9.-]/g, "");

  return normalized && !isNaN(Number(normalized))
    ? new Prisma.Decimal(normalized)
    : new Prisma.Decimal(0);
};

export async function createProjectWithLead({ leadId, lotSize, startDate, estimatedEndDate, address, council, siteManagerId }: CreateProjectWithLeadInput): Promise<ProjectDetail> {
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

      const projectType = lead.type.length > 0 ? lead.type.join(", ") : "General Construction";
      const totalBudget = parseBudget(lead.budget);
      // TBD: We can use AI to infer requirements based on lead notes and data
      const inferredRequirements = [
        'Garage',
        'Garden',
        'Swimming Pool',
        'Solar Panels',
        'Home Office',
        'Open Plan Living',
        'Sustainable Materials',
        'Smart Home Integration',
      ]

      const newProject = await tx.project.create({
        data: {
          leadId: lead.id,
          name: `${projectType} at ${lead.location}`,
          buildingType: projectType,
          description: lead.notes,
          location: address,
          council: council,
          totalBudget: totalBudget,
          lotSize: String(lotSize),
          startDate: new Date(startDate),
          estimatedEndDate: new Date(estimatedEndDate),
          siteManagerId: siteManagerId,
          requirements: inferredRequirements,
          customerId: customer.id,
        }
      });

      await createMilestonesFromTemplateForProject(newProject.id, new Date(startDate), tx);

      return newProject.id;
    });

    const newProjectDetail = await getCachedProjectById(newProjectId);
    if (!newProjectDetail) {
      throw new Error("PROJECT_DETAIL_NOT_FOUND");
    }

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


    revalidateTag("projects", CACHE_PROFILES.MEDIUM);
    revalidateTag(`project-${newProjectDetail.id}`, CACHE_PROFILES.MEDIUM);

    return newProjectDetail;
  } catch (error) {
    console.error("Error creating project from lead:", error);
    throw error;
  }
}