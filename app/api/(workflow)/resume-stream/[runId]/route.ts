import { OfferCreationStatus } from "@/types/offer";
import { getRun } from "workflow/api";
import { NextRequest, connection } from "next/server";
import { auth } from "@clerk/nextjs/server";
// import prisma from "@/lib/prisma";
import { getUserByClerkIdCached } from "@/lib/data/user";
// import { LeadAccessError, assertCanAccessLead } from "@/lib/offer/access";
import { TenderExtractionWorkflowStreamEvent } from "@/lib/workflow/project";
import { ComplianceChecklistStreamEvent } from "@/types/compliance-workflow";

export const maxDuration = 900; // 15 minutes

/**
 * Every event shape this route can carry.
 *
 * One route serves every workflow's stream, so the union has to name them all.
 * The client tells them apart by their own discriminant — `type` for the
 * extraction workflows, `status` for offer creation.
 */
type WorkflowStreamChunk =
    | OfferCreationStatus
    | TenderExtractionWorkflowStreamEvent
    | ComplianceChecklistStreamEvent;

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ runId: string }> }
) {
    const { userId } = await auth();
    if (!userId) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserByClerkIdCached(userId);
    if (!user) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { runId } = await params;
    if (!runId.trim()) {
        return Response.json({ error: "Invalid runId" }, { status: 400 });
    }

    // const lead = await prisma.lead.findFirst({
    //     where: { runId },
    //     select: { id: true },
    // });
    // if (!lead) {
    //     return Response.json({ error: "Workflow run not found" }, { status: 404 });
    // }

    // try {
    //     await assertCanAccessLead(user, lead.id);
    // } catch (error) {
    //     if (error instanceof LeadAccessError) {
    //         return Response.json(
    //             { error: error.status === 404 ? "Workflow run not found" : error.message },
    //             { status: error.status },
    //         );
    //     }
    //     throw error;
    // }

    const { searchParams } = new URL(request.url);
    const startIndexParam = searchParams.get("startIndex");
    let startIndex: number | undefined;

    if (startIndexParam !== null) {
        if (!/^\d+$/.test(startIndexParam)) {
            return Response.json(
                { error: "startIndex must be a non-negative integer" },
                { status: 400 },
            );
        }
        startIndex = Number.parseInt(startIndexParam, 10);
    }

    try {
        await connection(); // Ensure the connection is established before proceeding
        const run = getRun(runId);
        console.log(`Resuming stream for run ${runId} from index ${startIndex}`);
        const stream = run.getReadable<WorkflowStreamChunk>({ startIndex });
        // Encode typed chunks as NDJSON for easy client parsing
        const encoder = new TextEncoder();
        const ndjsonStream = new TransformStream<WorkflowStreamChunk, Uint8Array>({
            transform(chunk, controller) {
                controller.enqueue(encoder.encode(JSON.stringify(chunk) + "\n"));
            },
        });

        return new Response(stream.pipeThrough(ndjsonStream), {
            headers: {
                "Content-Type": "application/x-ndjson",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
            },
        });
    } catch (error) {
        console.error("Failed to resume workflow stream", { runId, startIndex, error });
        return Response.json(
            { error: "Failed to resume workflow stream" },
            { status: 500 },
        );
    }
}
