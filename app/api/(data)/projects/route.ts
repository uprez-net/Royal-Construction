import { auth } from "@clerk/nextjs/server";
import { getCachedProjectById, getCachedProjects, getCachedProjectsForLookup } from "@/lib/data/projects";
import { createProject } from "@/lib/data/projectsWrite";
import { createCustomerForProject, findCustomerByContact, findCustomerById } from "@/lib/data/customers";
import {
  createProjectSchema,
  projectListQuerySchema,
  projectLookupQuerySchema,
  parseSearchParamsWithResponse,
  successResponse,
  unauthorizedResponse,
  notFoundResponse,
  parseBodyWithResponse,
  errorResponse,
} from "@/utils/validators";
import { NextRequest } from "next/server";
import { getSiteManagerById } from "@/lib/data/siteManagers";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");

  // Handle lookup mode
  if (mode === "lookup") {
    const params = parseSearchParamsWithResponse(url, projectLookupQuerySchema);
    if (!params.success) return params.response;

    const result = await getCachedProjectsForLookup(
      params.data.page,
      params.data.limit,
      params.data.q,
    );

    return successResponse(result);
  }

  // Handle main list mode
  const params = parseSearchParamsWithResponse(url, projectListQuerySchema);
  if (!params.success) return params.response;

  const projects = await getCachedProjects({
    status: params.data.status,
    page: params.data.page,
    limit: params.data.limit,
    search: params.data.search,
    sortBy: params.data.sortBy,
    sortOrder: params.data.sortOrder,
  });

  return successResponse(projects);
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return unauthorizedResponse();
  }

  try {
    const body = await parseBodyWithResponse(request, createProjectSchema);
    if (!body.success) return body.response;

    const projectData = body.data;
    const customerMode = projectData.customerMode;

    let customerId = "";

    if (customerMode === "existing") {
      const existingCustomer = await findCustomerById(projectData.customerId!);
      if (!existingCustomer) {
        return notFoundResponse("Customer");
      }
      customerId = existingCustomer.id;
    } else {
      const existingCustomer = await findCustomerByContact(
        projectData.customerEmail!,
        projectData.customerPhone!,
      );
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
    // Quote file handling can be implemented here if needed, e.g., saving to storage and linking to project
    const qutoeFile = projectData.quoteFile;
    console.log("Received quote file:", qutoeFile?.name);

    if (siteManagerId) {
      siteManager = await getSiteManagerById(siteManagerId);
      if (!siteManager) {
        return notFoundResponse("Site Manager");
      }
    }

    const projectId = await createProject(projectData);

    const createdProject = await getCachedProjectById(projectId);

    if (!createdProject) {
      return errorResponse("Project was created but could not be loaded", {
        status: 500,
        code: "POST_LOAD_FAILED",
      });
    }

    return successResponse(createdProject, { status: 201 });
  } catch (error) {
    console.error("/api/projects POST error", error);
    return errorResponse("Failed to create project", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}
