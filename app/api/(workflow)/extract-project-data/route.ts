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
  forbiddenResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";
import { auth } from "@clerk/nextjs/server";
import { authorizeLeadAccess } from "@/lib/data/offer-access";
import { blobStoreIdFromToken, isBlobStoreUrl } from "@/lib/blob-url";
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
  const input = validationResult.data;

  // Every field is the browser's. The run reads the lead into the model
  // prompt and streams the result back, and the OCR step fetches both URLs,
  // so unchecked a signed-in user could pull a lead they cannot open into a
  // run they follow, or have us OCR any document on the internet.
  const access = await authorizeLeadAccess(input.leadId);
  if (!access.ok) {
    return forbiddenResponse(access.error);
  }
  // The wizard uploads both PDFs through /api/upload before it gets here, and
  // that route signs every upload with BLOB_READ_WRITE_TOKEN, so both live in
  // that token's store. Anything else, another Vercel Blob store included,
  // did not come from it.
  const storeId = blobStoreIdFromToken(process.env.BLOB_READ_WRITE_TOKEN);
  if (
    !isBlobStoreUrl(input.tenderUrl, storeId) ||
    !isBlobStoreUrl(input.contractUrl, storeId)
  ) {
    return badRequestResponse(
      "The tender and contract must be uploaded files.",
    );
  }

  // Checked before start(): without the secret no one could follow the run,
  // and it would still spend the whole extraction.
  if (!runCapabilitySecret()) {
    console.error(
      `${RUN_CAPABILITY_SECRET_ENV} is not set; not starting tender extraction`,
    );
    return errorResponse("Failed to start offer creation workflow.");
  }

  try {
    // Executes asynchronously and doesn't block your app
    const run = await start(extractTenderAndContractDocuments, [input]);

    console.log("Started run", run.runId);

    return successResponse({
      // The client only hands this to /api/resume-stream, which accepts
      // nothing but a capability issued to the same user.
      runId: signRunCapability({ runId: run.runId, userId: access.user.id }),
      message: "Creating offer workflow started",
    });
  } catch (error) {
    console.error("Error starting workflow:", error);
    return errorResponse("Failed to start offer creation workflow.");
  }
}
