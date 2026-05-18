import { randomUUID } from "crypto";

import { auth } from "@clerk/nextjs/server";
import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { getProjectById } from "@/lib/data/projects";
import { getUserByClerkIdCached } from "@/lib/data/user";
import prisma from "@/lib/prisma";

type AddProjectUpdateBody = {
  notes?: string;
  milestoneId?: string | null;
  photoUrls?: string[];
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth();
  const { projectId } = await params;
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const user = await getUserByClerkIdCached(userId);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let notes = "";
  let milestoneId: string | null = null;
  let photoUrls: string[] = [];

  if (contentType.includes("application/json")) {
    const body = (await request.json()) as AddProjectUpdateBody;
    notes = String(body.notes ?? "").trim();
    milestoneId = typeof body.milestoneId === "string" && body.milestoneId.length > 0 ? body.milestoneId : null;
    photoUrls = Array.isArray(body.photoUrls)
      ? body.photoUrls.filter((url): url is string => typeof url === "string" && url.length > 0)
      : [];
  } else {
    const formData = await request.formData();
    notes = String(formData.get("notes") ?? "").trim();
    const milestoneIdValue = formData.get("milestoneId");
    milestoneId = typeof milestoneIdValue === "string" && milestoneIdValue.length > 0 ? milestoneIdValue : null;
    const files = formData.getAll("photos").filter((file): file is File => file instanceof File && file.size > 0 && file.type.startsWith("image/"));

    photoUrls = await Promise.all(
      files.map(async (file) => {
        const blob = await put(`projects/${projectId}/${randomUUID()}-${file.name}`, file, {
          access: "public",
        });

        return blob.url;
      }),
    );
  }

  if (!notes) {
    return new Response("Notes are required", { status: 400 });
  }

  const milestone = milestoneId
    ? await prisma.milestone.findUnique({
      where: { id: milestoneId },
      select: { id: true, isPhotoRequired: true },
    })
    : null;

  await prisma.$transaction(async (tx) => {
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

  revalidateTag(`project-${projectId}`, "max");

  const updatedProject = await getProjectById(projectId);

  if (!updatedProject) {
    return NextResponse.json({ error: "Project not found after creating update" }, { status: 404 });
  }

  return NextResponse.json(updatedProject);
}
