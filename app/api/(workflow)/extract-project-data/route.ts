import { start } from "workflow/api";
import { extractTenderAndContractDocuments } from "@/lib/workflow/project";
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

    try {
        // Executes asynchronously and doesn't block your app
        const run = await start(extractTenderAndContractDocuments, [validationResult.data]);

        console.log("Started run", run.runId);

        return successResponse({
            runId: run.runId,
            message: "Creating offer workflow started",
        });
    } catch (error) {
        console.error("Error starting workflow:", error);
        return errorResponse("Failed to start offer creation workflow.");
    }
}
