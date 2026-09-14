import { auth } from "@clerk/nextjs/server";
import { start } from "workflow/api";

import {
    complianceAccessResponse,
    requireComplianceAccess,
} from "@/lib/compliance/access";
import { getUserByClerkId } from "@/lib/data/user";
import prisma from "@/lib/prisma";
import { extractComplianceChecklist } from "@/lib/workflow/compliance-checklist";
import {
    RUN_CAPABILITY_SECRET_ENV,
    runCapabilitySecret,
    signRunCapability,
} from "@/lib/workflow/run-capability";
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

    // The caller must be allowed on the project, under the same gate as every
    // other compliance route. Matching ids alone prove nothing: they are all
    // visible to anyone who has seen the project.
    try {
        await requireComplianceAccess(input.projectId);
    } catch (error) {
        const refusal = complianceAccessResponse(error);
        if (refusal) return refusal;
        console.error("Failed to authorize checklist extraction", error);
        return errorResponse("Failed to start the checklist extraction workflow.");
    }

    // The three ids are checked against each other rather than trusted
    // individually: without this, a caller allowed on one project could point
    // the extraction at a document on another project's engagement.
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

    // Checked before start(): without the secret no one could follow the run,
    // and it would still spend the whole extraction.
    if (!runCapabilitySecret()) {
        console.error(`${RUN_CAPABILITY_SECRET_ENV} is not set; not starting checklist extraction`);
        return errorResponse("Failed to start the checklist extraction workflow.");
    }

    try {
        // Executes asynchronously and doesn't block the response; the client
        // follows progress on /api/resume-stream/<runId>.
        const run = await start(extractComplianceChecklist, [input]);

        console.log("Started checklist extraction run", run.runId);

        return successResponse({
            // A capability bound to this user rather than the bare run id:
            // resume-stream refuses anything else.
            runId: signRunCapability({ runId: run.runId, userId: user.id }),
            message: "Checklist extraction workflow started",
        });
    } catch (error) {
        console.error("Error starting checklist extraction workflow:", error);
        return errorResponse("Failed to start the checklist extraction workflow.");
    }
}
