import { auth } from "@clerk/nextjs/server";
import { del, issueSignedToken, presignUrl, put } from "@/lib/blob";
import { NextResponse } from "next/server";
import { getUserByClerkIdCached } from "@/lib/data/user";
import { saveFile } from "@/lib/data/file";
import { UPLOAD_CONSTRAINTS } from "@/utils/validators";

/**
 * Matches the Eve channel's `uploadPolicy.maxBytes`. The app-wide limit is
 * 40MB, so without this an upload succeeds and the turn that carries it fails.
 */
const AGENT_MAX_FILE_BYTES = 10 * 1024 * 1024;

/** How long the agent runtime has to fetch an attachment it was handed. */
const AGENT_URL_TTL_MS = 60 * 60 * 1_000;

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await getUserByClerkIdCached(userId);
  if (!user)
    return NextResponse.json({ error: "User not found" }, { status: 403 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File))
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  if (
    file.size
    > Math.min(AGENT_MAX_FILE_BYTES, UPLOAD_CONSTRAINTS.maxFileSizeBytes)
  )
    return NextResponse.json(
      { error: "Attachments for the agent must be 10MB or smaller" },
      { status: 413 },
    );
  if (!UPLOAD_CONSTRAINTS.allowedMimeTypes.includes(file.type as never))
    return NextResponse.json(
      { error: "File type is not supported" },
      { status: 415 },
    );
  const safeName =
    file.name.replaceAll(/[^a-zA-Z0-9._-]/g, "-").slice(0, 160) || "attachment";
  const blob = await put(
    `agent/${user.id}/${crypto.randomUUID()}-${safeName}`,
    file,
    { access: "private", addRandomSuffix: false },
  );
  let saved;
  try {
    saved = await saveFile({
      userId: user.id,
      fileUrl: blob.url,
      storagePath: blob.pathname,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      tags: ["Eve assistant"],
      origin: "Eve assistant",
    });
  } catch (error) {
    try {
      await del(blob.url);
    } catch (cleanupError) {
      console.error(
        "Failed to clean up an orphaned agent upload",
        cleanupError,
      );
    }
    throw error;
  }
  return NextResponse.json({
    file: {
      id: saved.file.id,
      url: `/api/agent/files/${saved.file.id}`,
      agentUrl: await agentReadableUrl(blob.pathname),
      filename: file.name,
      fileType: file.type,
      filesize: file.size,
    },
  });
}

/**
 * An absolute, short-lived URL the agent runtime can fetch.
 *
 * `/api/agent/files/:id` is Clerk-scoped, so the runtime — a separate service
 * with no browser session — gets a 401 from it. The blob stays private and is
 * reached through a presigned GET instead. A null result is reported to the
 * operator rather than swallowed: an attachment the agent silently never read
 * is exactly the failure mode that looks like success.
 */
async function agentReadableUrl(pathname: string) {
  try {
    const validUntil = Date.now() + AGENT_URL_TTL_MS;
    const token = await issueSignedToken({
      operations: ["get"],
      pathname,
      validUntil,
    });
    const { presignedUrl } = await presignUrl(token, {
      access: "private",
      operation: "get",
      pathname,
      validUntil,
    });
    return presignedUrl;
  } catch (error) {
    console.error("Could not presign an agent attachment", error);
    return null;
  }
}
