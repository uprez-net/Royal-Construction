"use client";

import { type SubmitEvent, useState, useTransition } from "react";
import { AlertCircle, FilePlus2, Loader2, Info } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { createVariation } from "@/lib/store/slices/projectsSlice";

const fieldClassName = "h-9 rounded-[7px] bg-background px-3 py-2 text-sm";
const labelClassName = "text-xs font-medium text-foreground";

function RequiredMark() {
  return (
    <span className="ml-0.5 text-destructive-ink" aria-hidden="true">
      *
    </span>
  );
}

export function CreateVariationModal({
  projectId,
  open,
  onOpenChange,
  onSuccess,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const dispatch = useAppDispatch();
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const mutation = useAppSelector(
    (state) => state.projects.mutations.createVariation,
  );

  const resetForm = () => {
    setDescription("");
    setCost("");
    setSubmitError(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetForm();
    }

    onOpenChange(nextOpen);
  };

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedDescription = description.trim();
    const parsedCost = Number(cost);
    const isCostValid = Number.isFinite(parsedCost) && parsedCost > 0;

    if (!trimmedDescription || !isCostValid) {
      const message =
        "Enter a variation description and a cost impact above 0.";
      setSubmitError(message);
      toast.error(message);
      return;
    }

    setSubmitError(null);

    try {
      await dispatch(
        createVariation({
          projectId,
          description: trimmedDescription,
          cost: parsedCost,
          requestedDate: new Date().toISOString(),
        }),
      ).unwrap();

      toast.success("Variation added to the log.");
      resetForm();
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to create variation";
      setSubmitError(message);
      toast.error(message);
    }
  }

  const isSubmitting = mutation.status === "pending" || isPending;
  const isCostInvalid = Boolean(cost.trim()) && !(Number(cost) > 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-[14px] border-border bg-card p-0 shadow-lg sm:max-w-150">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-5">
          <DialogTitle className="text-lg font-semibold text-foreground">
            Create variation
          </DialogTitle>
          <DialogDescription className="mt-0.5 text-sm text-muted-foreground">
            Record a change to scope or cost. Fields marked * are required.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4 px-6 pb-6 pt-5"
          noValidate
          onSubmit={(data) => {
            if (isSubmitting) {
              data.preventDefault();
              return;
            }
            startTransition(async () => await handleSubmit(data));
          }}
        >
          {submitError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[12px] border border-destructive/40 bg-destructive-light px-3.5 py-3 text-sm text-destructive-ink"
            >
              <AlertCircle
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <p>{submitError}</p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="variation-description" className={labelClassName}>
              Variation description
              <RequiredMark />
            </Label>
            <Textarea
              id="variation-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Additional power points to the rumpus room"
              rows={3}
              required
              className="min-h-20 rounded-[7px] bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="variation-cost" className={labelClassName}>
              Cost impact (AUD)
              <RequiredMark />
            </Label>
            <Input
              id="variation-cost"
              value={cost}
              onChange={(event) => setCost(event.target.value)}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0.00"
              required
              aria-invalid={isCostInvalid}
              aria-describedby={
                isCostInvalid ? "variation-cost-error" : undefined
              }
              className={`${fieldClassName} font-mono tabular-nums`}
            />
            {isCostInvalid ? (
              <p
                id="variation-cost-error"
                className="text-xs text-destructive-ink"
              >
                Cost impact must be greater than 0.
              </p>
            ) : null}
          </div>

          <div className="flex items-start gap-1.5 rounded-[8px] bg-info-light px-3.5 py-2.5 text-xs text-info-ink">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              The variation is added to this project&apos;s variation log and
              included in the revised contract total. Approving it is a separate
              step.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => handleOpenChange(false)}
              className="h-9 rounded-[7px] px-3.5 text-sm font-medium"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !description.trim() || !cost.trim()}
              aria-busy={isSubmitting}
              className="h-9 rounded-[7px] bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {isSubmitting ? (
                <Loader2
                  className="mr-1.5 size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <FilePlus2 className="mr-1.5 size-4" aria-hidden="true" />
              )}
              {isSubmitting ? "Creating variation…" : "Create variation"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
