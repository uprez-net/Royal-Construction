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
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { updateProjectMilestoneStatus } from "@/lib/store/slices/projectsSlice";
import { MilestoneUpdateData, milestoneUpdateSchema } from "@/utils/validators";
import type { MilestoneStatus } from "@prisma/client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AlertCircle, Edit, Loader2 } from "lucide-react";
import { currency } from "@/utils/formatters";
import { format } from "date-fns";
import { parseCurrency } from "@/utils/parser";

interface UpdateMilestoneModalProps {
  milestoneId: string;
  projectId: string;
  status?: MilestoneStatus;
  isOpen: boolean;
  onClose: () => void;
}

/** `yyyy-MM-dd` for a nullable date field, or `undefined` when unset. */
function toDateInputValue(value: Date | string | null | undefined) {
  if (!value) return undefined;

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime())
    ? undefined
    : format(parsed, "yyyy-MM-dd");
}

const statusOptions: { label: string; value: MilestoneStatus }[] = [
  { label: "Pending", value: "PENDING" },
  { label: "In Progress", value: "ACTIVE" },
  { label: "Completed", value: "DONE" },
  { label: "Not Required", value: "NOT_REQUIRED" },
];

const STATE_MACHES: Record<MilestoneStatus, MilestoneStatus[]> = {
  PENDING: ["ACTIVE", "NOT_REQUIRED"],
  ACTIVE: ["DONE"],
  DONE: [],
  NOT_REQUIRED: [],
};

type MilestoneUpdateErrors = Partial<Record<keyof MilestoneUpdateData, string>>;

const inputClassName =
  "h-10 rounded-[10px] border-border/80 bg-background px-3 font-mono text-sm tabular-nums";

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

