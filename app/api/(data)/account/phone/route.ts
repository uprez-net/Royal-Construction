import type { NextRequest } from "next/server";
import { connection } from "next/server";
import { z } from "zod";

import {
  revalidateOwnPhone,
  writeOwnPhoneToClerk,
} from "@/lib/data/account-phone";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import {
  readOwnPhone,
  updateOwnPhone,
} from "@/lib/domain/identity/phone-verification";
import { findUserById } from "@/lib/domain/identity/users";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  parseBodyWithResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * The signed-in person's own phone number (GET), and changing it (PUT).
 * Proving it is `./code` (text a code) and `./verify` (type it back).
 */

const updateSchema = z.object({
  phone: z.string().trim().min(1, "Enter a phone number.").max(40),
});

export async function GET() {
  await connection();
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    return successResponse(await readOwnPhone(principal, prisma));
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[account] Loading the phone number failed", error);
    return errorResponse("Could not load your phone number.", {
      code: "ACCOUNT_PHONE_LOAD_FAILED",
      status: 500,
    });
  }
}

export async function PUT(request: NextRequest) {
  const parsed = await parseBodyWithResponse(request, updateSchema);
  if (!parsed.success) return parsed.response;
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    const result = await updateOwnPhone(
      principal,
      parsed.data,
      prisma,
      writeOwnPhoneToClerk,
    );
    if (result.changed) {
      const user = await findUserById(principal.userId, prisma);
      if (user) revalidateOwnPhone(user.clerkId);
    }
    return successResponse(await readOwnPhone(principal, prisma));
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[account] Saving the phone number failed", error);
    return errorResponse("Could not save your phone number.", {
      code: "ACCOUNT_PHONE_SAVE_FAILED",
      status: 500,
    });
  }
}
