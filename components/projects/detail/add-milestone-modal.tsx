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
import { ProjectStage } from "@prisma/client";
import { PROJECT_STAGE_LABELS } from "@/types/project";
import { currency } from "@/utils/formatters";
import { parseCurrency } from "@/utils/parser";

interface AddMilestoneProps {
  projectId: string;
  /**
   * The stage the user was looking at when they asked to add an activity.
   * Without it the form always opened on Deposit, so an activity added from
   * any other stage landed in the wrong one unless the user noticed.
   */
  projectStage?: ProjectStage;
  isOpen: boolean;
  onClose: () => void;
}

const buildInitialFormState = (
  projectStage: ProjectStage = "Deposit",
): MilestoneCreationData => ({
  name: "",
  description: "",
  targetDate: "",
  budget: 0,
  parentId: undefined,
  projectStage,
});

type MilestoneFormErrors = Partial<Record<keyof MilestoneCreationData, string>>;

const inputClassName =
  "h-10 rounded-[10px] border-border/80 bg-background px-3 text-sm";

const textareaClassName =
  "min-h-24 rounded-[10px] border-border/80 bg-background px-3 py-2 text-sm";

const selectTriggerClassName =
  "h-10 w-full rounded-[10px] border-border/80 bg-background px-3 text-sm";

const labelClassName = "text-xs font-medium text-foreground";

function RequiredMark() {
  return (
    <span className="ml-0.5 text-destructive-ink" aria-hidden="true">
      *
    </span>
  );
}

export default function AddMilestoneModal({
  projectId,
  projectStage,
  isOpen,
  onClose,
}: AddMilestoneProps) {
  const dispatch = useAppDispatch();
  const milestones = useAppSelector(
    (state) => state.projects.activeProject?.milestones ?? [],
  );
  const [isPending, startTransition] = useTransition();
  const [formState, setFormState] = useState<MilestoneCreationData>(() =>
    buildInitialFormState(projectStage),
  );
  const [fieldErrors, setFieldErrors] = useState<MilestoneFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      handleFormReset();
      onClose();
    }
  };

  const handleFormReset = () => {
    setFormState(buildInitialFormState(projectStage));
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
            const field = issue.path[0] as
              | keyof MilestoneFormErrors
              | undefined;

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
          : "Failed to create activity. Please try again.";
      setSubmitError(message);
      toast.error(message);
      console.error("Error creating milestone:", error);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto rounded-[18px] border border-border/80 bg-card p-0 shadow-lg sm:max-w-160">
        <DialogHeader className="border-b border-border/70 px-6 py-5">
          <DialogTitle className="text-lg font-semibold text-foreground">
            Add activity
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Define the scope, budget, and parent for a new activity in this
            stage. Fields marked * are required.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-5 px-6 pb-6 pt-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (isPending) return;
            startTransition(async () => await handleSubmit(formState));
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

          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="name" className={labelClassName}>
                Milestone name
                <RequiredMark />
              </Label>
              <Input
                id="name"
                required
                className={inputClassName}
                placeholder="Slab pour"
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
              <Label htmlFor="description" className={labelClassName}>
                Description
              </Label>
              <Textarea
                id="description"
                className={textareaClassName}
                placeholder="What this activity covers"
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
              <Label htmlFor="targetDate" className={labelClassName}>
                Target date
                <RequiredMark />
              </Label>
              <Input
                id="targetDate"
                type="date"
                required
                className={`${inputClassName} font-mono tabular-nums`}
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
              <Label htmlFor="budget" className={labelClassName}>
                Budget
                <RequiredMark />
              </Label>
              <Input
                id="budget"
                type="text"
                inputMode="decimal"
                required
                className={`${inputClassName} font-mono tabular-nums`}
                placeholder="$0"
                value={
                  formState.budget && formState.budget > 0
                    ? currency.format(formState.budget)
                    : ""
                }
                onChange={(e) =>
                  handleFormChange("budget", parseCurrency(e.target.value))
                }
                aria-invalid={Boolean(fieldErrors.budget)}
                aria-describedby={
                  fieldErrors.budget ? "budget-error" : undefined
                }
              />
              {fieldErrors.budget ? (
                <p id="budget-error" className="text-xs text-destructive">
                  {fieldErrors.budget}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="projectStage" className={labelClassName}>
                Stage
                <RequiredMark />
              </Label>
              <Select
                value={formState.projectStage}
                onValueChange={(value) =>
                  handleFormChange("projectStage", value)
                }
              >
                <SelectTrigger
                  id="projectStage"
                  className={selectTriggerClassName}
                >
                  <SelectValue placeholder="Select a project stage" />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(ProjectStage).map((stage) => (
                    <SelectItem key={stage} value={stage}>
                      {PROJECT_STAGE_LABELS[stage as ProjectStage]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="parentId" className={labelClassName}>
                Parent activity
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
                <SelectTrigger
                  id="parentId"
                  aria-describedby="parentId-hint"
                  className={selectTriggerClassName}
                >
                  <SelectValue placeholder="No parent activity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No parent activity</SelectItem>
                  {milestones
                    .filter(
                      (milestone) =>
                        milestone.status === "PENDING" &&
                        milestone.projectStage === formState.projectStage,
                    )
                    .map((milestone) => (
                      <SelectItem key={milestone.id} value={milestone.id}>
                        {milestone.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p id="parentId-hint" className="text-xs text-muted-foreground">
                Use this to nest the milestone under a larger phase.
              </p>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => handleOpenChange(false)}
              className="h-10 rounded-[10px] px-4 text-sm font-medium"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              aria-busy={isPending}
              className="h-10 rounded-[10px] bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {isPending ? (
                <Loader2
                  className="mr-1.5 size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <Plus className="mr-1.5 size-4" aria-hidden="true" />
              )}
              {isPending ? "Creating activity…" : "Create activity"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
