import type { NextRequest } from "next/server";
import { z } from "zod";

import { revalidateOwnPhone } from "@/lib/data/account-phone";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { confirmPhoneVerification } from "@/lib/domain/identity/phone-verification";
import { findUserById } from "@/lib/domain/identity/users";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/** Check the code the signed-in person typed, and mark their phone verified. */

const verifySchema = z.object({
  code: z.string().trim().min(1, "Enter the code from the text.").max(12),
});

export async function POST(request: NextRequest) {
  const parsed = await parseBodyWithResponse(request, verifySchema);
  if (!parsed.success) return parsed.response;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const result = await confirmPhoneVerification(
      principal,
      parsed.data,
      prisma,
    );
    if (!result.alreadyVerified) {
      const user = await findUserById(principal.userId, prisma);
      if (user) revalidateOwnPhone(user.clerkId);
    }
    return successResponse(result);
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[account] Checking a phone verification code failed", error);
    return errorResponse("Could not check the code.", {
      code: "ACCOUNT_PHONE_VERIFY_FAILED",
      status: 500,
    });
  }
}
