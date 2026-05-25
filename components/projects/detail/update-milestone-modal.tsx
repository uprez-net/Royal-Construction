"use client";

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
import { useAppDispatch } from "@/lib/store/hooks";
import { updateProjectMilestoneStatus } from "@/lib/store/slices/projectsSlice";
import { MilestoneUpdateData, milestoneUpdateSchema } from "@/utils/validators";
import type { MilestoneStatus } from "@prisma/client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AlertCircle, Edit, Loader2 } from "lucide-react";

interface UpdateMilestoneModalProps {
  milestoneId: string;
  projectId: string;
  status?: MilestoneStatus;
  isOpen: boolean;
  onClose: () => void;
}

const initialFormState: MilestoneUpdateData = {
  status: "PENDING",
  startDate: undefined,
  actualDate: undefined,
  spend: undefined,
};

const statusOptions: { label: string; value: MilestoneStatus }[] = [
  { label: "Pending", value: "PENDING" },
  { label: "In Progress", value: "ACTIVE" },
  { label: "Completed", value: "DONE" },
];

type MilestoneUpdateErrors = Partial<Record<keyof MilestoneUpdateData, string>>;

const inputClassName =
  "h-10 rounded-[10px] border-border/80 bg-slate-50/40 px-3 text-[13px] transition-all focus-visible:border-teal-600 focus-visible:ring-4 focus-visible:ring-teal-600/10";

const selectTriggerClassName =
  "h-10 w-full rounded-[10px] border-border/80 bg-slate-50/40 px-3 text-[13px] transition-all focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10";

export default function UpdateMilestoneModal({
  milestoneId,
  projectId,
  status,
  isOpen,
  onClose,
}: UpdateMilestoneModalProps) {
  const dispatch = useAppDispatch();
  const [isPending, startTransition] = useTransition();
  const [formState, setFormState] = useState<MilestoneUpdateData>({
    ...initialFormState,
    status: status ?? "PENDING",
  });
  const [fieldErrors, setFieldErrors] = useState<MilestoneUpdateErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setFormState({
        ...initialFormState,
        status: status ?? "PENDING",
      });
      setFieldErrors({});
      setSubmitError(null);
      onClose();
    }
  };

  const handleFormChange = (
    target: keyof MilestoneUpdateData,
    value: unknown,
  ) => {
    setFormState((prev) => ({ ...prev, [target]: value }));
    setFieldErrors((prev) => {
      if (!prev[target]) {
        return prev;
      }

      const nextErrors = { ...prev };
      delete nextErrors[target];
      return nextErrors;
    });
  };

  const handleSubmit = async (data: MilestoneUpdateData) => {
    try {
      setSubmitError(null);
      const validatedData = milestoneUpdateSchema.safeParse(data);
      if (!validatedData.success) {
        const nextFieldErrors = validatedData.error.issues.reduce(
          (acc, issue) => {
            const field = issue.path[0] as keyof MilestoneUpdateErrors | undefined;

            if (field && !acc[field]) {
              acc[field] = issue.message;
            }

            return acc;
          },
          {} as MilestoneUpdateErrors,
        );

        setFieldErrors(nextFieldErrors);
        setSubmitError("Review the highlighted fields and try again.");
        return;
      }
      setFieldErrors({});
      await dispatch(
        updateProjectMilestoneStatus({
          projectId,
          milestoneId,
          ...validatedData.data,
        }),
      ).unwrap();
      toast.success("Milestone updated successfully");
      onClose();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to update milestone. Please try again.";
      setSubmitError(message);
      toast.error(message);
      console.error("Error updating milestone:", error);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto rounded-[18px] border border-border/80 bg-white p-0 shadow-[0_20px_60px_rgba(15,23,42,0.18)] sm:max-w-156">
        <DialogHeader className="border-b border-border/70 px-6 py-5">
          <DialogTitle className="text-[18px] font-semibold tracking-[-0.02em] text-slate-900">
            Update Milestone Status
          </DialogTitle>
          <DialogDescription className="text-[13px] text-slate-500">
            Move the milestone forward with the dates and spend required for its status.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-5 px-6 pb-6 pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => await handleSubmit(formState));
          }}
        >
          {submitError ? (
            <div className="flex items-start gap-2 rounded-[12px] border border-amber-200/80 bg-amber-50 px-3.5 py-3 text-[12.5px] text-amber-900">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <p>{submitError}</p>
            </div>
          ) : null}

          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="status" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                Status
              </Label>
              <Select
                disabled={status === "ACTIVE"}
                value={formState.status}
                onValueChange={(value) => handleFormChange("status", value)}
              >
                <SelectTrigger className={selectTriggerClassName}>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                Active milestones need a start date. Completed milestones also require an actual date and spend.
              </p>
            </div>

            {(formState.status === "ACTIVE" || formState.status === "DONE") && (
              <div className="space-y-1.5">
                <Label htmlFor="startDate" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                  Start Date
                </Label>
                <Input
                  id="startDate"
                  type="date"
                  className={inputClassName}
                  value={formState.startDate || ""}
                  onChange={(e) =>
                    handleFormChange("startDate", e.target.value)
                  }
                  aria-invalid={Boolean(fieldErrors.startDate)}
                  aria-describedby={
                    fieldErrors.startDate ? "startDate-error" : undefined
                  }
                />
                {fieldErrors.startDate ? (
                  <p id="startDate-error" className="text-xs text-destructive">
                    {fieldErrors.startDate}
                  </p>
                ) : null}
              </div>
            )}
            {formState.status === "DONE" && (
              <div className="space-y-4 rounded-[14px] border border-border/70 bg-slate-50/50 p-4">
                <div className="space-y-1.5">
                  <Label htmlFor="actualDate" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Actual Date
                  </Label>
                  <Input
                    id="actualDate"
                    type="date"
                    className={inputClassName}
                    value={formState.actualDate || ""}
                    onChange={(e) =>
                      handleFormChange("actualDate", e.target.value)
                    }
                    aria-invalid={Boolean(fieldErrors.actualDate)}
                    aria-describedby={
                      fieldErrors.actualDate ? "actualDate-error" : undefined
                    }
                  />
                  {fieldErrors.actualDate ? (
                    <p id="actualDate-error" className="text-xs text-destructive">
                      {fieldErrors.actualDate}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="spend" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Spend
                  </Label>
                  <Input
                    id="spend"
                    type="number"
                    className={inputClassName}
                    placeholder="Enter actual spend"
                    value={formState.spend || ""}
                    onChange={(e) =>
                      handleFormChange("spend", Number(e.target.value))
                    }
                    aria-invalid={Boolean(fieldErrors.spend)}
                    aria-describedby={fieldErrors.spend ? "spend-error" : undefined}
                  />
                  {fieldErrors.spend ? (
                    <p id="spend-error" className="text-xs text-destructive">
                      {fieldErrors.spend}
                    </p>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="h-10 rounded-[10px] px-4 text-[12.5px] font-medium transition-all hover:border-teal-600 hover:bg-slate-50 hover:text-teal-600"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="h-10 rounded-[10px] bg-[#0D9488] px-4 text-[12.5px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-[#0F766E] hover:shadow-[0_6px_14px_rgba(13,148,136,0.26)]"
            >
              {isPending ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Edit className="mr-1.5 size-4" />
              )}
              Update Milestone
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
