import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createUser } from "@/lib/data/user";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      name,
      type,
      customerName,
      customerPhone,
      customerEmail,
      location,
      siteManagerId,
      budget,
      startDate,
      estEnd,
      notes,
    } = body;

    if (!name || !customerName || !customerPhone || !location || !startDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // find existing customer by email or phone
    let customer = null;
    if (customerEmail) {
      customer = await prisma.customer.findUnique({ where: { email: customerEmail } });
    }
    if (!customer) {
      customer = await prisma.customer.findUnique({ where: { phone: customerPhone } }).catch(() => null);
    }

    // if no customer, create a lightweight user+customer using generated clerkId
    if (!customer) {
      const clerkId = typeof crypto !== "undefined" && (crypto as any).randomUUID ? (crypto as any).randomUUID() : String(Date.now());
      const created = await createUser(customerName, customerEmail ?? `${customerPhone}@local`, clerkId, customerPhone);
      if (!created || !created.customerId) {
        return NextResponse.json({ error: "Failed to create customer" }, { status: 500 });
      }
      customer = await prisma.customer.findUnique({ where: { id: created.customerId } });
    }

    const project = await prisma.project.create({
      data: {
        name,
        description: notes ?? null,
        customerId: customer!.id,
        location,
        siteManagerId: siteManagerId || null,
        totalBudget: String(budget ?? 0),
        startDate: new Date(startDate),
        estimatedEndDate: estEnd ? new Date(estEnd) : new Date(startDate),
        requirements: notes ? { notes } : undefined,
      },
      include: {
        customer: true,
        siteManager: true,
      },
    });

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error("/api/projects POST error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
import { auth } from "@clerk/nextjs/server";
import { ProjectStatus } from "@prisma/client";

import { getProjects } from "@/lib/data/projects";

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const projectStatus = status && Object.values(ProjectStatus).includes(status as ProjectStatus) ? (status as ProjectStatus) : undefined;
  const projects = await getProjects(projectStatus ? { status: projectStatus } : undefined);

  return Response.json(projects);
}