export default function UpdateMilestoneModal({
  milestoneId,
  projectId,
  status,
  isOpen,
  onClose,
}: UpdateMilestoneModalProps) {
  const dispatch = useAppDispatch();
  const project = useAppSelector((state) => state.projects.activeProject);
  const milestone = useMemo(
    () => project?.milestones.find((m) => m.id === milestoneId),
    [project, milestoneId],
  );
  const spend = useMemo(() => {
    const milestoneSchedules = project?.tradieSchedules.filter(
      (schedule) => schedule.milestoneId === milestoneId,
    );
    if (!milestoneSchedules || milestoneSchedules.length === 0) {
      return 0;
    }
    const totalSpend = milestoneSchedules.reduce((acc, schedule) => {
      if (schedule.requiresQuote) {
        return acc + parseFloat(schedule.quotedPrice ?? "0");
      } else {
        const hourlyRate = parseFloat(schedule.tradie.hourlyRate ?? "0");
        const totalHours = schedule.durationDays * 8;
        return acc + hourlyRate * totalHours;
      }
    }, 0);

    return totalSpend;
  }, [project, milestoneId]);
  const [isPending, startTransition] = useTransition();

  // Derived from the milestone as it stands right now, so reopening the dialog
  // never shows the previous session's dates or spend.
  const buildFormState = useCallback((): MilestoneUpdateData => {
    const currentStatus = status ?? milestone?.status ?? "PENDING";

    return {
      status: currentStatus,
      startDate: toDateInputValue(milestone?.startDate),
      actualDate:
        toDateInputValue(milestone?.actualDate) ??
        (currentStatus === "DONE"
          ? format(new Date(), "yyyy-MM-dd")
          : undefined),
      spend: spend > 0 ? spend : undefined,
    };
  }, [milestone, spend, status]);

  const [formState, setFormState] =
    useState<MilestoneUpdateData>(buildFormState);
  const [fieldErrors, setFieldErrors] = useState<MilestoneUpdateErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Re-seed on open, on a milestone switch, and once the milestone arrives in
  // the store (the first render can happen before `activeProject` is loaded,
  // which is how an empty start date and a zero spend used to stick). Keyed so
  // later store updates cannot wipe out edits made while the dialog is open.
  const hydrationKey = isOpen
    ? `${milestoneId}|${milestone ? "loaded" : "pending"}`
    : null;
  const hydratedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (hydrationKey === null) {
      hydratedKeyRef.current = null;
      return;
    }

    if (hydratedKeyRef.current === hydrationKey) return;

    hydratedKeyRef.current = hydrationKey;
    setFormState(buildFormState());
    setFieldErrors({});
    setSubmitError(null);
  }, [buildFormState, hydrationKey]);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setFormState(buildFormState());
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
      const validatedData = milestoneUpdateSchema.safeParse({
        ...data,
        spend: data.spend && data.spend > 0 ? data.spend : undefined,
      });
      if (!validatedData.success) {
        const nextFieldErrors = validatedData.error.issues.reduce(
          (acc, issue) => {
            const field = issue.path[0] as
              | keyof MilestoneUpdateErrors
              | undefined;

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
          startDate: validatedData.data.startDate
            ? new Date(validatedData.data.startDate).toISOString()
            : undefined,
          actualDate: validatedData.data.actualDate
            ? new Date(validatedData.data.actualDate).toISOString()
            : undefined,
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
      <DialogContent className="max-h-[88vh] overflow-y-auto rounded-[18px] border border-border/80 bg-card p-0 shadow-lg sm:max-w-156">
        <DialogHeader className="border-b border-border/70 px-6 py-5">
          <DialogTitle className="text-lg font-semibold text-foreground">
            Update milestone status
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Move the milestone forward with the dates and spend required for its
            status. Fields marked * are required.
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
              <Label htmlFor="status" className={labelClassName}>
                Status
                <RequiredMark />
              </Label>
              <Select
                disabled={status === "ACTIVE" || status === "NOT_REQUIRED"}
                value={formState.status}
                onValueChange={(value) => {
                  handleFormChange("status", value);
                  if (value === "DONE") {
                    handleFormChange(
                      "actualDate",
                      format(new Date(), "yyyy-MM-dd"),
                    );
                  }
                }}
              >
                <SelectTrigger
                  id="status"
                  aria-describedby="status-hint"
                  className={selectTriggerClassName}
                >
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      disabled={
                        !STATE_MACHES[
                          status ?? milestone?.status ?? "PENDING"
                        ].includes(option.value)
                      }
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p id="status-hint" className="text-xs text-muted-foreground">
                Only the statuses this milestone can move to are selectable.
              </p>
            </div>

            {(formState.status === "ACTIVE" || formState.status === "DONE") && (
              <div className="space-y-1.5">
                <Label htmlFor="startDate" className={labelClassName}>
                  Start date
                  <RequiredMark />
                </Label>
                <Input
                  id="startDate"
                  type="date"
                  required
                  className={inputClassName}
                  value={formState.startDate || ""}
                  disabled={formState.status === "DONE"}
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
              <div className="space-y-4 rounded-[14px] border border-border/70 bg-muted/50 p-4">
                <div className="space-y-1.5">
                  <Label htmlFor="actualDate" className={labelClassName}>
                    Completed on
                  </Label>
                  <Input
                    id="actualDate"
                    type="date"
                    disabled
                    readOnly
                    className={inputClassName}
                    value={formState.actualDate || ""}
                    aria-describedby={
                      fieldErrors.actualDate
                        ? "actualDate-error actualDate-hint"
                        : "actualDate-hint"
                    }
                    aria-invalid={Boolean(fieldErrors.actualDate)}
                  />
                  <p
                    id="actualDate-hint"
                    className="text-xs text-muted-foreground"
                  >
                    Set to today automatically when a milestone is completed.
                  </p>
                  {fieldErrors.actualDate ? (
                    <p
                      id="actualDate-error"
                      className="text-xs text-destructive"
                    >
                      {fieldErrors.actualDate}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="spend" className={labelClassName}>
                    Money spent
                    <RequiredMark />
                  </Label>
                  <Input
                    id="spend"
                    type="text"
                    inputMode="decimal"
                    required
                    className={inputClassName}
                    placeholder="$0"
                    value={
                      formState.spend && formState.spend > 0
                        ? currency.format(formState.spend)
                        : ""
                    }
                    onChange={(e) =>
                      handleFormChange("spend", parseCurrency(e.target.value))
                    }
                    disabled={spend > 0}
                    aria-invalid={Boolean(fieldErrors.spend)}
                    aria-describedby={
                      [
                        fieldErrors.spend ? "spend-error" : null,
                        spend > 0 ? "spend-hint" : null,
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                  />
                  {spend > 0 ? (
                    <p id="spend-hint" className="text-xs text-muted-foreground">
                      Calculated from the tradie schedules booked against this
                      milestone.
                    </p>
                  ) : null}
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
                <Edit className="mr-1.5 size-4" aria-hidden="true" />
              )}
              {isPending ? "Updating milestone…" : "Update milestone"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
