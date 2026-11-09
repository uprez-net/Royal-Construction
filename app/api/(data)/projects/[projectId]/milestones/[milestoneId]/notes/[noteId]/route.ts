import { currentPrincipal } from "@/lib/data/current-principal";
import { deleteMilestoneNote } from "@/lib/domain/projects/milestone-notes";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { errorResponse, successResponse } from "@/utils/validators/response";

/** Deletes one staff note, for its author or an admin. */
export async function DELETE(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ projectId: string; milestoneId: string; noteId: string }>;
  },
) {
  try {
    const { milestoneId, noteId } = await params;
    return successResponse(
      await deleteMilestoneNote(
        await currentPrincipal(),
        { milestoneId, noteId },
        prisma,
      ),
    );
  } catch (error) {
    const refused = domainErrorResponse(error);
    if (refused) return refused;
    console.error("Milestone note delete failed", error);
    return errorResponse("Could not delete the note. Try again.", {
      status: 500,
    });
  }
}
