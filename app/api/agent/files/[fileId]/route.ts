import { auth } from "@clerk/nextjs/server";
import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserByClerkIdCached } from "@/lib/data/user";
import { uuidSchema } from "@/utils/validators/common";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await getUserByClerkIdCached(userId);
  if (!user)
    return NextResponse.json({ error: "User not found" }, { status: 403 });
  const { fileId } = await params;
  const parsedFileId = uuidSchema.safeParse(fileId);
  if (!parsedFileId.success)
    return NextResponse.json({ error: "Invalid file ID" }, { status: 400 });
  const file = await prisma.file.findUnique({
    where: { id: parsedFileId.data },
    select: {
      url: true,
      storagePath: true,
      filename: true,
      fileType: true,
      uploadedBy: true,
      project: { select: { siteManagerId: true } },
    },
  });
  if (!file)
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  const canAccess =
    file.uploadedBy === user.id ||
    user.role === "ADMIN" ||
    file.project?.siteManagerId === user.id;
  if (!canAccess)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const blob = await get(file.storagePath ?? file.url, {
    access: file.storagePath ? "private" : "public",
  });
  if (!blob)
    return NextResponse.json(
      { error: "File content not found" },
      { status: 404 },
    );
  return new Response(blob.stream, {
    headers: {
      "Content-Type":
        file.fileType || blob.blob.contentType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${file.filename.replaceAll(/[^a-zA-Z0-9._-]/g, "-")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
