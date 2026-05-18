import { auth } from "@clerk/nextjs/server";
import { ProjectStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import prisma from "@/lib/prisma";
import { getCachedProjectById, getCachedProjects, getCachedProjectsForLookup, type ProjectListSortBy } from "@/lib/data/projects";
import { createCustomerForProject, findCustomerByContact, findCustomerById } from "@/lib/data/customers";
import { getSiteManagerById } from "@/lib/data/siteManagers";

type CreateProjectPayload = {
  name?: string;
  propertyType?: string;
  type?: string;
  customerMode?: "existing" | "new";
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  location?: string;
  siteManagerId?: string | null;
  budget?: string | number;
  lotSize?: string | number;
  startDate?: string;
  estimatedEndDate?: string | null;
  estEnd?: string | null;
  notes?: string;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");
  const status = url.searchParams.get("status");
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "12", 10);
  const search = url.searchParams.get("search") ?? "";
  const lookupQuery = url.searchParams.get("q") ?? "";

  if (mode === "lookup") {
    const result = await getCachedProjectsForLookup(page, limit, lookupQuery);
    return NextResponse.json(result);
  }

  const sortBy = url.searchParams.get("sortBy") as ProjectListSortBy | null;
  const sortOrder = url.searchParams.get("sortOrder") === "desc" ? "desc" : "asc";
  const projectStatus = status && Object.values(ProjectStatus).includes(status as ProjectStatus) ? (status as ProjectStatus) : undefined;
  const projects = await getCachedProjects({
    status: projectStatus,
    page,
    limit,
    search,
    sortBy: sortBy ?? undefined,
    sortOrder,
  });

  return NextResponse.json(projects);
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as CreateProjectPayload;
    const projectName = body.name?.trim();
    const propertyType = body.propertyType?.trim() || body.type?.trim() || "Custom Build";
    const customerMode = body.customerMode ?? (body.customerId ? "existing" : "new");
    const location = body.location?.trim();
    const startDate = body.startDate?.trim();
    const totalBudget = Number(body.budget ?? 0);
    const lotSize = Number(body.lotSize ?? 0);
    const estimatedEndDate = body.estimatedEndDate ?? body.estEnd ?? null;

    if (!projectName || !location || !startDate || !Number.isFinite(totalBudget) || !Number.isFinite(lotSize)) {
      return NextResponse.json({ error: "Missing required project fields" }, { status: 400 });
    }

    let customerId = "";

    if (customerMode === "existing") {
      if (!body.customerId) {
        return NextResponse.json({ error: "Customer selection is required" }, { status: 400 });
      }

      const existingCustomer = await findCustomerById(body.customerId);
      if (!existingCustomer) {
        return NextResponse.json({ error: "Selected customer was not found" }, { status: 404 });
      }
      customerId = existingCustomer.id;
    } else {
      const customerName = body.customerName?.trim();
      const customerPhone = body.customerPhone?.trim();
      const customerEmail = body.customerEmail?.trim();

      if (!customerName || !customerPhone || !customerEmail) {
        return NextResponse.json({ error: "New customer details are required" }, { status: 400 });
      }

      const existingCustomer = await findCustomerByContact(customerEmail, customerPhone);
      if (existingCustomer) {
        customerId = existingCustomer.id;
      } else {
        const createdCustomer = await createCustomerForProject({
          name: customerName,
          email: customerEmail,
          phone: customerPhone,
        });
        customerId = createdCustomer.id;
      }
    }

    const siteManagerId = body.siteManagerId?.trim() || null;
    let siteManager = null;

    if (siteManagerId) {
      siteManager = await getSiteManagerById(siteManagerId);
      if (!siteManager) {
        return NextResponse.json({ error: "Selected site manager was not found" }, { status: 404 });
      }
    }

    const project = await prisma.project.create({
      data: {
        name: projectName,
        description: body.notes?.trim() || null,
        customerId,
        location,
        siteManagerId: siteManager?.id ?? null,
        totalBudget: String(totalBudget),
        lotSize: String(lotSize),
        startDate: new Date(startDate),
        estimatedEndDate: estimatedEndDate ? new Date(estimatedEndDate) : new Date(startDate),
        requirements: {
          propertyType,
          notes: body.notes?.trim() || null,
          customerMode,
        },
      },
    });

    revalidateTag("projects", "max");
    revalidateTag(`project-${project.id}`, "max");

    const createdProject = await getCachedProjectById(project.id);

    if (!createdProject) {
      return NextResponse.json({ error: "Project was created but could not be loaded" }, { status: 500 });
    }

    return NextResponse.json(createdProject, { status: 201 });
  } catch (error) {
    console.error("/api/projects POST error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
