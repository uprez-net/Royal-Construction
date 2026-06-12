import { OfferCreationStatus } from "@/lib/workflow/offer";
import { getRun } from "workflow/api";
import { NextRequest, connection } from "next/server";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ runId: string }> }
) { 
    await connection(); // Ensure the connection is established before proceeding
    const { runId } = await params;
    const { searchParams } = new URL(request.url);
    // Client provides the last chunk index they received
    const startIndexParam = searchParams.get("startIndex");
    const startIndex = startIndexParam ? parseInt(startIndexParam, 10) : undefined;
    const run = getRun(runId);
    console.log(`Resuming stream for run ${runId} from index ${startIndex}, run status: ${run.status}`);
    const stream = run.getReadable<OfferCreationStatus>({ startIndex });
    return new Response(stream, {
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    });
}