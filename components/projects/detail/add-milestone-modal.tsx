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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { addProjectMilestone } from "@/lib/store/slices/projectsSlice";
import {
  milestoneCreationSchema,
  type MilestoneCreationData,
} from "@/utils/validators";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2, Plus } from "lucide-react";

interface AddMilestoneProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
}

const initialFormState: MilestoneCreationData = {
  name: "",
  description: "",
  targetDate: "",
  budget: 0,
  parentId: undefined,
};

type MilestoneFormErrors = Partial<Record<keyof MilestoneCreationData, string>>;

const inputClassName =
  "h-10 rounded-[10px] border-border/80 bg-slate-50/40 px-3 text-[13px] transition-all focus-visible:border-teal-600 focus-visible:ring-4 focus-visible:ring-teal-600/10";

const textareaClassName =
  "min-h-24 rounded-[10px] border-border/80 bg-slate-50/40 px-3 py-2 text-[13px] transition-all focus-visible:border-teal-600 focus-visible:ring-4 focus-visible:ring-teal-600/10";

const selectTriggerClassName =
  "h-10 w-full rounded-[10px] border-border/80 bg-slate-50/40 px-3 text-[13px] transition-all focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10";

export default function AddMilestoneModal({
  projectId,
  isOpen,
  onClose,
}: AddMilestoneProps) {
  const dispatch = useAppDispatch();
  const milestones = useAppSelector(
    (state) => state.projects.activeProject?.milestones ?? [],
  );
  const [isPending, startTransition] = useTransition();
  const [formState, setFormState] =
    useState<MilestoneCreationData>(initialFormState);
  const [fieldErrors, setFieldErrors] = useState<MilestoneFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      handleFormReset();
      onClose();
    }
  };

  const handleFormReset = () => {
    setFormState(initialFormState);
    setFieldErrors({});
    setSubmitError(null);
  };

  const handleFormChange = (
    target: keyof MilestoneCreationData,
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

  const handleSubmit = async (data: MilestoneCreationData) => {
    try {
      setSubmitError(null);
      const validatedData = milestoneCreationSchema.safeParse(data);
      if (!validatedData.success) {
        const nextFieldErrors = validatedData.error.issues.reduce(
          (acc, issue) => {
            const field = issue.path[0] as keyof MilestoneFormErrors | undefined;

            if (field && !acc[field]) {
              acc[field] = issue.message;
            }

            return acc;
          },
          {} as MilestoneFormErrors,
        );

        setFieldErrors(nextFieldErrors);
        setSubmitError("Review the highlighted fields and try again.");
        return;
      }
      setFieldErrors({});
      await dispatch(
        addProjectMilestone({
          ...validatedData.data,
          // targetDate: new Date(validatedData.data.targetDate).toISOString(),
          projectId,
        }),
      ).unwrap();
      toast.success("Milestone created successfully");
      handleFormReset();
      onClose();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to create milestone. Please try again.";
      setSubmitError(message);
      toast.error(message);
      console.error("Error creating milestone:", error);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto rounded-[18px] border border-border/80 bg-white p-0 shadow-[0_20px_60px_rgba(15,23,42,0.18)] sm:max-w-160">
        <DialogHeader className="border-b border-border/70 px-6 py-5">
          <DialogTitle className="text-[18px] font-semibold tracking-[-0.02em] text-slate-900">
            Add Milestone
          </DialogTitle>
          <DialogDescription className="text-[13px] text-slate-500">
            Define the scope, budget, and parent milestone for a new project phase.
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
              <Label htmlFor="name" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                Milestone Name
              </Label>
              <Input
                id="name"
                className={inputClassName}
                placeholder="Enter milestone name"
                value={formState.name}
                onChange={(e) => handleFormChange("name", e.target.value)}
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={fieldErrors.name ? "name-error" : undefined}
              />
              {fieldErrors.name ? (
                <p id="name-error" className="text-xs text-destructive">
                  {fieldErrors.name}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                Description
              </Label>
              <Textarea
                id="description"
                className={textareaClassName}
                placeholder="Enter milestone description"
                value={formState.description}
                onChange={(e) =>
                  handleFormChange("description", e.target.value)
                }
                aria-invalid={Boolean(fieldErrors.description)}
                aria-describedby={
                  fieldErrors.description ? "description-error" : undefined
                }
              />
              {fieldErrors.description ? (
                <p id="description-error" className="text-xs text-destructive">
                  {fieldErrors.description}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="targetDate" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                Target Date
              </Label>
              <Input
                id="targetDate"
                type="date"
                className={inputClassName}
                value={formState.targetDate}
                onChange={(e) => handleFormChange("targetDate", e.target.value)}
                aria-invalid={Boolean(fieldErrors.targetDate)}
                aria-describedby={
                  fieldErrors.targetDate ? "targetDate-error" : undefined
                }
              />
              {fieldErrors.targetDate ? (
                <p id="targetDate-error" className="text-xs text-destructive">
                  {fieldErrors.targetDate}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="budget" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                Budget
              </Label>
              <Input
                id="budget"
                type="number"
                className={inputClassName}
                placeholder="Enter milestone budget"
                value={formState.budget}
                onChange={(e) =>
                  handleFormChange("budget", Number(e.target.value))
                }
                aria-invalid={Boolean(fieldErrors.budget)}
                aria-describedby={fieldErrors.budget ? "budget-error" : undefined}
              />
              {fieldErrors.budget ? (
                <p id="budget-error" className="text-xs text-destructive">
                  {fieldErrors.budget}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="parentMilestone" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                Parent Milestone
              </Label>
              <Select
                value={formState.parentId ?? "__none__"}
                onValueChange={(value) =>
                  handleFormChange(
                    "parentId",
                    value === "__none__" ? undefined : value,
                  )
                }
              >
                <SelectTrigger className={selectTriggerClassName}>
                  <SelectValue placeholder="No parent milestone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No parent milestone</SelectItem>
                  {milestones
                  .filter((milestone) => milestone.status === "PENDING")
                  .map((milestone) => (
                    <SelectItem key={milestone.id} value={milestone.id}>
                      {milestone.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                Use this to nest the milestone under a larger phase.
              </p>
            </div>
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
                <Plus className="mr-1.5 size-4" />
              )}
              Create Milestone
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
