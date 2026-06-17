import { badRequestResponse, errorResponse, notFoundResponse, successResponse, updateLeadSchema } from "@/utils/validators";
import { findLeadById, updateLead, deleteLead } from "@/lib/data/leads";

export async function PATCH(request: Request, ctx: { params: Promise<{ leadId: string }> }) {
  try {
    const { leadId } = await ctx.params;
    const id = Number(leadId);

    if (!Number.isFinite(id)) {
      return badRequestResponse("Invalid lead id.");
    }

    const existing = await findLeadById(id);
    if (!existing) return notFoundResponse("Lead");

    const json = await request.json();
    const parsed = updateLeadSchema.safeParse(json);

    if (!parsed.success) {
      console.warn("/api/leads PATCH validation error", {
        leadId: id,
        issues: parsed.error.flatten().fieldErrors,
      });
      return badRequestResponse(parsed.error.message);
    }
    const updated = await updateLead(id, parsed.data);
    return successResponse(updated);
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

    const existing = await findLeadById(id);
    if (!existing) return notFoundResponse("Lead");

    await deleteLead(id);

    return successResponse({ success: true, message: "Lead deleted successfully" });
  } catch (error) {
    console.error("/api/leads DELETE error", error);
    return errorResponse("Failed to delete lead", {
      status: 500,
      code: "LEAD_DELETE_FAILED",
    });
  }
}
