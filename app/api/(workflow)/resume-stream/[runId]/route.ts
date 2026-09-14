import { OfferCreationStatus } from "@/types/offer";
import { getRun } from "workflow/api";
import { NextRequest, connection } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getUserByClerkIdCached } from "@/lib/data/user";
import { verifyRunCapability } from "@/lib/workflow/run-capability";
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

    const { runId: capability } = await params;
    if (!capability.trim()) {
        return Response.json({ error: "Invalid runId" }, { status: 400 });
    }

    // The path segment is the capability the starting route issued, not a bare
    // run id: a session alone used to be enough to stream anyone's run. A token
    // for another user, a forged one, and a raw run id all look like a missing
    // run, so the refusal says nothing about whether the run exists.
    const runId = verifyRunCapability(capability, user.id);
    if (!runId) {
        return Response.json({ error: "Workflow run not found" }, { status: 404 });
    }

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
