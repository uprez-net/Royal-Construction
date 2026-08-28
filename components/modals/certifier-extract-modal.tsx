"use client";

import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWorkflowStream } from "@/context/WorkFlowStatusContext";
import { useAppDispatch } from "@/lib/store/hooks";
import { refreshCertifierEngagement } from "@/lib/store/slices/projectsSlice";
import { cn } from "@/lib/utils";
import { CHECKLIST_EXTRACTION_PROGRESS } from "@/types/compliance-workflow";
import { fetchJson } from "@/utils/fetch";

type CertifierExtractModalProps = {
  projectId: string;
  engagementId: string;
  documentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Runs the checklist extraction and follows it live.
 *
 * The stage list comes from the shared wire contract the workflow emits
 * against, rather than being re-declared here. create-project-modal.tsx keeps
 * its own copy of the tender stages, and when those two drift `indexOf(stage)`
 * returns -1 and the bar silently stops moving — a bug with no error attached.
 */
export function CertifierExtractModal({
  projectId,
  engagementId,
  documentId,
  open,
  onOpenChange,
}: CertifierExtractModalProps) {
  const dispatch = useAppDispatch();
  const { extractingChecklist, startListening, stopListening, reset } =
    useWorkflowStream();
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const startedRef = useRef(false);

  // Started once per mount. A re-render must not fire a second run: the
  // workflow rewrites the whole checklist, so two concurrent runs would race
  // each other's item rows.
  useEffect(() => {
    if (!open || startedRef.current) {
      return;
    }
    startedRef.current = true;

    void (async () => {
      setIsStarting(true);
      try {
        const response = await fetchJson<{ runId: string }>(
          "/api/extract-checklist",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId, engagementId, documentId }),
          },
          "Could not start the checklist extraction",
        );
        startListening(response.data.runId);
      } catch (startError) {
        setError(
          startError instanceof Error
            ? startError.message
            : "Could not start the checklist extraction.",
        );
      } finally {
        setIsStarting(false);
      }
    })();
  }, [open, projectId, engagementId, documentId, startListening]);

  const stage =
    extractingChecklist?.type === "stage" ? extractingChecklist : null;
  const result =
    extractingChecklist?.type === "result" ? extractingChecklist.result : null;
  const streamError =
    extractingChecklist?.type === "error" ? extractingChecklist.message : null;

  // The workflow writes the rows itself, so the store only learns about them
  // when it re-reads.
  useEffect(() => {
    if (result?.status === "success") {
      void dispatch(refreshCertifierEngagement({ projectId }));
      toast.success(result.message);
    }
  }, [result, dispatch, projectId]);

  const activeIndex = stage?.index ?? -1;
  const isDone = result !== null;
  const failure = error ?? streamError ?? result?.error ?? null;

  const handleClose = () => {
    stopListening();
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isDone ? "Checklist extracted" : "Checklist being extracted…"}
          </DialogTitle>
          <DialogDescription>
            Reading the certifier&apos;s checklist and turning each item into
            something you can upload against.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-1 py-2">
          {CHECKLIST_EXTRACTION_PROGRESS.map((label, index) => {
            const complete = isDone || index < activeIndex;
            const active = !isDone && index === activeIndex;
            return (
              <li
                key={label}
                className="flex items-center gap-3 rounded-lg px-3 py-2"
              >
                <span className="shrink-0">
                  {complete ? (
                    <CheckCircle2
                      className="size-4 text-success-ink"
                      aria-hidden="true"
                    />
                  ) : active ? (
                    <Loader2
                      className="size-4 animate-spin text-primary"
                      aria-hidden="true"
                    />
                  ) : (
                    <span className="block size-4 rounded-full border border-border" />
                  )}
                </span>
                <span
                  className={cn(
                    "text-sm",
                    complete || active
                      ? "text-foreground"
                      : "text-muted-foreground/70",
                  )}
                >
                  {label}
                </span>
              </li>
            );
          })}
        </ul>

        {failure ? (
          <p className="flex items-start gap-2 text-sm text-destructive-ink">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {failure}
          </p>
        ) : result ? (
          <p className="text-sm text-muted-foreground">{result.message}</p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant={isDone || failure ? "default" : "outline"}
            onClick={handleClose}
            disabled={isStarting}
          >
            {isDone || failure ? "Done" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
