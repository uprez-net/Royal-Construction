import { File as DBFile } from "@prisma/client";
import { Button } from "../ui/button";
import { Loader2, UploadIcon, X } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { upload } from "@vercel/blob/client";
import { buildBlobPath } from "@/utils/formatters";
import { v4 as uuidv4 } from "uuid";
import { ClientPayload } from "@/utils/validators/files";

interface UploadButtonProps {
  maxFiles?: number;
  leadId?: string;
  projectId?: string;
  milestoneId?: string;
  onUpload: (file: DBFile[]) => void;
}

const DEFAULT_MAX_FILES = 5;

export function UploadButton({
  maxFiles = DEFAULT_MAX_FILES,
  leadId,
  projectId,
  milestoneId,
  onUpload,
}: UploadButtonProps) {
  const [isUploading, startTransition] = useTransition();
  const [uploadingFiles, setUploadingFiles] = useState<number>(0);
  const [overallProgress, setOverallProgress] = useState<number>(0);
  const uploadControllerRef = useRef<AbortController | null>(null);
  const progressMap = useRef<Record<string, number>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetUploadState = () => {
    setUploadingFiles(0);
    setOverallProgress(0);
    progressMap.current = {};
    uploadControllerRef.current = null;
  };

  const updateOverallProgress = () => {
    const values = Object.values(progressMap.current);

    if (values.length === 0) {
      setOverallProgress(0);
      return;
    }

    const total = values.reduce((sum, progress) => sum + progress, 0);

    setOverallProgress(Math.round(total / values.length));
  };

  const uploader = async (file: File, controller: AbortController) => {
    try {
      const fileId = uuidv4(); // Generate a unique ID for the file
      const blob = await upload(
        buildBlobPath({
          fileId: fileId,
          fileName: file.name,
          projectId,
          milestoneId,
          leadId,
        }),
        file,
        {
          access: "public",
          handleUploadUrl: "/api/upload",
          clientPayload: JSON.stringify({
            projectId,
            milestoneId,
            fileId: fileId,
            fileName: file.name,
            fileSize: file.size,
            leadId,
            skipRecordCreation: false,
          } satisfies ClientPayload),
          abortSignal: controller.signal,
          onUploadProgress: ({ percentage }) => {
            progressMap.current[fileId] = percentage;
            updateOverallProgress();
          },
        },
      );

      progressMap.current[fileId] = 100;
      updateOverallProgress();

      return {
        id: fileId,
        projectId: projectId ?? null,
        milestoneId: milestoneId ?? null,
        leadId: leadId ? parseInt(leadId) : null,
        filename: file.name,
        fileType: blob.contentType,
        filesize: file.size,
        url: blob.url,
        uploadedBy: "current_user", // Replace with actual user info if available
        createdAt: new Date(),
        updatedAt: new Date(),
      } satisfies DBFile;
    } catch (error) {
      console.error("Error uploading file:", error);
      toast.error("Failed to upload file. Please try again.");
      throw error; // Rethrow to be caught in the parent function
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      toast.error("No file selected for upload.");
      return;
    }
    if (files.length > maxFiles) {
      toast.error(`You can only upload up to ${maxFiles} files at a time.`);
      return;
    }

    try {
      // Only one controller for all files, so that we can cancel all uploads if needed
      const controller = new AbortController();
      uploadControllerRef.current = controller;
      setUploadingFiles(files.length);
      const res = await Promise.allSettled(
        Array.from(files).map((file) => uploader(file, controller)),
      );
      const successfulUploads = res.filter(
        (result) => result.status === "fulfilled",
      );
      if (successfulUploads.length > 0) {
        onUpload(successfulUploads.map((result) => result.value));
        toast.success(
          `Successfully uploaded ${successfulUploads.length} file(s).`,
        );
      }
      const failedUploads = res.filter(
        (result) => result.status === "rejected",
      );
      if (failedUploads.length > 0) {
        toast.error(
          `Failed to upload ${failedUploads.length} file(s). Please try again.`,
        );
      }
    } catch (error) {
      console.error("Error uploading file:", error);
      toast.error("Failed to upload file. Please try again.");
    } finally {
      resetUploadState();
      if (fileInputRef.current) {
        fileInputRef.current.value = ""; // Reset the file input
      }
    }
  };

  const cancelUploads = () => {
    if (uploadControllerRef.current) {
      uploadControllerRef.current.abort();
      toast.info("Upload cancelled.");
      resetUploadState();
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="
            application/pdf,
            application/msword,
            application/vnd.openxmlformats-officedocument.wordprocessingml.document,
            application/vnd.ms-excel,
            application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,
            text/csv,
            .csv,
            .doc,
            .docx,
            .xls,
            .xlsx,
            .pdf
        "
        max={maxFiles}
        disabled={isUploading}
        className="hidden"
        onChange={(e) => startTransition(async () => await handleUpload(e))}
      />

      <Button
        variant="outline"
        size="sm"
        disabled={isUploading}
        onClick={() => fileInputRef.current?.click()}
      >
        {isUploading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {overallProgress}% ({uploadingFiles} files)
          </>
        ) : (
          <>
            <UploadIcon className="mr-2 h-4 w-4" />
            Upload Files
          </>
        )}
      </Button>

      {isUploading && (
        <Button variant="destructive" size="icon" onClick={cancelUploads}>
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
