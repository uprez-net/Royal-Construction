"use client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLeadSearch } from "@/hooks/useLeadSearch";
import { Loader2, Plus } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { UploadDropzone } from "../common/upload-dropzone";
import { QueuedUploadFile, useUploadQueue } from "@/hooks/use-upload-queue";
import { Button } from "../ui/button";
import { toast } from "sonner";
import { useAppDispatch } from "@/lib/store/hooks";
import {
  completeProjectUpload,
  failProjectUpload,
  registerProjectUpload,
  updateProjectUploadProgress,
} from "@/lib/store/slices/projectsSlice";
import { upload } from "@vercel/blob/client";
import { buildBlobPath } from "@/utils/formatters";
import { ClientPayload } from "@/utils/validators/files";
import { createOffer } from "@/lib/data/offers";
import { addOffer } from "@/lib/store/slices/offerSlice";
import { LeadCardList } from "./lead-card-list";
import { useRouter } from "next/navigation";

interface CreateOfferFileModalProps {
  open: boolean;
  onClose: () => void;
}

const maxFiles = 5;

export function CreateOfferFileModal({
  open,
  onClose,
}: CreateOfferFileModalProps) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const leadSearch = useLeadSearch("");
  const [search, setSearch] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
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
  const continuing: boolean = useMemo(() => {
    const selectedLead = leadSearch.items.find(
      (lead) => lead.id === selectedLeadId,
    );
    return selectedLead?.creatingOffer ?? false;
  }, [leadSearch.items, selectedLeadId]);

  const resetSearch = useCallback(() => {
    setSearch("");
    leadSearch.setQuery("");
  }, [leadSearch]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetSearch();
      resetQueue();
      onClose();
    }
  };

  const handleSubmit = async () => {
    if (!selectedLeadId) {
      toast.error("Please select a lead before creating an offer.");
      return;
    }
    if (continuing) {
      handleOpenChange(false);
      toast.info("Redirecting to offer...", { duration: 2000 });
      router.push(`/offers/${selectedLeadId}`);
      return;
    }
    const loading = toast.loading("Creating offer...");
    try {
      if (queuedFiles.length !== 0) {
        const uploads = await Promise.allSettled(
          queuedFiles.map((queuedFile) => uploadQueuedFile(queuedFile)),
        );
        const files = uploads
          .filter(
            (
              result,
            ): result is PromiseFulfilledResult<{ url: string; id: string }> =>
              result.status === "fulfilled",
          )
          .map((result) => result.value);

        if (files.length === 0 && queuedFiles.length > 0) {
          throw new Error("No files could be uploaded.");
        }
        toast.success(
          `${files.length} of ${queuedFiles.length} files(s) uploaded successfully.`,
        );
      }

      const newOffer = await createOffer(selectedLeadId);
      handleOpenChange(false);
      dispatch(addOffer(newOffer));
      toast.success("Offer created successfully.", { id: loading });
      toast.info("Redirecting to offer...");
      router.push(`/offers/${selectedLeadId}`);
    } catch (error) {
      console.error("Error creating offer:", error);
      toast.error("Failed to create offer. Please try again.", { id: loading });
      return;
    }
  };

  const uploadQueuedFile = async (queuedFile: QueuedUploadFile) => {
    if (!selectedLeadId) {
      throw new Error(
        "No lead selected for offer. Please select a lead and try again.",
      );
    }
    const controller = new AbortController();
    uploadControllersRef.current[queuedFile.id] = controller;

    dispatch(
      registerProjectUpload({
        projectId: `lead-${selectedLeadId}`,
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
          projectId: `lead-${selectedLeadId}`,
        }),
        queuedFile.file,
        {
          access: "public",
          handleUploadUrl: "/api/upload",
          clientPayload: JSON.stringify({
            leadId: selectedLeadId.toString(),
            fileId: queuedFile.id,
            fileName: queuedFile.file.name,
            fileSize: queuedFile.file.size,
            skipRecordCreation: false,
          } satisfies ClientPayload),
          abortSignal: controller.signal,
          onUploadProgress: ({ percentage }) => {
            dispatch(
              updateProjectUploadProgress({
                projectId: `lead-${selectedLeadId}`,
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
          projectId: `lead-${selectedLeadId}`,
          fileId: queuedFile.id,
          url: blob.url,
        }),
      );

      markUploaded(queuedFile.id, blob.url);

      return {
        url: blob.url,
        id: queuedFile.id,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to upload photo.";

      dispatch(
        failProjectUpload({
          projectId: `lead-${selectedLeadId}`,
          fileId: queuedFile.id,
          error: message,
        }),
      );

      markFailed(queuedFile.id, message);

      throw error instanceof Error ? error : new Error(message);
    } finally {
      delete uploadControllersRef.current[queuedFile.id];
    }
  };

  useEffect(() => {
    leadSearch.setQuery(search);
  }, [search, leadSearch]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Leads Directory</DialogTitle>
          <DialogDescription>
            Read-only directory of all active leads in the database.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 p-2 flex flex-col gap-6 max-h-[60vh] overflow-y-auto">
          <div className="space-y-4">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, company, or trade type"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />

            <LeadCardList
              loading={leadSearch.loading}
              items={leadSearch.items}
              selectedLeadId={selectedLeadId}
              setSelectedLeadId={setSelectedLeadId}
              setPage={leadSearch.setPage}
              currentPage={leadSearch.pageInfo.page}
              totalPages={leadSearch.pageInfo.totalPages}
              loadingMore={leadSearch.loadingMore}
            />
          </div>

          {!continuing && (
            <div className="space-y-1.5">
              <UploadDropzone
                label="Attach Files"
                summary={
                  queuedFiles.length > 0
                    ? `${queuedFiles.length} file${queuedFiles.length === 1 ? "" : "s"} selected · ${completedUploadCount} uploaded`
                    : "Click to upload files (max 5)"
                }
                helperText="Choose additional files to help understand user requirements."
                files={queuedFiles}
                accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
                maxFiles={maxFiles}
                disabled={isPending}
                isLoading={isPending}
                onFilesSelected={addFiles}
              />
            </div>
          )}
        </div>
        <DialogFooter className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              handleOpenChange(false);
            }}
            className="h-10 rounded-[10px] px-4 text-[12.5px] font-medium transition-all hover:border-teal-600 hover:bg-slate-50 hover:text-teal-600"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              startTransition(() => {
                handleSubmit();
              });
            }}
            disabled={isPending}
            className="h-10 rounded-[10px] bg-[#0D9488] px-4 text-[12.5px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-[#0F766E] hover:shadow-[0_6px_14px_rgba(13,148,136,0.26)]"
          >
            {isPending ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Plus className="mr-1.5 size-4" />
            )}
            {continuing ? "Continue Offer" : "Create Offer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
