import { UploadDropzone } from "@/components/common/upload-dropzone";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueuedUploadFile, useUploadQueue } from "@/hooks/use-upload-queue";
import { useAppDispatch } from "@/lib/store/hooks";
import {
  completeProjectUpload,
  registerProjectUpload,
  updateProjectUploadProgress,
} from "@/lib/store/slices/projectsSlice";
import { cn } from "@/lib/utils";
import { ClientPayload } from "@/utils/validators/files";
import { upload } from "@vercel/blob/client";
import { ChevronDown, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

interface EmailContent {
  subject: string;
  body: string;
  attachments: { name: string; url: string }[];
}

interface CollapsibleEmailContentProps {
  rowId: string;
  emailContent: EmailContent;
  onChange: (emailContent: EmailContent) => void;
}

export function CollapsibleEmailContent({
  rowId,
  emailContent,
  onChange,
}: CollapsibleEmailContentProps) {
  const dispatch = useAppDispatch();
  const maxFiles = 5;

  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);

  const emailRenderIframeRef = useRef<HTMLIFrameElement | null>(null);
  const uploadControllersRef = useRef<Record<string, AbortController>>({});

  const {
    files: queuedFiles,
    completedCount: completedUploadCount,
    addFiles,
    removeFile,
    resetQueue,
    markUploading,
    updateProgress,
    markUploaded,
  } = useUploadQueue({ maxFiles });

  const uploadQueuedFile = async (queuedFile: QueuedUploadFile) => {
    const controller = new AbortController();
    uploadControllersRef.current[queuedFile.id] = controller;

    dispatch(
      registerProjectUpload({
        projectId: `project-${rowId}`,
        fileId: queuedFile.id,
        fileName: queuedFile.file.name,
        fileSize: queuedFile.file.size,
      }),
    );

    markUploading(queuedFile.id);

    try {
      const blob = await upload(
        `email-attachments/${queuedFile.file.name}`,
        queuedFile.file,
        {
          access: "public",
          handleUploadUrl: "/api/upload",
          clientPayload: JSON.stringify({
            fileId: queuedFile.id,
            fileName: queuedFile.file.name,
            fileSize: queuedFile.file.size,
            isOfferFile: false,
          } satisfies ClientPayload),
          abortSignal: controller.signal,
          onUploadProgress: ({ percentage }) => {
            dispatch(
              updateProjectUploadProgress({
                projectId: `project-${rowId}`,
                fileId: queuedFile.id,
                progress: percentage,
              }),
            );
            updateProgress(queuedFile.id, percentage);
          },
        },
      );

      dispatch(
        completeProjectUpload({
          projectId: `project-${rowId}`,
          fileId: queuedFile.id,
          url: blob.url,
        }),
      );

      markUploaded(queuedFile.id, blob.url);
      return blob.url;
    } finally {
      delete uploadControllersRef.current[queuedFile.id];
    }
  };

  /** Persists subject, iframe body, and any pending attachments. Returns success. */
  const handleSave = async (): Promise<boolean> => {
    setIsSubmitting(true);
    try {
      const iframeDocument = emailRenderIframeRef.current?.contentDocument;

      const uploadedFiles = await Promise.all(
        queuedFiles.map(async (file) => {
          if (file.status === "uploaded" && file.url) {
            return { name: file.file.name, url: file.url };
          }
          if (file.status === "queued" || file.status === "uploading") {
            const url = await uploadQueuedFile(file);
            return { name: file.file.name, url };
          }
          throw new Error(`"${file.file.name}" failed to upload.`);
        }),
      );

      onChange({
        subject: emailContent.subject,
        body: iframeDocument
          ? iframeDocument.documentElement.outerHTML
          : emailContent.body,
        attachments: uploadedFiles,
      });

      toast.success("Email content saved.");
      return true;
    } catch (error) {
      console.error("Error saving email content:", error);
      toast.error("Failed to save email content. Please try again.");
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  /** Discards local edits and reverts to the last-saved emailContent. */
  const handleReset = () => {
    Object.values(uploadControllersRef.current).forEach((controller) =>
      controller.abort(),
    );
    uploadControllersRef.current = {};

    resetQueue();
    setIframeKey((key) => key + 1); // force iframe remount to discard in-place edits
  };

  /** Save before collapsing so nothing typed is lost when the section closes. */
  const handleOpenChange = async (open: boolean) => {
    if (!open && isOpen) {
      const saved = await handleSave();
      if (!saved) return; // keep it open if save failed
    }
    setIsOpen(open);
  };

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={handleOpenChange}
      className="rounded-lg border bg-card"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50"
        >
          <span>Email Content</span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform duration-200",
              isOpen && "rotate-180",
            )}
          />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-3 border-t px-3 py-3">
        <div className="space-y-1.5">
          <Label
            htmlFor={`subject-${rowId}`}
            className="text-xs text-muted-foreground"
          >
            Subject
          </Label>
          <Input
            id={`subject-${rowId}`}
            value={emailContent.subject}
            onChange={(e) => onChange({ ...emailContent, subject: e.target.value })}
            disabled={isSubmitting}
            className="h-8 text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Body</Label>
          <iframe
            key={iframeKey}
            ref={emailRenderIframeRef}
            srcDoc={emailContent.body}
            title="Email Preview"
            sandbox="allow-same-origin allow-scripts"
            className="w-3xl h-240 rounded-md border bg-background no-scrollbar"
          />
        </div>

        <UploadDropzone
          label="Attach Files"
          summary={
            queuedFiles.length > 0
              ? `${queuedFiles.length} file${queuedFiles.length === 1 ? "" : "s"} selected (${completedUploadCount} uploaded)`
              : `Select files to upload (max ${maxFiles})`
          }
          helperText="Files upload directly from the browser and stay visible below while they sync."
          files={queuedFiles}
          accept="image/*"
          maxFiles={maxFiles}
          disabled={isSubmitting}
          isLoading={isSubmitting}
          onFilesSelected={addFiles}
          removeFile={removeFile}
        />

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={isSubmitting}
          >
            Reset
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => handleSave()}
            disabled={isSubmitting}
          >
            {isSubmitting && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            Save
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
