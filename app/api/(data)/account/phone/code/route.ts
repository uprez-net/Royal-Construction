import type { NextRequest } from "next/server";
import { z } from "zod";

import { phoneCodeSender } from "@/lib/comms/phone-code-sender";
import { readOwnPhoneFromClerk } from "@/lib/data/account-phone";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { sendPhoneVerificationCode } from "@/lib/domain/identity/phone-verification";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/** The number the dialog showed, so a changed number is not texted unseen. */
const sendSchema = z.object({
  phone: z.string().trim().min(1, "Missing the phone number.").max(40),
});

/**
 * Text a verification code to the signed-in person's phone, from Royal's
 * Telnyx number. The command limits how often; a refusal says how long to wait.
 */
export async function POST(request: NextRequest) {
  const parsed = await parseBodyWithResponse(request, sendSchema);
  if (!parsed.success) return parsed.response;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const pending = await sendPhoneVerificationCode(
      principal,
      { expectedPhone: parsed.data.phone },
      prisma,
      phoneCodeSender(),
      readOwnPhoneFromClerk,
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
