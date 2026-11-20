import prisma from "@/lib/prisma";
import { clerkClient } from "@/lib/auth";
import { errorResponse, successResponse } from "@/utils/validators";
import { OFFICE_ROLES } from "@/lib/domain/principal";
import { connection } from "next/server";
import { requireInternalUser } from "@/lib/auth/require-internal-user";
import { domainErrorResponse } from "@/lib/http/domain-response";

function isDisplayableName(name: string | null | undefined) {
  const normalized = name?.trim();
  return Boolean(normalized && normalized.toLowerCase() !== "null null");
}

export async function GET() {
  await connection();
  // The office's names and emails, for the lead assignee pickers: the same
  // audience as the leads they assign. The role filter below limits who is
  // listed; this limits who may ask.
  const access = await requireInternalUser();
  if (!access.ok) {
    return errorResponse("Forbidden", { status: 403, code: "FORBIDDEN" });
  }
  try {
    const pageLimit = 100;
    let offset = 0;
    const clerkUsers = [];

    while (true) {
      const page = await clerkClient.users.getUserList({
        limit: pageLimit,
        offset,
      });

      clerkUsers.push(...page.data);

      if (page.data.length < pageLimit) {
        break;
      }

      offset += pageLimit;
    }

    const usersByClerkId = new Map(clerkUsers.map((user) => [user.id, user]));

    const Users = await prisma.user.findMany({
      where: {
        clerkId: { in: Array.from(usersByClerkId.keys()) },
        // The lead assignee pickers are this route's only readers, and a lead
        // is assigned to the office only (`assertOfficeAssignee`).
        role: { in: [...OFFICE_ROLES] },
      },
      select: {
        id: true,
        name: true,
        email: true,
        clerkId: true,
      },
    });
    const users = Users.map((user) => {
      const clerkUser = usersByClerkId.get(user.clerkId);
      const clerkName = [clerkUser?.firstName, clerkUser?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
      const email = clerkUser?.emailAddresses[0]?.emailAddress || user.email;
      const name = isDisplayableName(clerkName)
        ? clerkName
        : isDisplayableName(user.name)
          ? user.name.trim()
          : email;

      return {
        id: user.id,
        name,
        email,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    return successResponse({ users });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("/api/fetchallusers GET error", error);
    return errorResponse("Failed to fetch users", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}
