import prisma from "@/lib/prisma";
import { mapLead, stageToPrismaMap } from "@/types/lead";
import { badRequestResponse, errorResponse, notFoundResponse, successResponse, updateLeadSchema } from "@/utils/validators";

export async function PATCH(request: Request, ctx: { params: Promise<{ leadId: string }> }) {
  try {
    const { leadId } = await ctx.params;
    const id = Number(leadId);

    if (!Number.isFinite(id)) {
      return badRequestResponse("Invalid lead id.");
    }

    const existing = await prisma.lead.findUnique({ where: { id } });
    if (!existing) {
      return notFoundResponse("Lead");
    }

    const json = await request.json();
    const parsed = updateLeadSchema.safeParse(json);

    if (!parsed.success) {
      return badRequestResponse(parsed.error.message);
    }

    const body = parsed.data;
    const mappedStage = body.stage ? stageToPrismaMap[body.stage] : undefined;

    //console.log("Updating lead with id:", id, "and data:", body);
    const updatedLead = await prisma.lead.update({
      where: { id },
      data: {
        ...(body?.name !== undefined && { name: String(body.name) }),
        ...(body?.phone !== undefined && { phone: body.phone ?? "" }),
        ...(body?.email !== undefined && { email: body.email ?? "" }),
        ...(body?.location !== undefined && { location: body.location ?? "" }),
        ...(body?.source !== undefined && { source: body.source }),
        ...(body?.sourceDetail !== undefined && { sourceDetail: body.sourceDetail }),
        ...(body?.stage !== undefined && { stage: mappedStage }),
        ...(body?.assigned !== undefined && { assigned: body.assigned }),
        ...(body?.budget !== undefined && { budget: body.budget }),
        ...(body?.type !== undefined && { type: body.type }),
        ...(body?.notes !== undefined && { notes: body.notes }),
        ...(body?.followupDate !== undefined && { followupDate: body.followupDate }),
        ...(body?.followupTime !== undefined && { followupTime: body.followupTime }),
        ...(body?.followupNotes !== undefined && { followupNotes: body.followupNotes }),
        ...(body?.lostReason !== undefined && { lostReason: body.lostReason }),
        ...(body?.urgent !== undefined && { urgent: Boolean(body.urgent) }),
        ...(body?.history && {
          history: {
            deleteMany: {},
            create: body.history.map((h: any) => ({
              action: h.action,
              detail: h.detail || "",
              type: h.type ? h.type.toUpperCase() : "SYSTEM",
              actionDate: new Date(`${h.date}T${h.time || '00:00'}`),
            })),
          }
        }),
      },
      include: {
        history: {
          orderBy: { actionDate: "asc" },
        },
      },
    });

    return successResponse(mapLead(updatedLead));
  } catch (error) {
    console.error("/api/leads PATCH error", error);
    return errorResponse("Failed to update lead", {
      status: 500,
      code: "LEAD_UPDATE_FAILED",
    });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ leadId: string }> }) {
  try {
    const { leadId } = await ctx.params;
    const id = Number(leadId);

    if (!Number.isFinite(id)) {
      return badRequestResponse("Invalid lead id.");
    }

    const existing = await prisma.lead.findUnique({ where: { id } });
    if (!existing) {
      return notFoundResponse("Lead");
    }

    await prisma.lead.delete({ where: { id } });

    return successResponse({ success: true, message: "Lead deleted successfully" });
  } catch (error) {
    console.error("/api/leads DELETE error", error);
    return errorResponse("Failed to delete lead", {
      status: 500,
      code: "LEAD_DELETE_FAILED",
    });
  }
}
