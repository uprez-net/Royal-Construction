import { start } from "workflow/api";
import { createOfferWorkflow } from "@/lib/workflow/offer";
import {
    badRequestResponse,
    errorResponse,
    notFoundResponse,
    successResponse,
    unauthorizedResponse,
} from "@/utils/validators/response";
import prisma from "@/lib/prisma";
import { RunStatus } from "@prisma/client";
import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/data/user";

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

    const leadId = typeof body === "object" && body !== null && "leadId" in body
        ? (body as { leadId?: unknown }).leadId
        : undefined;

    if (typeof leadId !== "number" || !Number.isInteger(leadId) || leadId <= 0) {
        return badRequestResponse("Invalid leadId. It must be a positive integer.");
    }

    try {
        const lead = await prisma.lead.findUnique({
            where: { id: leadId },
            select: { id: true, runId: true },
        });

        if (!lead) {
            return notFoundResponse("Lead");
        }

        if (lead.runId) {
            return successResponse({
                runId: lead.runId,
                message: "Offer creation workflow already in progress",
            });
        }

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
