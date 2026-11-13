import { withCronReporting } from "@/lib/observability/cron";
import prisma from "@/lib/prisma";
import { errorResponse } from "@/utils/validators";
import { del, list } from "@/lib/blob";
import { NextRequest, NextResponse } from "next/server";

const ATTACHMENT_PREFIX = "email-ad-hock-attachment-upload/attachments/";

async function handle(request: NextRequest) {
  // 1. Authorization check for Vercel Cron
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === "production") {
    if (!cronSecret) {
      console.error(
        "[CRON_ERROR] CRON_SECRET is not configured in production env.",
      );
      return errorResponse("Cron not configured", {
        status: 500,
        code: "CONFIG_ERROR",
      });
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      console.warn(
        "[CRON_WARN] Unauthorized attempt to trigger followup-lead-reminder cron.",
      );
      return errorResponse("Unauthorized", {
        status: 401,
        code: "UNAUTHORIZED",
      });
    }
  }

  try {
    const result = await list({
      prefix: ATTACHMENT_PREFIX,
      limit: 1000,
    });

    const find_all_attachments = await prisma.emailAdHock.findMany({
      select: {
        attachmentsUrls: true,
      },
    });

    const storedAttachmentUrls = find_all_attachments.flatMap(
      (email) => email.attachmentsUrls,
    );

    const storedAttachmentUrlSet = new Set(storedAttachmentUrls);

    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const blobsToDelete = result.blobs.filter(
      (blob) =>
        !storedAttachmentUrlSet.has(blob.url) && blob.uploadedAt < oneWeekAgo,
    );

    const blobUrlsToDelete = blobsToDelete.map((blob) => blob.url);

    if (blobUrlsToDelete.length > 0) {
      await del(blobUrlsToDelete);
    }
    return NextResponse.json({
      success: true,
      message: `Deleted ${blobsToDelete.length} blobs from storage.`,
    });
  } catch (error) {
    console.error("[CRON_ERROR] Error during blob storage cleanup:", error);
    return errorResponse("Internal Server Error", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}

export const GET = withCronReporting("/api/cron/blob-storage-cleanup", handle);
