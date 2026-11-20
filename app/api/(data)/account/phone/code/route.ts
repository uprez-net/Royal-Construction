import { phoneCodeSender } from "@/lib/comms/phone-code-sender";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { sendPhoneVerificationCode } from "@/lib/domain/identity/phone-verification";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * Text a verification code to the signed-in person's phone, from Royal's
 * Telnyx number. The command limits how often; a refusal says how long to wait.
 */
export async function POST() {
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const pending = await sendPhoneVerificationCode(
      principal,
      prisma,
      phoneCodeSender(),
    );
    return successResponse(pending);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[account] Sending a phone verification code failed", error);
    return errorResponse("Could not send a code.", {
      code: "ACCOUNT_PHONE_CODE_FAILED",
      status: 500,
    });
  }
}
