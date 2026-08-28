import { auth } from "@clerk/nextjs/server";
import { start } from "workflow/api";

import { getUserByClerkId } from "@/lib/data/user";
import prisma from "@/lib/prisma";
import { extractComplianceChecklist } from "@/lib/workflow/compliance-checklist";
import { checklistExtractionRequestSchema } from "@/utils/validators/compliance";
import {
    badRequestResponse,
    errorResponse,
    notFoundResponse,
    successResponse,
    unauthorizedResponse,
} from "@/utils/validators/response";

export async function POST(request: Request) {
    const { userId } = await auth();
    if (!userId) {
        return unauthorizedResponse();
    }

    const user = await getUserByClerkId(userId);
    if (!user) {
        return unauthorizedResponse("User not found");
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return badRequestResponse("Invalid JSON in request body");
    }

    const validationResult = checklistExtractionRequestSchema.safeParse(body);
    if (!validationResult.success) {
        return badRequestResponse("Invalid request body");
    }

    const input = validationResult.data;

    // The three ids are checked against each other rather than trusted
    // individually: without this, any signed-in user could point the extraction
    // at a document on someone else's engagement by supplying a matching pair.
    const document = await prisma.complianceDocument.findFirst({
        where: {
            id: input.documentId,
            engagementId: input.engagementId,
            engagement: { projectId: input.projectId },
        },
        select: { id: true },
    });
    if (!document) {
        return notFoundResponse("Checklist document not found on this project.");
    }

    try {
        // Executes asynchronously and doesn't block the response; the client
        // follows progress on /api/resume-stream/<runId>.
        const run = await start(extractComplianceChecklist, [input]);

        console.log("Started checklist extraction run", run.runId);

        return successResponse({
            runId: run.runId,
            message: "Checklist extraction workflow started",
        });
    } catch (error) {
        console.error("Error starting checklist extraction workflow:", error);
        return errorResponse("Failed to start the checklist extraction workflow.");
    }
}
