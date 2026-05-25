"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CloudUpload,
  Loader2,
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
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
          "group cursor-pointer rounded-[16px] border-2 border-dashed border-border/80 bg-slate-50/50 p-6 text-center transition-all outline-none",
          "hover:border-teal-600 hover:bg-teal-50/40 focus-visible:border-teal-600 focus-visible:ring-4 focus-visible:ring-teal-600/10",
          isDragging && "border-teal-600 bg-teal-50/60 shadow-[0_0_0_4px_rgba(13,148,136,0.08)]",
          isDisabled && "cursor-not-allowed opacity-70",
          dropzoneClassName,
        )}
      >
        <CloudUpload className="mx-auto mb-2 size-8 text-muted-foreground transition-colors group-hover:text-teal-600" />

        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-700 transition-colors group-hover:text-teal-700">
            {summary}
          </p>

          {helperText ? (
            <p className="text-xs text-slate-500">{helperText}</p>
          ) : null}
        </div>

        {isLoading ? (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1 text-[11px] font-medium text-slate-600 shadow-sm">
            <Loader2 className="size-3.5 animate-spin text-teal-600" />
            Uploading...
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
            "space-y-2 rounded-[14px] border border-border/70 bg-slate-50/60 p-3.5",
            listClassName,
          )}
        >
          {files.map((file) => (
            <div
              key={file.id}
              className={cn(
                "rounded-[12px] border border-border/70 bg-white p-3 shadow-sm",
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

                    <div className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      {file.status === "uploading" ? (
                        <Loader2 className="size-3.5 animate-spin text-teal-600" />
                      ) : null}
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
                      className={cn(
                        "h-full rounded-full bg-teal-600 transition-all",
                        file.status === "failed" && "bg-destructive",
                      )}
                      style={{ width: `${file.progress}%` }}
                    />
                  </div>

                  {file.error ? (
                    <p className="mt-1 text-xs text-destructive">{file.error}</p>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : emptyState ? (
        <div className="rounded-[14px] border border-border/70 bg-slate-50/60 px-4 py-3 text-xs text-slate-500">
          {emptyState}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded-[12px] border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
}