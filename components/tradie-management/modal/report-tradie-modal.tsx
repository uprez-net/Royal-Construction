import { AlertTriangle, Forward, ImagePlus, Send } from "lucide-react";

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
import { buildBlobPath } from "@/utils/formatters";
import { ClientPayload } from "@/utils/validators";

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

const startCase = (str: string) =>
  str
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

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
    markFailed,
  } = useUploadQueue({ maxFiles });
  const uploadControllersRef = useRef<Record<string, AbortController>>({});
  const [formData, setFormData] = useState<
    Omit<ReportIncidentInput, "tradieId" | "fileIds">
  >({
    incidentType: "",
    incidentSeverity: "LOW",
    incidentDescription: "",
  });

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
      uploadControllersRef.current = {};
      resetQueue();
      dispatch(clearProjectUploads(tradie.id));
    }
  };

  const uploadQueuedFile = async (queuedFile: QueuedUploadFile) => {
    const controller = new AbortController();
    uploadControllersRef.current[queuedFile.id] = controller;

    dispatch(
      registerProjectUpload({
        projectId: tradie.id,
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
          } satisfies ClientPayload),
          abortSignal: controller.signal,
          onUploadProgress: ({ percentage }) => {
            dispatch(
              updateProjectUploadProgress({
                projectId: tradie.id,
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
          projectId: tradie.id,
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

        onClose();
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
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Report Incident
          </DialogTitle>

          <DialogDescription>
            {tradie.name} • {tradie.trade}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Type + Severity */}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>
                Incident Type
                <span className="text-destructive ml-1">*</span>
              </Label>

              <Select
                value={formData.incidentType}
                onValueChange={(value) =>
                  setFormData((prev) => ({
                    ...prev,
                    incidentType: value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="SAFETY">Safety</SelectItem>

                  <SelectItem value="QUALITY">Quality</SelectItem>

                  <SelectItem value="BEHAVIOUR">Behaviour</SelectItem>

                  <SelectItem value="ATTENDANCE">Attendance</SelectItem>

                  <SelectItem value="DAMAGE">Damage</SelectItem>

                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>
                Severity
                <span className="text-destructive ml-1">*</span>
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
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  {INCIDENT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {startCase(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Description */}

          <div className="space-y-2">
            <Label>
              Description
              <span className="text-destructive ml-1">*</span>
            </Label>

            <Textarea
              rows={5}
              placeholder="Describe what happened in detail..."
              value={formData.incidentDescription}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  incidentDescription: e.target.value,
                }))
              }
            />
          </div>

          {/* Upload */}

          <div className="space-y-2">
            <UploadDropzone
              label="Attach Photos"
              summary={
                queuedFiles.length > 0
                  ? `${queuedFiles.length} photo${queuedFiles.length === 1 ? "" : "s"} selected (${completedUploadCount} uploaded)`
                  : "Click to upload photos (max 5)"
              }
              helperText="Images upload directly from the browser and stay visible below while they sync."
              files={queuedFiles}
              accept="image/*"
              maxFiles={maxFiles}
              disabled={isPending}
              isLoading={isPending}
              onFilesSelected={addFiles}
            />
          </div>

          {/* Notice */}

          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
            <div className="flex gap-3">
              <Forward className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />

              <p className="text-xs leading-relaxed text-muted-foreground">
                This report will be forwarded directly for further review and
                action.
              </p>
            </div>
          </div>

          {/* Footer */}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>

            <Button
              variant="destructive"
              onClick={handleSubmit}
              disabled={isPending}
            >
              <Send className="mr-2 h-4 w-4" />

              {isPending ? "Submitting..." : "Submit Report"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
