import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { z } from "zod";

import { sendOfferFollowUpEmail } from "@/lib/data/offer-follow-ups";
import { getUserByClerkId } from "@/lib/data/user";
import { userPrincipal } from "@/lib/domain/principal";
import { domainErrorResponse } from "@/lib/http/domain-response";
import {
  badRequestResponse,
  errorResponse,
  successResponse,
} from "@/utils/validators";

const followUpBodySchema = z
  .object({
    to: z.string().trim().min(1, "Choose who to send it to."),
    subject: z.string().trim().min(1, "Add a subject line.").max(300),
    body: z.string().trim().min(1, "The email is empty.").max(20_000),
  })
  .strict();

/**
 * Sends the follow-up an administrator reviewed and edited (issue #449).
 *
 * The button on the Offers page only opens the draft; this is the only thing
 * that sends it. The `Idempotency-Key` is required rather than derived: the
 * dialog holds one per attempt, so a double click or a retry after a timeout
 * is one email, and a key made up here from the day or the body is exactly
 * what used to report a deliberate second follow-up as sent while nothing
 * went out.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ offerId: string }> },
) {
  const { offerId } = await params;
  const attemptKey = request.headers.get("Idempotency-Key")?.trim();
  if (!attemptKey) {
    return badRequestResponse(
      "This send has no Idempotency-Key. Reload the page and try again.",
    );
  }

  const parsed = followUpBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return badRequestResponse(
      parsed.error.issues[0]?.message ?? "The follow-up is incomplete.",
    );
  }

  try {
    // Resolved here rather than through `currentPrincipal`, which reads a
    // request with no session as the system principal: sending mail from the
    // company mailbox needs a person behind it.
    const { userId } = await auth();
    const user = userId ? await getUserByClerkId(userId) : null;
    if (!user) {
      return errorResponse("Sign in to send a follow-up.", {
        status: 401,
        code: "UNAUTHENTICATED",
      });
    }

    const result = await sendOfferFollowUpEmail(userPrincipal(user), {
      offerId,
      attemptKey,
      ...parsed.data,
    });
    return successResponse(result);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("Failed to send an offer follow-up", error);
    return errorResponse("The follow-up could not be sent.", {
      status: 500,
      code: "OFFER_FOLLOW_UP_FAILED",
    });
  }
}
