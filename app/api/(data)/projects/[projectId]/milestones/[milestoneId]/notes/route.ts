import { z } from "zod";

import { currentPrincipal } from "@/lib/data/current-principal";
import { addMilestoneNote } from "@/lib/domain/projects/milestone-notes";
import { MILESTONE_NOTE_MAX_LENGTH } from "@/lib/domain/projects/milestone-note-rules";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  successResponse,
  validationErrorResponse,
} from "@/utils/validators/response";

// The cap is the domain's; the extra room lets surrounding whitespace through
// to be trimmed there, rather than refusing a note that fits once trimmed.
const addNoteSchema = z.object({
  body: z.string().max(MILESTONE_NOTE_MAX_LENGTH + 200),
});

/** Adds a staff note to one activity. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; milestoneId: string }> },
) {
  try {
    const { milestoneId } = await params;
    const input = addNoteSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!input.success) return validationErrorResponse(input.error);
    const note = await addMilestoneNote(
      await currentPrincipal(),
      { milestoneId, body: input.data.body },
      prisma,
    );
    return successResponse(note, { status: 201 });
  } catch (error) {
    const refused = domainErrorResponse(error);
    if (refused) return refused;
    console.error("Milestone note add failed", error);
    return errorResponse("Could not save the note. Try again.", {
      status: 500,
    });
  }
}
