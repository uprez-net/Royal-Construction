import {
  badRequestResponse,
  errorResponse,
  notFoundResponse,
  successResponse,
  updateLeadSchema,
} from "@/utils/validators";
import { findLeadById, updateLead, deleteLead } from "@/lib/data/leads";
import { isLeadValidationError } from "@/lib/leads/lead-validation-error";

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ leadId: string }> },
) {
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
      const fieldErrors = parsed.error.flatten().fieldErrors;
      console.warn("/api/leads PATCH validation error", {
        leadId: id,
        issues: fieldErrors,
      });
      // Name the offending field. `parsed.error.message` is a raw Zod JSON
      // blob, which the lead modal could only render as a generic "please try
      // again" toast — so a legacy lead with an empty email (schema default,
      // rejected by requiredLeadEmail) failed every save with no clue why.
      const summary = Object.entries(fieldErrors)
        .map(([field, messages]) => `${field}: ${(messages ?? []).join(", ")}`)
        .join("; ");
      return badRequestResponse(summary || parsed.error.message);
    }
    const updated = await updateLead(id, parsed.data);
    return successResponse(updated);
  } catch (error) {
    // A rule the caller can satisfy is a 400 carrying the reason, not a 500
    // saying "failed". Without this the stage dropdown in the lead header —
    // which sends a stage and nothing else — just fails, and the user never
    // learns that closing a lead needs a reason.
    if (isLeadValidationError(error)) {
      console.warn("/api/leads PATCH rejected", { reason: error.message });
      return badRequestResponse(error.message);
    }
    console.error("/api/leads PATCH error", error);
    return errorResponse("Failed to update lead", {
      status: 500,
      code: "LEAD_UPDATE_FAILED",
    });
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ leadId: string }> },
) {
  try {
    const { leadId } = await ctx.params;
    const id = Number(leadId);

    if (!Number.isFinite(id)) {
      return badRequestResponse("Invalid lead id.");
    }

    const existing = await findLeadById(id);
    if (!existing) return notFoundResponse("Lead");

    await deleteLead(id);

    return successResponse({
      success: true,
      message: "Lead deleted successfully",
    });
  } catch (error) {
    console.error("/api/leads DELETE error", error);
    return errorResponse("Failed to delete lead", {
      status: 500,
      code: "LEAD_DELETE_FAILED",
    });
  }
}
