"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { upload } from "@vercel/blob/client";
import { useCallback, useState } from "react";

import { useUploadHints } from "@/components/common/upload-hints";
import {
  fetchChecklistDetail,
  fetchProjectChecklists,
} from "@/lib/data/checklist-actions";
import type { ChecklistDisplayStatus } from "@/lib/domain/projects/checklist-rules";
import { completeProjectUpload } from "@/lib/files/complete-project-upload";
import { buildBlobPath } from "@/utils/formatters";
import type { ClientPayload } from "@/utils/validators";

// The Checklists tab's data: the two reads, the cache keys every mutation
// invalidates, and uploading inspection photos as project files.

export const checklistKeys = {
  all: (projectId: string) => ["project-checklists", projectId] as const,
  detail: (projectId: string, number: number) =>
    ["project-checklists", projectId, "detail", number] as const,
  list: (projectId: string) =>
    ["project-checklists", projectId, "list"] as const,
};

export function useProjectChecklists(projectId: string) {
  return useQuery({
    queryFn: async () => {
      const result = await fetchProjectChecklists(projectId);
      if (!result.ok) throw new Error(result.error);
      return result.checklists;
    },
    queryKey: checklistKeys.list(projectId),
    refetchOnMount: "always",
    staleTime: 0,
  });
}

export function useChecklistDetail(projectId: string, number: number) {
  return useQuery({
    queryFn: async () => {
      const result = await fetchChecklistDetail(projectId, number);
      if (!result.ok) throw new Error(result.error);
      return result.checklist;
    },
    queryKey: checklistKeys.detail(projectId, number),
    refetchOnMount: "always",
    staleTime: 0,
  });
}

/** Refetch everything the checklist screens show for this project. */
export function useRefreshChecklists(projectId: string) {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: checklistKeys.all(projectId),
      }),
    [projectId, queryClient],
  );
}

/** A request key for one press of a button: stable across its retries. */
export function newRequestKey(): string {
  return crypto.randomUUID();
}

export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
export const PHOTO_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,image/heif";

export type PhotoUploadState = {
  readonly id: string;
  readonly name: string;
  readonly progress: number;
  readonly error: string | null;
};

/**
 * Upload photos as project files, confirm each one, and answer the File ids
 * that landed. Failures are kept in `uploads` with their reason, so the row
 * can show which photo did not make it instead of losing it quietly.
 */
export function useChecklistPhotoUpload(
  projectId: string,
  trail: readonly string[],
) {
  const uploadHints = useUploadHints();
  const [uploads, setUploads] = useState<PhotoUploadState[]>([]);

  const patch = (id: string, next: Partial<PhotoUploadState>) =>
    setUploads((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...next } : entry)),
    );

  const uploadPhotos = useCallback(
    async (files: readonly File[]): Promise<string[]> => {
      const queued = files.map((file) => ({
        file,
        id: crypto.randomUUID(),
      }));
      setUploads((current) => [
        ...current,
        ...queued.map(({ file, id }) => ({
          error: !file.type.startsWith("image/")
            ? "Only photos can be attached."
            : file.size > MAX_PHOTO_BYTES
              ? "Photos must be under 20 MB."
              : null,
          id,
          name: file.name,
          progress: 0,
        })),
      ]);

      const hints = uploadHints({ tags: ["Checklist"], trail });
      const results = await Promise.allSettled(
        queued.map(async ({ file, id }) => {
          if (!file.type.startsWith("image/") || file.size > MAX_PHOTO_BYTES) {
            throw new Error("rejected");
          }
          try {
            const blob = await upload(
              buildBlobPath({ fileId: id, fileName: file.name, projectId }),
              file,
              {
                access: "private",
                clientPayload: JSON.stringify({
                  fileId: id,
                  fileName: file.name,
                  fileSize: file.size,
                  isOfferFile: false,
                  milestoneId: null,
                  projectId,
                  uploadType: "project-file",
                  ...hints,
                } satisfies ClientPayload),
                handleUploadUrl: "/api/upload",
                onUploadProgress: ({ percentage }) =>
                  patch(id, { progress: percentage }),
              },
            );
            await completeProjectUpload({
              fileId: id,
              fileName: file.name,
              fileUrl: blob.url,
              projectId,
              ...hints,
            });
            setUploads((current) => current.filter((entry) => entry.id !== id));
            return id;
          } catch (error) {
            patch(id, {
              error:
                error instanceof Error ? error.message : "The upload failed.",
            });
            throw error;
          }
        }),
      );
      return results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
    },
    [projectId, trail, uploadHints],
  );

  const dismiss = (id: string) =>
    setUploads((current) => current.filter((entry) => entry.id !== id));

  return {
    dismiss,
    isUploading: uploads.some((entry) => entry.error === null),
    uploadPhotos,
    uploads,
  };
}

const DATE_TIME = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: "Australia/Sydney",
});
const DATE = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  timeZone: "Australia/Sydney",
  year: "numeric",
});

export const formatDateTime = (value: Date | string) =>
  DATE_TIME.format(new Date(value));
export const formatDate = (value: Date | string) =>
  DATE.format(new Date(value));

const REVIEWER_KEY = "rc-checklist-reviewer-name";

/** The last reviewer name typed on this device: a convenience, not state. */
export function rememberedReviewerName(): string {
  try {
    return window.localStorage.getItem(REVIEWER_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberReviewerName(name: string) {
  try {
    window.localStorage.setItem(REVIEWER_KEY, name);
  } catch {
    // Private browsing: nothing to remember it in.
  }
}

/** The pill tone for each checklist status. */
export const DISPLAY_TONE: Record<
  ChecklistDisplayStatus,
  "neutral" | "warning" | "success" | "primary"
> = {
  closed: "success",
  in_progress: "warning",
  not_configured: "neutral",
  not_started: "neutral",
  ready_to_close: "primary",
};
