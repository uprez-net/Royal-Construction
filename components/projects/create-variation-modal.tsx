"use client";

import { useState, useTransition, type FormEvent } from "react";
import { FilePlus2, Loader2, Info } from "lucide-react";
import { toast } from "sonner";

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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { createVariation } from "@/lib/store/slices/projectsSlice";

type VariationReason =
  | "CLIENT_REQUEST"
  | "SITE_CONDITION"
  | "DESIGN_CHANGE"
  | "COUNCIL_REQUIREMENT"
  | "MATERIAL_UNAVAILABILITY"
  | "OTHER";

const ReasonLabels: Record<VariationReason, string> = {
  CLIENT_REQUEST: "Client Request",
  SITE_CONDITION: "Site Condition",
  DESIGN_CHANGE: "Design Change",
  COUNCIL_REQUIREMENT: "Council Requirement",
  MATERIAL_UNAVAILABILITY: "Material Unavailability",
  OTHER: "Other",
};

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
  const [reason, setReason] = useState<VariationReason>("CLIENT_REQUEST");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();
  const mutation = useAppSelector(
    (state) => state.projects.mutations.createVariation,
  );

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setDescription("");
      setCost("");
    }

    onOpenChange(nextOpen);
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedDescription = description.trim();
    const parsedCost = Number(cost);

    if (
      !trimmedDescription ||
      !Number.isFinite(parsedCost) ||
      parsedCost <= 0
    ) {
      toast.error("Enter a variation description and a valid cost impact.");
      return;
    }

    try {
      const updatedProject = await dispatch(
        createVariation({
          projectId,
          description: trimmedDescription,
          cost: parsedCost,
          requestedDate: new Date().toISOString(),
        }),
      ).unwrap();

      toast.success(`Variation added to ${updatedProject.name}`);
      onSuccess();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to create variation";
      toast.error(message);
    } finally {
      setDescription("");
      setCost("");
      onOpenChange(false);
    }
  }

  const isSubmitting = mutation.status === "pending" || isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-[14px] border-border bg-white p-0 shadow-lg sm:max-w-150">
        <DialogHeader className="flex flex-row items-center justify-between border-b border-border px-6 pb-4 pt-5">
          <div>
            <DialogTitle className="text-base font-bold">
              Create Variation
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
              This will generate an updated quote for the customer.
            </DialogDescription>
          </div>
        </DialogHeader>

        <form
          className="space-y-4 px-6 pb-6 pt-5"
          onSubmit={(data) =>
            startTransition(async () => await handleSubmit(data))
          }
        >
          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Variation Description
            </label>
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Enter a description for the variation..."
              required
              className="resize-y rounded-[7px] bg-white px-3 py-2 text-[13px] transition-all focus-visible:border-teal-600 focus-visible:ring-4 focus-visible:ring-teal-600/10"
            />
          </div>

          <div className="flex gap-3">
            <div className="space-y-1.5">
              <label
                htmlFor="variation-cost"
                className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Cost Impact ($)
              </label>
              <Input
                id="variation-cost"
                value={cost}
                onChange={(event) => setCost(event.target.value)}
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                className="h-9 rounded-[7px] bg-white px-3 py-2 text-[13px] transition-all focus-visible:border-teal-600 focus-visible:ring-4 focus-visible:ring-teal-600/10"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Reason
              </label>
              <Select
                value={reason}
                onValueChange={(value) => setReason(value as VariationReason)}
              >
                <SelectTrigger className="h-9 w-full rounded-[7px] bg-white px-3 py-2 text-[13px] transition-all focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10">
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ReasonLabels).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="variation-notes"
              className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Notes
            </label>
            <Textarea
              id="variation-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional notes about the variation..."
              rows={4}
              className="min-h-24 rounded-[7px] bg-white px-3 py-2 text-[13px] transition-all focus-visible:border-teal-600 focus-visible:ring-4 focus-visible:ring-teal-600/10"
              required
            />
          </div>

          <div className="rounded-[8px] bg-amber-50 px-3.5 py-2.5 text-[12px] text-amber-900 flex items-start gap-1.5">
            <Info className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <p>
              A new quote will be created with this variation and the project
              timeline will be recalculated.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
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
              disabled={isSubmitting || !description.trim() || !cost.trim()}
              className="h-9 rounded-[7px] bg-[#0D9488] px-3.5 text-[12.5px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-[#0F766E] hover:shadow-[0_4px_12px_rgba(13,148,136,0.3)]"
            >
              {isSubmitting ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <FilePlus2 className="mr-1.5 size-4" />
              )}
              Create Variation & Send Quote
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
