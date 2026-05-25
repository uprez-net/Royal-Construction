"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";

export type UploadQueueStatus = "queued" | "uploading" | "uploaded" | "failed";

export type QueuedUploadFile = {
  id: string;
  file: File;
  previewUrl: string;
  progress: number;
  status: UploadQueueStatus;
  error: string | null;
  url: string | null;
};

type UseUploadQueueOptions = {
  maxFiles?: number;
};

function createQueuedUploadFile(file: File): QueuedUploadFile {
  return {
    id: uuidv4(),
    file,
    previewUrl: URL.createObjectURL(file),
    progress: 0,
    status: "queued",
    error: null,
    url: null,
  };
}

function revokeQueuedFiles(files: QueuedUploadFile[]) {
  files.forEach((file) => URL.revokeObjectURL(file.previewUrl));
}

export function useUploadQueue({ maxFiles = Number.POSITIVE_INFINITY }: UseUploadQueueOptions = {}) {
  const [files, setFiles] = useState<QueuedUploadFile[]>([]);
  const filesRef = useRef<QueuedUploadFile[]>([]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    return () => {
      revokeQueuedFiles(filesRef.current);
    };
  }, []);

  const addFiles = useCallback(
    (selectedFiles: File[]) => {
      if (selectedFiles.length === 0) {
        return;
      }

      setFiles((current) => {
        const remainingSlots = Math.max(maxFiles - current.length, 0);

        if (remainingSlots === 0) {
          return current;
        }

        const nextFiles = selectedFiles
          .slice(0, remainingSlots)
          .map((file) => createQueuedUploadFile(file));

        return [...current, ...nextFiles];
      });
    },
    [maxFiles],
  );

  const resetQueue = useCallback(() => {
    revokeQueuedFiles(filesRef.current);
    filesRef.current = [];
    setFiles([]);
  }, []);

  const updateFile = useCallback(
    (fileId: string, updater: (file: QueuedUploadFile) => QueuedUploadFile) => {
      setFiles((current) =>
        current.map((file) => (file.id === fileId ? updater(file) : file)),
      );
    },
    [],
  );

  const markUploading = useCallback(
    (fileId: string) => {
      updateFile(fileId, (file) => ({
        ...file,
        status: "uploading",
        progress: 0,
        error: null,
      }));
    },
    [updateFile],
  );

  const updateProgress = useCallback(
    (fileId: string, progress: number) => {
      updateFile(fileId, (file) => ({
        ...file,
        status: "uploading",
        progress,
        error: null,
      }));
    },
    [updateFile],
  );

  const markUploaded = useCallback(
    (fileId: string, url: string) => {
      updateFile(fileId, (file) => ({
        ...file,
        status: "uploaded",
        progress: 100,
        url,
        error: null,
      }));
    },
    [updateFile],
  );

  const markFailed = useCallback(
    (fileId: string, error: string) => {
      updateFile(fileId, (file) => ({
        ...file,
        status: "failed",
        error,
      }));
    },
    [updateFile],
  );

  const completedCount = useMemo(
    () => files.filter((file) => file.status === "uploaded").length,
    [files],
  );

  return {
    files,
    filesRef,
    completedCount,
    addFiles,
    resetQueue,
    markUploading,
    updateProgress,
    markUploaded,
    markFailed,
    setFiles,
  };
}