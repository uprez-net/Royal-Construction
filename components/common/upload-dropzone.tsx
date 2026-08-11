"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CloudUpload,
  Loader2,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { QueuedUploadFile } from "@/hooks/use-upload-queue";
import { formatFileSize } from "@/utils/formatters";

type UploadDropzoneProps = {
  label: string;
  summary: ReactNode;
  helperText?: ReactNode;
  files: QueuedUploadFile[];
  onFilesSelected: (files: File[]) => void;
  removeFile: (fileId: string) => void;
  errorMessage?: ReactNode;
  accept?: string;
  multiple?: boolean;
  maxFiles?: number;
  disabled?: boolean;
  isLoading?: boolean;
  className?: string;
  dropzoneClassName?: string;
  listClassName?: string;
  itemClassName?: string;
  emptyState?: ReactNode;
  renderFilePreview?: (file: QueuedUploadFile) => ReactNode;
};

export function UploadDropzone({
  label,
  summary,
  helperText,
  files,
  onFilesSelected,
  removeFile,
  errorMessage,
  accept,
  multiple = true,
  maxFiles,
  disabled = false,
  isLoading = false,
  className,
  dropzoneClassName,
  listClassName,
  itemClassName,
  emptyState,
  renderFilePreview,
}: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDisabled = disabled || isLoading;

  const openPicker = () => {
    if (isDisabled) {
      return;
    }

    fileInputRef.current?.click();
  };

  const getRemainingSlots = () => {
    if (typeof maxFiles !== "number") {
      return Number.POSITIVE_INFINITY;
    }

    return Math.max(maxFiles - files.length, 0);
  };

  const handleSelectedFiles = (selectedFiles: File[]) => {
    if (isDisabled || selectedFiles.length === 0) {
      return;
    }

    const allowedFiles = selectedFiles.slice(0, getRemainingSlots());

    if (allowedFiles.length === 0) {
      return;
    }

    onFilesSelected(allowedFiles);
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleSelectedFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    handleSelectedFiles(Array.from(event.dataTransfer.files ?? []));
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="block text-xs font-medium text-muted-foreground">
        {label}
      </label>

      <div
        role="button"
        tabIndex={0}
        aria-disabled={isDisabled}
        onClick={openPicker}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!isDisabled) {
            setIsDragging(true);
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!isDisabled) {
            setIsDragging(true);
          }
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setIsDragging(false);
        }}
        onDrop={handleDrop}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPicker();
          }
        }}
        className={cn(
          "group cursor-pointer rounded-xl border-2 border-dashed border-border/80 bg-muted/40 p-6 text-center transition-colors outline-none",
          "hover:border-primary hover:bg-primary/5 focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          isDragging && "border-primary bg-primary/5",
          isDisabled && "cursor-not-allowed opacity-70",
          dropzoneClassName,
        )}
      >
        <CloudUpload
          className="mx-auto mb-2 size-8 text-muted-foreground transition-colors group-hover:text-primary"
          aria-hidden="true"
        />

        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground transition-colors group-hover:text-primary">
            {summary}
          </p>

          {helperText ? (
            <p className="text-xs text-muted-foreground">{helperText}</p>
          ) : null}
        </div>

        {isLoading ? (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
            <Loader2
              className="size-3.5 animate-spin text-primary motion-reduce:animate-none"
              aria-hidden="true"
            />
            Uploading…
          </div>
        ) : null}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={handleInputChange}
      />

      {files.length > 0 ? (
        <div
          className={cn(
            "space-y-2 rounded-xl border border-border/70 bg-muted/40 p-3.5",
            listClassName,
          )}
        >
          {files.map((file) => (
            <div
              key={file.id}
              className={cn(
                "rounded-lg border border-border/70 bg-card p-3 shadow-sm",
                itemClassName,
              )}
            >
              <div className="flex items-start gap-3">
                {renderFilePreview ? (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-muted/40">
                    {renderFilePreview(file)}
                  </div>
                ) : null}

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {file.file.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(file.file.size)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {file.status === "uploading" ? (
                          <Loader2
                            className="size-3.5 animate-spin text-primary motion-reduce:animate-none"
                            aria-hidden="true"
                          />
                        ) : null}
                        {file.status === "uploaded" ? (
                          <CheckCircle2
                            className="size-3.5 text-success-ink"
                            aria-hidden="true"
                          />
                        ) : null}
                        {file.status === "failed" ? (
                          <AlertCircle
                            className="size-3.5 text-destructive-ink"
                            aria-hidden="true"
                          />
                        ) : null}
                        {file.status}
                      </div>
                      {/* Remove Button */}
                      {file.status === "queued" && (
                        <button
                          type="button"
                          aria-label={`Remove ${file.file.name}`}
                          className="rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          onClick={() => removeFile(file.id)}
                        >
                          <X className="size-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={Math.round(file.progress)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Upload progress for ${file.file.name}`}
                  >
                    <div
                      className={cn(
                        "h-full rounded-full bg-primary transition-[width] duration-200 ease-out motion-reduce:transition-none",
                        file.status === "failed" && "bg-destructive",
                      )}
                      style={{ width: `${file.progress}%` }}
                    />
                  </div>

                  {file.error ? (
                    <p className="mt-1 text-xs text-destructive">
                      {file.error}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : emptyState ? (
        <div className="rounded-xl border border-border/70 bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          {emptyState}
        </div>
      ) : null}

      {errorMessage ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive-light px-3 py-2 text-sm text-destructive-ink"
        >
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
}
