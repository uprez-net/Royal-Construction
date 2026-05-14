import { randomUUID } from "crypto";

import { auth } from "@clerk/nextjs/server";
import { put } from "@vercel/blob";

import { getUserByClerkId } from "@/lib/data/user";
import prisma from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth();
  const { projectId } = await params;
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const user = await getUserByClerkId(userId);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const formData = await request.formData();
  const notes = String(formData.get("notes") ?? "").trim();
  const milestoneIdValue = formData.get("milestoneId");
  const milestoneId = typeof milestoneIdValue === "string" && milestoneIdValue.length > 0 ? milestoneIdValue : null;
  const files = formData.getAll("photos").filter((file): file is File => file instanceof File && file.size > 0 && file.type.startsWith("image/"));

  if (!notes) {
    return new Response("Notes are required", { status: 400 });
  }

  const milestone = milestoneId
    ? await prisma.milestone.findUnique({
      where: { id: milestoneId },
      select: { id: true, isPhotoRequired: true },
    })
    : null;

  const photoUrls = await Promise.all(
    files.map(async (file) => {
      const blob = await put(`projects/${projectId}/${randomUUID()}-${file.name}`, file, {
        access: "public",
      });

      return blob.url;
    }),
  );

  const siteUpdate = await prisma.$transaction(async (tx) => {
    const created = await tx.siteUpdate.create({
      data: {
        projectId: projectId,
        milestoneId,
        authorId: user.id,
        notes,
        photoUrls,
      },
    });

    await tx.activityLog.create({
      data: {
        projectId: projectId,
        milestoneId,
        authorId: user.id,
        type: "site-update",
        message: `Site update posted for ${projectId}`,
      },
    });

    if (milestone?.isPhotoRequired && milestoneId) {
      await tx.milestone.update({
        where: { id: milestoneId },
        data: {
          status: "DONE",
          actualDate: new Date(),
        },
      });
    }

    return created;
  });

  if (milestone?.isPhotoRequired && milestoneId) {
    console.log(`[NOTIFICATION] Client notified for milestone ${milestoneId}`);
  }

  return Response.json(siteUpdate);
}
