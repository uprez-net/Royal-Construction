import { AlertTriangle, Forward, Send } from "lucide-react";

import { ReportIncidentInput, TradieRow } from "@/types/tradie";

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

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { useAppDispatch } from "@/lib/store/hooks";
import { reportTradieIncidentThunk } from "@/lib/store/slices/tradieManagementSlice";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { UploadDropzone } from "@/components/common/upload-dropzone";
import { QueuedUploadFile, useUploadQueue } from "@/hooks/use-upload-queue";
import {
  clearProjectUploads,
  completeProjectUpload,
  registerProjectUpload,
  updateProjectUploadProgress,
} from "@/lib/store/slices/projectsSlice";
import { upload } from "@vercel/blob/client";
import { buildBlobPath, formatStatus } from "@/utils/formatters";
import { ClientPayload } from "@/utils/validators";
import { useUploadHints } from "@/components/common/upload-hints";

interface ReportTradieModalProps {
  open: boolean;
  tradie: TradieRow;
  onClose: () => void;
}

export const INCIDENT_TYPES = [
  "SAFETY",
  "QUALITY",
  "BEHAVIOUR",
  "ATTENDANCE",
  "DAMAGE",
  "OTHER",
] as const;

const INCIDENT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

const maxFiles = 5;

export default function ReportTradieModal({
  open,
  tradie,
  onClose,
}: ReportTradieModalProps) {
  const dispatch = useAppDispatch();
  const [isPending, startTransition] = useTransition();
  const {
    files: queuedFiles,
    completedCount: completedUploadCount,
    addFiles,
    resetQueue,
    markUploading,
    updateProgress,
    markUploaded,
    removeFile,
  } = useUploadQueue({ maxFiles });
  const uploadControllersRef = useRef<Record<string, AbortController>>({});
  // The projects slice's upload map is generic keyed storage, but its key space
  // is project ids — and `setProjects`/detail sync delete entries by project id.
  // Filing a tradie id under that key raw risks a collision that would silently
  // drop this modal's upload progress, so the tradie id space is namespaced.
  const uploadScopeKey = `tradie:${tradie.id}`;
  const hintsFor = useUploadHints();
  const [formData, setFormData] = useState<
    Omit<ReportIncidentInput, "tradieId" | "fileIds">
  >({
    incidentType: "",
    incidentSeverity: "LOW",
    incidentDescription: "",
  });
  // A pristine required field is not an error. Without this, both controls are
  // announced as invalid the moment the dialog opens.
  const [touched, setTouched] = useState({
    incidentType: false,
    incidentDescription: false,
  });

  const markTouched = (field: keyof typeof touched) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      Object.values(uploadControllersRef.current).forEach((controller) => {
        controller.abort();
      });
      onClose();
      resetQueue();
      setTouched({ incidentType: false, incidentDescription: false });
      dispatch(clearProjectUploads(uploadScopeKey));
    }
  };

  const uploadQueuedFile = async (queuedFile: QueuedUploadFile) => {
    const controller = new AbortController();
    uploadControllersRef.current[queuedFile.id] = controller;

    dispatch(
      registerProjectUpload({
        projectId: uploadScopeKey,
        fileId: queuedFile.id,
        fileName: queuedFile.file.name,
        fileSize: queuedFile.file.size,
      }),
    );

    markUploading(queuedFile.id);

    try {
      const blob = await upload(
        buildBlobPath({
          fileId: queuedFile.id,
          fileName: queuedFile.file.name,
          tradieId: tradie.id,
        }),
        queuedFile.file,
        {
          access: "public",
          handleUploadUrl: "/api/upload",
          clientPayload: JSON.stringify({
            tradieId: tradie.id,
            fileId: queuedFile.id,
            fileName: queuedFile.file.name,
            fileSize: queuedFile.file.size,
            isOfferFile: false,
            ...hintsFor({
              rootTrail: true,
              trail: ["Tradies", tradie.name, "Report incident"],
              tags: ["Incident report", "Tradie", tradie.name],
            }),
          } satisfies ClientPayload),
          abortSignal: controller.signal,
          onUploadProgress: ({ percentage }) => {
            dispatch(
              updateProjectUploadProgress({
                projectId: uploadScopeKey,
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
          projectId: uploadScopeKey,
          fileId: queuedFile.id,
          url: blob.url,
        }),
      );

      markUploaded(queuedFile.id, blob.url);

      return {
        fileId: queuedFile.id,
        url: blob.url,
      };
    } finally {
      delete uploadControllersRef.current[queuedFile.id];
    }
  };

  const handleSubmit = () => {
    if (!formData.incidentType) {
      toast.error("Please select an incident type.");
      return;
    }

    if (!formData.incidentDescription.trim()) {
      toast.error("Please provide an incident description.");
      return;
    }

    startTransition(async () => {
      try {
        const files =
          queuedFiles.length > 0
            ? await Promise.all(
                queuedFiles.map((queuedFile) => uploadQueuedFile(queuedFile)),
              )
            : [];
        await dispatch(
          reportTradieIncidentThunk({
            tradieId: tradie.id,
            incidentType: formData.incidentType,
            incidentSeverity: formData.incidentSeverity,
            incidentDescription: formData.incidentDescription,
            fileIds: files.map((file) => file.fileId),
          }),
        ).unwrap();

        toast.success("Incident reported successfully.");

        // Closing is single-sourced through handleOpenChange so the queue reset
        // and the upload-progress cleanup run on every exit path, not just the
        // dialog's own dismissal.
        handleOpenChange(false);
      } catch (error) {
        toast.error("Error reporting tradie. Please try again.");
        console.error(error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-135">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle
              className="h-5 w-5 text-destructive"
              aria-hidden="true"
            />
            Report incident
          </DialogTitle>

          <DialogDescription>
            {tradie.name} &middot; {tradie.trade}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Type + severity */}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="incident-type">
                Incident type
                <span className="text-destructive">
                  *<span className="sr-only"> required</span>
                </span>
              </Label>

              <Select
                value={formData.incidentType}
                onValueChange={(value) => {
                  markTouched("incidentType");
                  setFormData((prev) => ({
                    ...prev,
                    incidentType: value,
                  }));
                }}
              >
                <SelectTrigger
                  id="incident-type"
                  aria-invalid={touched.incidentType && !formData.incidentType}
                  onBlur={() => markTouched("incidentType")}
                >
                  <SelectValue placeholder="Select incident type…" />
                </SelectTrigger>

                <SelectContent>
                  {INCIDENT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {formatStatus(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="incident-severity">
                Severity
                <span className="text-destructive">
                  *<span className="sr-only"> required</span>
                </span>
              </Label>

              <Select
                value={formData.incidentSeverity}
                onValueChange={(value) =>
                  setFormData((prev) => ({
                    ...prev,
                    incidentSeverity:
                      value as ReportIncidentInput["incidentSeverity"],
                  }))
                }
              >
                <SelectTrigger id="incident-severity">
                  <SelectValue placeholder="Select severity…" />
                </SelectTrigger>

                <SelectContent>
                  {INCIDENT_SEVERITIES.map((severity) => (
                    <SelectItem key={severity} value={severity}>
                      {formatStatus(severity)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Description */}

          <div className="space-y-2">
            <Label htmlFor="incident-description">
              Description
              <span className="text-destructive">
                *<span className="sr-only"> required</span>
              </span>
            </Label>

            <Textarea
              id="incident-description"
              rows={5}
              required
              placeholder="Describe what happened in detail…"
              value={formData.incidentDescription}
              aria-invalid={
                touched.incidentDescription &&
                !formData.incidentDescription.trim()
              }
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  incidentDescription: e.target.value,
                }))
              }
              onBlur={() => markTouched("incidentDescription")}
            />
          </div>

          {/* Upload */}

          <div className="space-y-2">
            <UploadDropzone
              label="Attach Photos"
              summary={
                queuedFiles.length > 0
                  ? `${queuedFiles.length} file${queuedFiles.length === 1 ? "" : "s"} selected (${completedUploadCount} uploaded)`
                  : "Click to upload files (max 5)"
              }
              helperText="Files upload directly from the browser and stay visible below while they sync."
              files={queuedFiles}
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
              maxFiles={maxFiles}
              disabled={isPending}
              isLoading={isPending}
              onFilesSelected={addFiles}
              removeFile={removeFile}
            />
          </div>

          {/* Notice */}

          <div className="rounded-lg bg-destructive-light p-3">
            <div className="flex gap-3">
              <Forward
                className="mt-0.5 h-4 w-4 shrink-0 text-destructive-ink"
                aria-hidden="true"
              />

              <p className="text-xs leading-relaxed text-foreground/80">
                This report is forwarded directly for further review and action.
              </p>
            </div>
          </div>

          {/* Footer */}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>

            <Button
              variant="destructive"
              onClick={handleSubmit}
              disabled={
                isPending ||
                !formData.incidentType ||
                !formData.incidentDescription.trim()
              }
            >
              <Send className="mr-2 h-4 w-4" aria-hidden="true" />

              {isPending ? "Submitting…" : "Submit report"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
