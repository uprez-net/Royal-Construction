"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { setActiveProject } from "@/lib/store/slices/projectsSlice";
import { openModal } from "@/lib/store/slices/uiSlice";
import {
  readInsuranceClaimDates,
  withInsuranceClaimDates,
} from "@/lib/projects/insurance-claim-dates";
import type { ProjectDetail } from "@/types/project";
import { fetchJson } from "@/utils/fetch";
import { cn } from "@/lib/utils";
import {
  insuranceClaimDatesSchema,
  type InsuranceClaimDatesInput,
} from "@/utils/validators";
import { MilestoneStatus } from "@prisma/client";
import { format } from "date-fns";
import { AlertCircle, CalendarIcon, Loader2, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface InsuranceClaimDatesModalProps {
  projectId: string;
  /** The Slab-stage milestone whose start is waiting on these dates. */
  milestoneId: string;
  isOpen: boolean;
  onClose: () => void;
}

type Step = "notice" | "form";

type FormState = Partial<InsuranceClaimDatesInput>;

type FieldErrors = Partial<Record<keyof InsuranceClaimDatesInput, string>>;

const inputClassName =
  "h-10 rounded-[10px] border-border/80 bg-background px-3 font-mono text-sm tabular-nums";

const labelClassName = "text-xs font-medium text-foreground";

function RequiredMark() {
  return (
    <span className="ml-0.5 text-destructive-ink" aria-hidden="true">
      *
    </span>
  );
}

function startOfToday() {
  return new Date(new Date().setHours(0, 0, 0, 0));
}

/**
 * Blocks the first Slab-stage milestone start until the project's insurance
 * coverage window is recorded. Step one explains why the start is gated; step
 * two collects and saves the dates, after which the normal milestone-start
 * dialog takes over. Cancelling at either step leaves the milestone untouched.
 */
export default function InsuranceClaimDatesModal({
  projectId,
  milestoneId,
  isOpen,
  onClose,
}: InsuranceClaimDatesModalProps) {
  const dispatch = useAppDispatch();
  const project = useAppSelector((state) => state.projects.activeProject);
  const requirements = project?.requirements;

  const [step, setStep] = useState<Step>("notice");
  const [formState, setFormState] = useState<FormState>(() => {
    // Pre-fill from anything already stored so a half-saved payload (one date
    // only) is corrected rather than retyped.
    const { insuranceClaimStartDate, insuranceClaimEndDate } =
      readInsuranceClaimDates(requirements);

    return {
      insuranceClaimStartDate: insuranceClaimStartDate ?? undefined,
      insuranceClaimEndDate: insuranceClaimEndDate ?? undefined,
    };
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleFormChange = (
    target: keyof InsuranceClaimDatesInput,
    value: string | undefined,
  ) => {
    setFormState((prev) => ({ ...prev, [target]: value }));
    setFieldErrors((prev) => {
      if (!prev[target]) return prev;

      const nextErrors = { ...prev };
      delete nextErrors[target];
      return nextErrors;
    });
  };

  const handleOpenChange = (open: boolean) => {
    if (open || isPending) return;
    onClose();
  };

  const handleSubmit = async () => {
    setSubmitError(null);

    const validated = insuranceClaimDatesSchema.safeParse(formState);
    if (!validated.success) {
      setFieldErrors(
        validated.error.issues.reduce((acc, issue) => {
          const field = issue.path[0] as keyof FieldErrors | undefined;
          if (field && !acc[field]) {
            acc[field] = issue.message;
          }
          return acc;
        }, {} as FieldErrors),
      );
      setSubmitError("Review the highlighted fields and try again.");
      return;
    }

    setFieldErrors({});

    try {
      // Same persistence path as the Project Overview tab: a PATCH of the whole
      // requirements payload, here with only the two dates changed.
      const response = await fetchJson<ProjectDetail>(
        `/api/projects/${projectId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requirements: withInsuranceClaimDates(requirements, validated.data),
          }),
        },
        "Unable to save the insurance claim dates",
      );

      // Keep the store in step so the Overview tab shows the saved dates and the
      // prompt does not fire again on the next start attempt.
      dispatch(setActiveProject(response.data));
      toast.success("Insurance claim dates saved");

      // Hand back to the normal start flow now that the gate is satisfied.
      dispatch(
        openModal({
          type: "updateMilestoneStatus",
          payload: {
            milestoneId,
            projectId,
            newStatus: MilestoneStatus.ACTIVE,
          },
        }),
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to save the insurance claim dates";
      setSubmitError(message);
      toast.error(message);
      console.error("Error saving insurance claim dates:", error);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto rounded-[18px] border border-border/80 bg-card p-0 shadow-lg sm:max-w-156">
        <DialogHeader className="border-b border-border/70 px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
            Insurance claim period
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {step === "notice"
              ? "The Slab stage is the start of primary construction, so the project's insurance coverage window is recorded before this activity begins."
              : "Record when the project's insurance coverage starts and ends. Fields marked * are required."}
          </DialogDescription>
        </DialogHeader>

        {step === "notice" ? (
          <div className="space-y-5 px-6 pb-6 pt-5">
            <div className="rounded-[14px] border border-border/70 bg-muted/50 p-4 text-sm text-muted-foreground">
              <p>
                Starting this activity requires the{" "}
                <span className="font-medium text-foreground">
                  Insurance Claim Start Date
                </span>{" "}
                and{" "}
                <span className="font-medium text-foreground">
                  Insurance Claim End Date
                </span>
                . They are asked for once, and can be edited afterwards from the
                project overview tab.
              </p>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="h-10 rounded-[10px] px-4 text-sm font-medium"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => setStep("form")}
                className="h-10 rounded-[10px] px-4 text-sm font-medium"
              >
                Continue
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-5 px-6 pb-6 pt-5"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (isPending) return;
              startTransition(async () => await handleSubmit());
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

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label
                  htmlFor="insuranceClaimStartDate"
                  className={labelClassName}
                >
                  Insurance claim start date
                  <RequiredMark />
                </Label>
                <Popover modal>
                  <PopoverTrigger asChild>
                    <Button
                      id="insuranceClaimStartDate"
                      type="button"
                      variant="outline"
                      className={cn(
                        inputClassName,
                        "w-full justify-start text-left font-normal",
                        !formState.insuranceClaimStartDate &&
                          "text-muted-foreground",
                      )}
                      aria-invalid={Boolean(
                        fieldErrors.insuranceClaimStartDate,
                      )}
                      aria-describedby={
                        fieldErrors.insuranceClaimStartDate
                          ? "insuranceClaimStartDate-error"
                          : undefined
                      }
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formState.insuranceClaimStartDate ? (
                        format(
                          new Date(formState.insuranceClaimStartDate),
                          "PPP",
                        )
                      ) : (
                        <span>Pick a date</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={
                        formState.insuranceClaimStartDate
                          ? new Date(formState.insuranceClaimStartDate)
                          : undefined
                      }
                      onSelect={(date) =>
                        handleFormChange(
                          "insuranceClaimStartDate",
                          date ? format(date, "yyyy-MM-dd") : undefined,
                        )
                      }
                      disabled={(date) => date < startOfToday()}
                      captionLayout="dropdown"
                    />
                  </PopoverContent>
                </Popover>
                {fieldErrors.insuranceClaimStartDate ? (
                  <p
                    id="insuranceClaimStartDate-error"
                    className="text-xs text-destructive"
                  >
                    {fieldErrors.insuranceClaimStartDate}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="insuranceClaimEndDate"
                  className={labelClassName}
                >
                  Insurance claim end date
                  <RequiredMark />
                </Label>
                <Popover modal>
                  <PopoverTrigger asChild>
                    <Button
                      id="insuranceClaimEndDate"
                      type="button"
                      variant="outline"
                      className={cn(
                        inputClassName,
                        "w-full justify-start text-left font-normal",
                        !formState.insuranceClaimEndDate &&
                          "text-muted-foreground",
                      )}
                      aria-invalid={Boolean(fieldErrors.insuranceClaimEndDate)}
                      aria-describedby={
                        fieldErrors.insuranceClaimEndDate
                          ? "insuranceClaimEndDate-error"
                          : undefined
                      }
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formState.insuranceClaimEndDate ? (
                        format(new Date(formState.insuranceClaimEndDate), "PPP")
                      ) : (
                        <span>Pick a date</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={
                        formState.insuranceClaimEndDate
                          ? new Date(formState.insuranceClaimEndDate)
                          : undefined
                      }
                      onSelect={(date) =>
                        handleFormChange(
                          "insuranceClaimEndDate",
                          date ? format(date, "yyyy-MM-dd") : undefined,
                        )
                      }
                      disabled={(date) =>
                        formState.insuranceClaimStartDate
                          ? date <= new Date(formState.insuranceClaimStartDate)
                          : date < startOfToday()
                      }
                      captionLayout="dropdown"
                    />
                  </PopoverContent>
                </Popover>
                {fieldErrors.insuranceClaimEndDate ? (
                  <p
                    id="insuranceClaimEndDate-error"
                    className="text-xs text-destructive"
                  >
                    {fieldErrors.insuranceClaimEndDate}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={onClose}
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
                  <ShieldCheck className="mr-1.5 size-4" aria-hidden="true" />
                )}
                {isPending ? "Saving dates…" : "Save and start activity"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
