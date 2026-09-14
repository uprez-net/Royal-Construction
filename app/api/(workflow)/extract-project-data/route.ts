import { start } from "workflow/api";
import { extractTenderAndContractDocuments } from "@/lib/workflow/project";
import {
    RUN_CAPABILITY_SECRET_ENV,
    runCapabilitySecret,
    signRunCapability,
} from "@/lib/workflow/run-capability";
import {
    badRequestResponse,
    errorResponse,
    successResponse,
    unauthorizedResponse,
} from "@/utils/validators/response";
import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/data/user";
import z from "zod";

const tenderExtractionSchema = z.object({
    tenderUrl: z.url(),
    contractUrl: z.url(),
    tenderFileName: z.string().min(1),
    contractFileName: z.string().min(1),
    leadId: z.number().int().positive(),
});

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

    const validationResult = tenderExtractionSchema.safeParse(body);
    if (!validationResult.success) {
        return badRequestResponse("Invalid request body");
    }

    // Checked before start(): without the secret no one could follow the run,
    // and it would still spend the whole extraction.
    if (!runCapabilitySecret()) {
        console.error(`${RUN_CAPABILITY_SECRET_ENV} is not set; not starting tender extraction`);
        return errorResponse("Failed to start offer creation workflow.");
    }

    try {
        // Executes asynchronously and doesn't block your app
        const run = await start(extractTenderAndContractDocuments, [validationResult.data]);

        console.log("Started run", run.runId);

        return successResponse({
            // The client only hands this to /api/resume-stream, which accepts
            // nothing but a capability issued to the same user.
            runId: signRunCapability({ runId: run.runId, userId: user.id }),
            message: "Creating offer workflow started",
        });
    } catch (error) {
        console.error("Error starting workflow:", error);
        return errorResponse("Failed to start offer creation workflow.");
    }
}
