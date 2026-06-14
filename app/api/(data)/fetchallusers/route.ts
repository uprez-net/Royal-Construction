import prisma from "@/lib/prisma";
import { clerkClient } from "@/lib/auth";
import { errorResponse, successResponse } from "@/utils/validators";
import { Role } from "@prisma/client";
import { connection } from "next/server";

function isDisplayableName(name: string | null | undefined) {
      const normalized = name?.trim();
      return Boolean(normalized && normalized.toLowerCase() !== "null null");
}

export async function GET() {
      await connection()
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
                        role: { in: [Role.ADMIN, Role.SITE_MANAGER, Role.GUEST] },
                  },
                  select: {
                        id: true,
                        name: true,
                        email: true,
                        clerkId: true,
                  }
            });
            const users = Users.map((user) => {
                  const clerkUser = usersByClerkId.get(user.clerkId);
                  const clerkName = [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ").trim();
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
            console.error("/api/fetchallusers GET error", error);
            return errorResponse("Failed to fetch users", {
                  status: 500,
                  code: "INTERNAL_ERROR",
            });
      }
}
