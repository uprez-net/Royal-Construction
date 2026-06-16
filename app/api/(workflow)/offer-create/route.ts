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
import { v4 as uuidv4 } from "uuid";
import { LeadAccessError, assertCanAccessLead } from "@/lib/offer/access";
import { getOfferRunStartDecision } from "@/lib/offer/run-state";
import { revalidateTag } from "next/cache";
import { CACHE_PROFILES } from "@/types/cache";

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
            select: { id: true, runId: true, runStatus: true },
        });

        if (!lead) {
            return notFoundResponse("Lead");
        }

        await assertCanAccessLead(user, leadId);

        const decision = getOfferRunStartDecision(lead);
        if (decision.kind === "reuse") {
            return successResponse({
                runId: decision.runId,
                message: decision.message,
            });
        }

        const pendingRunId = `pending:${uuidv4()}`;
        const claim = await prisma.lead.updateMany({
            where: {
                id: leadId,
                OR: [
                    { runId: null },
                    { runStatus: { in: [RunStatus.COMPLETED, RunStatus.FAILED] } },
                ],
            },
            data: {
                runId: pendingRunId,
                runStatus: RunStatus.RUNNING,
            },
        });
        revalidateTag(`chat-session-lead-${leadId}`, CACHE_PROFILES.SHORT);

        if (claim.count === 0) {
            const currentLead = await prisma.lead.findUnique({
                where: { id: leadId },
                select: { runId: true, runStatus: true },
            });
            const currentDecision = currentLead
                ? getOfferRunStartDecision(currentLead)
                : null;

            if (currentDecision?.kind === "reuse") {
                return successResponse({
                    runId: currentDecision.runId,
                    message: currentDecision.message,
                });
            }

            return errorResponse("Failed to claim lead for offer creation.");
        }

        // Executes asynchronously and doesn't block your app
        let run: { runId: string };
        try {
            run = await start(createOfferWorkflow, [leadId]);
        } catch (error) {
            await prisma.lead.updateMany({
                where: { id: leadId, runId: pendingRunId },
                data: {
                    runId: null,
                    runStatus: RunStatus.FAILED,
                },
            });
            revalidateTag(`chat-session-lead-${leadId}`, CACHE_PROFILES.SHORT);
            throw error;
        }

        await prisma.lead.update({
            where: { id: leadId },
            data: {
                runId: run.runId, // Store the runId to track workflow status
                runStatus: RunStatus.RUNNING, // Store the initial status
            }
        });
        revalidateTag(`chat-session-lead-${leadId}`, CACHE_PROFILES.SHORT);

        console.log("Started run", run.runId);

        return successResponse({
            runId: run.runId,
            message: "Creating offer workflow started",
        });
    } catch (error) {
        if (error instanceof LeadAccessError) {
            if (error.status === 404) {
                return notFoundResponse("Lead");
            }
            return unauthorizedResponse(error.message);
        }
        console.error("Error starting workflow:", error);
        return errorResponse("Failed to start offer creation workflow.");
    }
}
