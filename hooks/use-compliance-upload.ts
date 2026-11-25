"use client";

import { upload } from "@vercel/blob/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";

import {
  useUploadHints,
  type UploadHintExtras,
} from "@/components/common/upload-hints";
import { completeProjectUpload } from "@/lib/files/complete-project-upload";
import { buildBlobPath } from "@/utils/formatters";
import type { ClientPayload } from "@/utils/validators";

export type UploadedComplianceFile = {
  fileId: string;
  name: string;
  url: string;
};

/** What one control's transfer looks like while it is running, and after. */
export type ComplianceUploadState = {
  isUploading: boolean;
  /** 0–100. Reset when a fresh transfer starts on the same key. */
  progress: number;
  /** Survives the transfer, so a failed control can say why. */
  error: string | null;
};

const IDLE_UPLOAD: ComplianceUploadState = {
  isUploading: false,
  progress: 0,
  error: null,
};

/**
 * Uploads files straight to blob storage, for the compliance tab.
 *
 * The tab has upload controls in six or seven different places — the discovery
 * loop, each signed copy, every checklist item, home insurance, and the thread
 * composer — and none of them wants a dropzone, a queue, or a dialog. They want
 * "pick a file, get a fileId back". That is what this is.
 *
 * Everything here is keyed by the caller's control key, and that is the whole
 * point: this used to hold one `uploadingKey` and one abort controller, which
 * meant a second transfer started while the first was running stole the
 * controller, and whichever finished first cleared the flag for both. The tab
 * papered over it by disabling every control during any upload. Per-key state
 * is what lets two rows upload at once and each report only on itself.
 *
 * The heavier `useUploadQueue` + `UploadDropzone` pairing stays where it earns
 * its keep: multi-file drops with per-file progress, as in
 * add-milestone-picture.tsx. Reusing it for a single hidden input would mean
 * carrying its queue state and object-URL bookkeeping for a control that shows
 * one spinner.
 *
 * The File row is confirmed before `uploadFile` resolves, through
 * `/api/upload/complete`, so the `fileId` it returns is one the server can
 * already see. It used to rely on Blob's `onUploadCompleted` callback writing
 * the row, which is a webhook that arrives whenever it arrives: the caller
 * pointed a compliance document at the id straight away and, on a large
 * construction certificate, got "file not found" back. An 850ms sleep at each
 * call site papered over it. The upload is now marked `project-file`, so the
 * callback skips it and there is exactly one writer.
 */
export function useComplianceUpload(projectId: string) {
  const [uploads, setUploads] = useState<Record<string, ComplianceUploadState>>(
    {},
  );
  const controllersRef = useRef(new Map<string, AbortController>());
  const hintsFor = useUploadHints();

  // A tab switch or a closed modal mid-upload should stop every transfer rather
  // than leave them running against an unmounted component.
  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    };
  }, []);

  const patch = useCallback(
    (key: string, next: Partial<ComplianceUploadState>) => {
      setUploads((current) => ({
        ...current,
        [key]: { ...(current[key] ?? IDLE_UPLOAD), ...next },
      }));
    },
    [],
  );

  const uploadFile = useCallback(
    async (
      file: File,
      key: string,
      /** What this control uploads for, on top of the screen's hints. */
      hints?: UploadHintExtras,
    ): Promise<UploadedComplianceFile> => {
      const fileId = uuidv4();
      const controller = new AbortController();
      // Two transfers on one key should not happen — the control is disabled
      // while its own is running — but if one does, the older is abandoned
      // rather than left to write progress over the newer.
      controllersRef.current.get(key)?.abort();
      controllersRef.current.set(key, controller);

      patch(key, { isUploading: true, progress: 0, error: null });

      try {
        const resolvedHints = hintsFor(hints);
        const blob = await upload(
          buildBlobPath({ fileId, fileName: file.name, projectId }),
          file,
          {
            // The store is private (#571): Blob refuses a public write to it
            // outright, and Chrome reports that refusal of a streamed body as
            // a bare "Failed to fetch (vercel.com)". Screens open the file
            // through a signed link, never this URL.
            access: "private",
            handleUploadUrl: "/api/upload",
            clientPayload: JSON.stringify({
              projectId,
              fileId,
              fileName: file.name,
              fileSize: file.size,
              isOfferFile: false,
              // Confirmed synchronously below; the Blob callback skips it.
              uploadType: "project-file",
              ...resolvedHints,
            } satisfies ClientPayload),
            abortSignal: controller.signal,
            onUploadProgress: ({ percentage }) =>
              patch(key, { progress: percentage }),
          },
        );

        // Wait for the File row, not for the webhook. Whatever the caller does
        // next with this id — attach it to a compliance document, put it on a
        // thread — needs the row to exist.
        await completeProjectUpload(
          {
            projectId,
            fileId,
            fileName: file.name,
            fileUrl: blob.url,
            ...resolvedHints,
          },
          controller.signal,
        );

        return { fileId, name: file.name, url: blob.url };
      } catch (uploadError) {
        const message =
          uploadError instanceof Error
            ? uploadError.message
            : "The upload failed. Please try again.";
        patch(key, { error: message });
        throw uploadError;
      } finally {
        // Only if it is still ours: a transfer superseded on the same key must
        // not clear the controller the replacement is relying on.
        if (controllersRef.current.get(key) === controller) {
          controllersRef.current.delete(key);
          patch(key, { isUploading: false, progress: 0 });
        }
      }
    },
    [hintsFor, patch, projectId],
  );

  const isUploading = useCallback(
    (key: string) => uploads[key]?.isUploading ?? false,
    [uploads],
  );

  return {
    uploadFile,
    /** Per-control state, so only the control that is busy shows a spinner. */
    uploads,
    isUploading,
    progressFor: useCallback(
      (key: string) => uploads[key]?.progress ?? 0,
      [uploads],
    ),
    errorFor: useCallback(
      (key: string) => uploads[key]?.error ?? null,
      [uploads],
    ),
    clearError: useCallback(
      (key: string) => patch(key, { error: null }),
      [patch],
    ),
  };
}
