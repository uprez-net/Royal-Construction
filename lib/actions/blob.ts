"use server";

import { auth } from "@clerk/nextjs/server";
import { del } from "@vercel/blob";
import { getUserByClerkIdCached } from "@/lib/data/user";
import prisma from "@/lib/prisma";
import {
  authorizeLeadFileDeletion,
} from "@/lib/domain/files";
import { userPrincipal } from "@/lib/domain/principal";

export async function deleteLeadBlob(blobUrl: string, leadId: string) {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const user = await getUserByClerkIdCached(userId);
  if (!user) {
    throw new Error("Unauthorized");
  }

  const parsedLeadId = Number(leadId);
  if (!Number.isInteger(parsedLeadId)) {
    throw new Error("Invalid lead ID");
  }

  const authorized = await authorizeLeadFileDeletion(
    userPrincipal(user),
    { blobUrl, leadId: parsedLeadId },
    prisma,
  );
  await del(authorized.blobUrl);
}
