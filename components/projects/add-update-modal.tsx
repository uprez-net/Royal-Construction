"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  Loader2,
  CloudUpload,
  Send,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { upload } from "@vercel/blob/client";
import { v4 as uuidv4 } from "uuid";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  addProjectUpdate,
  clearProjectUploads,
  completeProjectUpload,
  failProjectUpload,
  registerProjectUpload,
  updateProjectUploadProgress,
} from "@/lib/store/slices/projectsSlice";
import { ClientPayload } from "@/utils/validators";
import { Input } from "../ui/input";
import { formatFileSize, buildBlobPath  } from "@/utils/formatters";

const maxFiles = 5;

type QueuedUploadFile = {
  id: string;
  file: File;
  previewUrl: string;
  progress: number;
  status: "queued" | "uploading" | "uploaded" | "failed";
  error: string | null;
  url: string | null;
};

export function AddUpdateModal({
  projectId,
  milestoneId: initialMilestoneId,
  milestones,
  open,
  onOpenChange,
  onSuccess,
}: {
  projectId: string;
  milestoneId?: string;
  milestones: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const dispatch = useAppDispatch();
  const mutation = useAppSelector(
    (state) => state.projects.mutations.addUpdate,
  );
  const [milestoneId, setMilestoneId] = useState<string | undefined>(initialMilestoneId);
  const [notes, setNotes] = useState("");
  const [updatedNotesTitle, setUpdatedNotesTitle] = useState("");
  const [queuedFiles, setQueuedFiles] = useState<QueuedUploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isTransitioning, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadControllersRef = useRef<Record<string, AbortController>>({});
  const queuedFilesRef = useRef<QueuedUploadFile[]>([]);

  const isSubmitting =
    mutation.status === "pending" || uploading || isTransitioning;
  const completedUploadCount = useMemo(
    () => queuedFiles.filter((file) => file.status === "uploaded").length,
    [queuedFiles],
  );

  const resetForm = () => {
    Object.values(uploadControllersRef.current).forEach((controller) =>
      controller.abort(),
    );
    uploadControllersRef.current = {};
    queuedFilesRef.current.forEach((file) =>
      URL.revokeObjectURL(file.previewUrl),
    );
    queuedFilesRef.current = [];
    setMilestoneId(undefined);
    setNotes("");
    setQueuedFiles([]);
    setUploading(false);
    setErrorMessage(null);
    dispatch(clearProjectUploads(projectId));

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetForm();
    }

    onOpenChange(nextOpen);
  };

  useEffect(() => {
    queuedFilesRef.current = queuedFiles;
  }, [queuedFiles]);

  useEffect(() => {
    return () => {
      queuedFilesRef.current.forEach((file) =>
        URL.revokeObjectURL(file.previewUrl),
      );
      Object.values(uploadControllersRef.current).forEach((controller) =>
        controller.abort(),
      );
    };
  }, []);

  const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);

    if (files.length === 0) {
      return;
    }

    setQueuedFiles((current) => {
      const nextFiles = [...current];

      files.slice(0, Math.max(maxFiles - current.length, 0)).forEach((file) => {
        nextFiles.push({
          id: uuidv4(),
          file,
          previewUrl: URL.createObjectURL(file),
          progress: 0,
          status: "queued",
          error: null,
          url: null,
        });
      });

      return nextFiles;
    });

    event.target.value = "";
  };

  const uploadQueuedFile = async (queuedFile: QueuedUploadFile) => {
    const controller = new AbortController();
    uploadControllersRef.current[queuedFile.id] = controller;

    dispatch(
      registerProjectUpload({
        projectId,
        fileId: queuedFile.id,
        fileName: queuedFile.file.name,
        fileSize: queuedFile.file.size,
      }),
    );

    setQueuedFiles((current) =>
      current.map((file) =>
        file.id === queuedFile.id
          ? { ...file, status: "uploading", progress: 0, error: null }
          : file,
      ),
    );

    try {
      const blob = await upload(
        buildBlobPath(projectId, queuedFile.id, queuedFile.file.name),
        queuedFile.file,
        {
          access: "public",
          handleUploadUrl: "/api/upload",
          clientPayload: JSON.stringify({
            projectId,
            milestoneId: milestoneId ?? null,
            fileId: queuedFile.id,
            fileName: queuedFile.file.name,
            fileSize: queuedFile.file.size,
          } satisfies ClientPayload),
          abortSignal: controller.signal,
          onUploadProgress: ({ percentage }) => {
            dispatch(
              updateProjectUploadProgress({
                projectId,
                fileId: queuedFile.id,
                progress: percentage,
              }),
            );

            setQueuedFiles((current) =>
              current.map((file) =>
                file.id === queuedFile.id
                  ? {
                      ...file,
                      status: "uploading",
                      progress: percentage,
                      error: null,
                    }
                  : file,
              ),
            );
          },
        },
      );

      dispatch(
        completeProjectUpload({
          projectId,
          fileId: queuedFile.id,
          url: blob.url,
        }),
      );

      setQueuedFiles((current) =>
        current.map((file) =>
          file.id === queuedFile.id
            ? {
                ...file,
                status: "uploaded",
                progress: 100,
                url: blob.url,
                error: null,
              }
            : file,
        ),
      );

      return blob.url;
    } finally {
      delete uploadControllersRef.current[queuedFile.id];
    }
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedNotes = notes.trim();

    if (!trimmedNotes) {
      const message = "Update notes are required";
      setErrorMessage(message);
      toast.error(message);
      return;
    }

    setErrorMessage(null);
    setUploading(true);

    try {
      const photoUrls =
        queuedFiles.length > 0
          ? await Promise.all(
              queuedFiles.map((queuedFile) => uploadQueuedFile(queuedFile)),
            )
          : [];

      await dispatch(
        addProjectUpdate({
          projectId,
          notes: trimmedNotes,
          milestoneId: milestoneId ?? null,
          photoUrls,
        }),
      ).unwrap();

      toast.success("Site update posted");
      onSuccess();
    } catch (error) {
      Object.values(uploadControllersRef.current).forEach((controller) =>
        controller.abort(),
      );
      uploadControllersRef.current = {};

      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      const message =
        error instanceof Error ? error.message : "Unable to post update";
      setErrorMessage(message);
      toast.error(message);

      if (queuedFiles.length > 0) {
        setQueuedFiles((current) =>
          current.map((file) =>
            file.status === "uploaded"
              ? file
              : file.status === "failed"
                ? file
                : { ...file, status: "failed", error: message },
          ),
        );

        queuedFiles.forEach((file) => {
          if (file.status !== "uploaded") {
            dispatch(
              failProjectUpload({
                projectId,
                fileId: file.id,
                error: message,
              }),
            );
          }
        });
      }
    } finally {
      setUploading(false);
      resetForm();
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[60vh] overflow-y-auto rounded-[14px] border-border bg-white p-0 shadow-lg sm:max-w-150">
        <DialogHeader className="flex flex-row items-center justify-between border-b border-border px-6 pb-4 pt-5">
          <div>
            <DialogTitle className="text-base font-bold">
              Add Site Update
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
              Uploads happen directly from the browser and publish immediately
              after the files finish.
            </DialogDescription>
          </div>
        </DialogHeader>

        <form className="space-y-4 px-6 pb-6 pt-5" onSubmit={(data) => startTransition(async() => await handleSubmit(data))}>
          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Milestone
            </label>
            <Select
              disabled={initialMilestoneId !== undefined}
              value={milestoneId ?? "__none__"}
              onValueChange={(value) =>
                setMilestoneId(value === "__none__" ? undefined : value)
              }
            >
              <SelectTrigger className="h-9 w-full rounded-[7px] bg-white px-3 py-2 text-[13px] transition-all focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10">
                <SelectValue placeholder="Optional" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No milestone</SelectItem>
                {milestones.map((milestone) => (
                  <SelectItem key={milestone.id} value={milestone.id}>
                    {milestone.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Update Title
            </label>
            <Input
              value={updatedNotesTitle}
              onChange={(event) => setUpdatedNotesTitle(event.target.value)}
              placeholder="Enter a title for the update..."
              required
              className="resize-y rounded-[7px] bg-white px-3 py-2 text-[13px] transition-all focus-visible:border-teal-600 focus-visible:ring-4 focus-visible:ring-teal-600/10"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Description
            </label>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Describe the progress, issues, next steps..."
              rows={4}
              required
              className="min-h-24 resize-y rounded-[7px] bg-white px-3 py-2 text-[13px] transition-all focus-visible:border-teal-600 focus-visible:ring-4 focus-visible:ring-teal-600/10"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Attach Photos
            </label>
            <div
              className="group cursor-pointer rounded-lg border-2 border-dashed border-border p-6 text-center transition-colors hover:border-teal-600 hover:bg-slate-50"
              onClick={() => fileInputRef.current?.click()}
            >
              <CloudUpload className="mx-auto mb-1.5 size-7 text-muted-foreground transition-colors group-hover:text-teal-600" />
              <span className="text-xs text-muted-foreground transition-colors group-hover:text-teal-600">
                {queuedFiles.length > 0
                  ? `${queuedFiles.length} photo${queuedFiles.length === 1 ? "" : "s"} selected (${completedUploadCount} uploaded)`
                  : "Click to upload photos (max 5)"}
              </span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileSelection}
            />
          </div>

          {queuedFiles.length > 0 && (
            <div className="space-y-2 rounded-xl border border-border/70 bg-muted/20 p-3">
              {queuedFiles.map((file) => (
                <div
                  key={file.id}
                  className="rounded-lg border border-border/70 bg-white p-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {file.file.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(file.file.size)}
                      </p>
                    </div>
                    <div className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      {file.status === "uploaded" ? (
                        <CheckCircle2 className="size-3.5 text-emerald-600" />
                      ) : null}
                      {file.status === "failed" ? (
                        <AlertCircle className="size-3.5 text-destructive" />
                      ) : null}
                      {file.status}
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-teal-600 transition-all"
                      style={{ width: `${file.progress}%` }}
                    />
                  </div>
                  {file.error ? (
                    <p className="mt-1 text-xs text-destructive">
                      {file.error}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {errorMessage ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {errorMessage}
            </div>
          ) : null}

          <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-9 rounded-[7px] px-3.5 text-[12.5px] font-medium transition-all hover:border-teal-600 hover:bg-slate-50 hover:text-teal-600"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !notes.trim()}
              className="h-9 rounded-[7px] bg-[#0D9488] px-3.5 text-[12.5px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-[#0F766E] hover:shadow-[0_4px_12px_rgba(13,148,136,0.3)]"
            >
              {isSubmitting ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Send className="mr-1.5 size-4" />
              )}
              Post Update & Notify
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
