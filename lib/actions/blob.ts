"use server";

import { auth } from "@clerk/nextjs/server";
import { del } from "@vercel/blob";
import { getUserByClerkIdCached } from "@/lib/data/user";
import { assertCanAccessLead } from "@/lib/offer/access";

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

  await assertCanAccessLead(user, parsedLeadId);

  const pathname = decodeURIComponent(new URL(blobUrl).pathname);
  if (!pathname.includes(`/leads/${leadId}/`)) {
    throw new Error("Blob does not belong to this lead");
  }

  await del(blobUrl);
}
