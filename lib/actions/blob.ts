"use server";

import { auth } from "@clerk/nextjs/server";
import { getUserByClerkIdCached } from "@/lib/data/user";
import prisma from "@/lib/prisma";
import { vercelBlobDelete } from "@/lib/blob-port";
import { deleteLeadFile } from "@/lib/domain/files";
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

  // The lead check, the path check and the delete are one command now. This
  // action supplies the identity and the storage capability, nothing else.
  await deleteLeadFile(
    userPrincipal(user),
    { blobUrl, leadId },
    prisma,
    vercelBlobDelete,
  );
}
