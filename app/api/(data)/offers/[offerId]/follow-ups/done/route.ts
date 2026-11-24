import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";

import { markOfferFollowUpDoneForOffice } from "@/lib/data/offer-follow-ups";
import { getUserByClerkId } from "@/lib/data/user";
import { userPrincipal } from "@/lib/domain/principal";
import { domainErrorResponse } from "@/lib/http/domain-response";
import { errorResponse, successResponse } from "@/utils/validators";

/**
 * "Follow-up done" on the Offers page's alerts: the office chased the client
 * another way and wants the alert off the list. Sends nothing.
 *
 * The alert comes back a day later if the client still has not answered
 * (`markOfferFollowUpDone` in `lib/domain/offers/follow-ups.ts`).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ offerId: string }> },
) {
  const { offerId } = await params;

  try {
    // A person behind it, as for sending: the mark is attributed, and a
    // request with no session is not the office.
    const { userId } = await auth();
    const user = userId ? await getUserByClerkId(userId) : null;
    if (!user) {
      return errorResponse("Sign in to mark a follow-up done.", {
        status: 401,
        code: "UNAUTHENTICATED",
      });
    }

    const result = await markOfferFollowUpDoneForOffice(
      userPrincipal(user),
      offerId,
    );
    return successResponse(result);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("Failed to mark an offer follow-up done", error);
    return errorResponse("The follow-up could not be marked done.", {
      status: 500,
      code: "OFFER_FOLLOW_UP_DONE_FAILED",
    });
  }
}
