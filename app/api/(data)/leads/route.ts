import prisma from "@/lib/prisma";
import type { LeadStage } from "@/lib/leads/types";
import { badRequestResponse, createLeadSchema, errorResponse, successResponse } from "@/utils/validators";
import { historyTypeToPrisma, mapLead, stageToPrismaMap } from "@/types/lead";

export async function GET() {
  try {
    console.log("Fetching leads from database...");
    const leads = await prisma.lead.findMany({
      include: {
        history: {
          orderBy: { actionDate: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return successResponse(leads.map(mapLead));
  } catch (error) {
    console.error("/api/leads GET error", error);
    return errorResponse("Failed to fetch leads", {
      status: 500,
      code: "LEADS_FETCH_FAILED",
    });
  }
}

export async function POST(request: Request) {
  try {
    const json = await request.json();

    const parsed = createLeadSchema.safeParse(json);

    if (!parsed.success) {
      return badRequestResponse(
        parsed.error.message,
      );
    }

    const body = parsed.data;
    const stageValue = body?.stage as LeadStage | undefined;
    const mappedStage = stageValue ? stageToPrismaMap[stageValue] : "NEW";

    if (stageValue && !mappedStage) {
      return badRequestResponse("Invalid lead stage.");
    }


    const historyInput = Array.isArray(body?.history) ? body.history : [];
    const historyCreate = historyInput.map((entry) => {
      const action = entry.action;
      const detail = entry.detail;
      const typeKey = entry.type;
      const type = historyTypeToPrisma[typeKey];
      const actionDate = entry.actionDate ?? new Date();
      return {
        action,
        detail,
        type,
        actionDate,
      };
    });

    if (historyCreate.length === 0) {
      historyCreate.push({
        action: "Lead created",
        detail: "Lead manually created",
        type: "SYSTEM",
        actionDate: new Date(),
      });
    }

    const createdLead = await prisma.lead.create({
      data: {
        name: body.name,
        phone: body.phone ?? "",
        email: body.email ?? "",
        location: body.location ?? "",
        source: body.source,
        sourceDetail: body.sourceDetail,
        stage: mappedStage,
        assigned: body.assigned,
        budget: body.budget,
        type: body.type,
        notes: body.notes,
        followupDate: body.followupDate,
        followupTime: body.followupTime,
        followupNotes: body.followupNotes,
        lostReason: body.lostReason,
        urgent: body.urgent ?? false,
        history: {
          create: historyCreate,
        },
      },
      include: {
        history: {
          orderBy: { actionDate: "asc" },
        },
      },
    });

    return successResponse(mapLead(createdLead), { status: 201 });
  } catch (error) {
    console.error("/api/leads POST error", error);
    return errorResponse("Failed to create lead", {
      status: 500,
      code: "LEAD_CREATE_FAILED",
    });
  }
}
