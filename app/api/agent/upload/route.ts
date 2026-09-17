import { auth } from "@clerk/nextjs/server";
import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getUserByClerkIdCached } from "@/lib/data/user";
import { saveFile } from "@/lib/data/file";
import { UPLOAD_CONSTRAINTS } from "@/utils/validators";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await getUserByClerkIdCached(userId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 403 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "A file is required" }, { status: 400 });
  if (file.size > UPLOAD_CONSTRAINTS.maxFileSizeBytes) return NextResponse.json({ error: "File is too large" }, { status: 413 });
  if (!UPLOAD_CONSTRAINTS.allowedMimeTypes.includes(file.type as never)) return NextResponse.json({ error: "File type is not supported" }, { status: 415 });
  const safeName = file.name.replaceAll(/[^a-zA-Z0-9._-]/g, "-").slice(0, 160) || "attachment";
  const blob = await put(`agent/${user.id}/${crypto.randomUUID()}-${safeName}`, file, { access: "public", addRandomSuffix: false });
  const saved = await saveFile({ userId: user.id, fileUrl: blob.url, fileName: file.name, fileType: file.type || "application/octet-stream", fileSize: file.size });
  return NextResponse.json({ file: { id: saved.file.id, url: blob.url, filename: file.name, fileType: file.type, filesize: file.size } });
}
