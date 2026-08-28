"use client";

import { upload } from "@vercel/blob/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";

import { buildBlobPath } from "@/utils/formatters";
import type { ClientPayload } from "@/utils/validators";

export type UploadedComplianceFile = {
  fileId: string;
  name: string;
  url: string;
};

/**
 * Uploads a single file straight to blob storage, for the compliance tab.
 *
 * The tab has upload controls in six or seven different places — the discovery
 * loop, each signed copy, every checklist item, home insurance, and the thread
 * composer — and none of them wants a dropzone, a queue, or a dialog. They want
 * "pick a file, get a fileId back". That is what this is.
 *
 * The heavier `useUploadQueue` + `UploadDropzone` pairing stays where it earns
 * its keep: multi-file drops with per-file progress, as in
 * add-milestone-picture.tsx. Reusing it for a single hidden input would mean
 * carrying its queue state and object-URL bookkeeping for a control that shows
 * one spinner.
 *
 * `/api/upload` writes the File row on completion; the caller then points a
 * compliance document at the returned `fileId`.
 */
export function useComplianceUpload(projectId: string) {
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // A tab switch or a closed modal mid-upload should stop the transfer rather
  // than leave it running against an unmounted component.
  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  const uploadFile = useCallback(
    async (file: File, key: string): Promise<UploadedComplianceFile> => {
      const fileId = uuidv4();
      const controller = new AbortController();
      controllerRef.current = controller;

      setUploadingKey(key);
      setProgress(0);
      setError(null);

      try {
        const blob = await upload(
          buildBlobPath({ fileId, fileName: file.name, projectId }),
          file,
          {
            access: "public",
            handleUploadUrl: "/api/upload",
            clientPayload: JSON.stringify({
              projectId,
              fileId,
              fileName: file.name,
              fileSize: file.size,
              isOfferFile: false,
            } satisfies ClientPayload),
            abortSignal: controller.signal,
            onUploadProgress: ({ percentage }) => setProgress(percentage),
          },
        );

        return { fileId, name: file.name, url: blob.url };
      } catch (uploadError) {
        const message =
          uploadError instanceof Error
            ? uploadError.message
            : "The upload failed. Please try again.";
        setError(message);
        throw uploadError;
      } finally {
        setUploadingKey(null);
        setProgress(0);
        controllerRef.current = null;
      }
    },
    [projectId],
  );

  return {
    uploadFile,
    /** Which control is busy, so only that one shows a spinner. */
    uploadingKey,
    progress,
    error,
    clearError: useCallback(() => setError(null), []),
  };
}
