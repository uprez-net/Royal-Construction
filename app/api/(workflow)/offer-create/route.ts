import { start } from "workflow/api";
import { createOfferWorkflow } from "@/lib/workflow/offer";
import { errorResponse, successResponse } from "@/utils/validators/response";
import prisma from "@/lib/prisma";
import { RunStatus } from "@prisma/client";

export async function POST(request: Request) {
    const { leadId } = await request.json();

    if (leadId === undefined || typeof leadId !== "number") {
        return errorResponse("Invalid leadId. It must be a number.");
    }
    try {
        // Executes asynchronously and doesn't block your app
        const run = await start(createOfferWorkflow, [leadId]);
        await prisma.lead.update({
            where: { id: leadId },
            data: {
                runId: run.runId, // Store the runId to track workflow status
                runStatus: RunStatus.RUNNING, // Store the initial status
            }
        });

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