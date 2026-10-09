import { useAppDispatch } from "@/lib/store/hooks";
import { createBulkTradieScheduleForProject } from "@/lib/store/slices/projectsSlice";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Plus } from "lucide-react";
import { TradieScheduleRow } from "./schedule-tradie-row";
import { v4 as uuidv4 } from "uuid";
import {
  clearState,
  setTradies,
  setTradieLoading,
} from "@/lib/store/slices/tradieManagementSlice";
import { getTradieGroupedByCategoryCached } from "@/lib/data/tradie-management";
import type { ProjectStage } from "@prisma/client";
import {
  describeBooking,
  existingBooking,
  type TradieBooking,
} from "./tradie-bookings";

interface ScheduleTradieModalProps {
  open: boolean;
  onClose: () => void;
  milestones: { id: string; name: string; projectStage: ProjectStage }[];
  projectId: string;
  /** Preselects the stage on every row, when opened from a stage's header. */
  initialProjectStage?: ProjectStage;
}

export interface TradieScheduleInputRow {
  id: string;
  tradeCategory?: string;
  tradieId?: string;
  /** Narrows the activity picker; not sent — the milestone carries its stage. */
  projectStage?: ProjectStage;
  milestoneId?: string;
  scheduledDate?: string;
  durationDays?: number;
  requiresQuote?: boolean;
  /** The selected tradie's existing bookings, once loaded. */
  bookings?: TradieBooking[];
  emailContent?: {
    subject: string;
    body: string;
    attachments: { name: string; url: string }[];
  };
}

export interface TradieScheduleRowErrors {
  id: string;
  tradeCategory?: string;
  tradieId?: string;
  milestoneId?: string;
  scheduledDate?: string;
  durationDays?: string;
  emailContent?: string;
}

const createEmptyRow = (
  projectStage?: ProjectStage,
): TradieScheduleInputRow => ({
  id: uuidv4(),
  projectStage,
  requiresQuote: false,
  durationDays: 1,
});

const hasRowError = (errors: TradieScheduleRowErrors) =>
  // `id` is always present, so anything beyond it is a real error.
  Object.keys(errors).length > 1;

export default function ScheduleTradieModal({
  open,
  onClose,
  milestones,
  projectId,
  initialProjectStage,
}: ScheduleTradieModalProps) {
  const dispatch = useAppDispatch();

  const [scheduleRows, setScheduleRows] = useState<TradieScheduleInputRow[]>(
    () => [createEmptyRow(initialProjectStage)],
  );
  const [rowErrors, setRowErrors] = useState<TradieScheduleRowErrors[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!open) {
      dispatch(clearState());
      return;
    }

    const fetchTradies = async () => {
      try {
        dispatch(setTradieLoading(true));

        const data = await getTradieGroupedByCategoryCached();

        if (!cancelled) {
          dispatch(setTradies(data));
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Error fetching tradies:", error);
          toast.error("Failed to fetch tradies. Please try again.");
        }
      } finally {
        if (!cancelled) {
          dispatch(setTradieLoading(false));
        }
      }
    };

    fetchTradies();

    return () => {
      cancelled = true;
      dispatch(clearState());
    };
  }, [open, dispatch]);

  const validateRow = useCallback(
    (row: TradieScheduleInputRow): TradieScheduleRowErrors => {
      const errors: TradieScheduleRowErrors = {
        id: row.id,
      };

      if (!row.tradeCategory) {
        errors.tradeCategory = "Trade category is required";
      }

      if (!row.tradieId) {
        errors.tradieId = "Tradie is required";
      }

      if (!row.milestoneId) {
        errors.milestoneId = "Milestone is required";
      }

      if (!row.scheduledDate) {
        errors.scheduledDate = "Date is required";
      }

      if (row.durationDays === undefined || row.durationDays < 1) {
        errors.durationDays = "Duration must be at least 1 day";
      }

      // Caught here rather than by the server so the operator sees which row and
      // which booking, before anything is sent. Overlapping days are allowed —
      // the calendar marks them — but the same booking twice is not.
      if (!errors.milestoneId && row.bookings) {
        const duplicate = existingBooking(
          row.bookings,
          projectId,
          row.milestoneId,
        );
        if (duplicate) {
          errors.milestoneId = `Already booked for this milestone: ${describeBooking(duplicate)}. Reschedule that booking instead.`;
        }
      }

      return errors;
    },
    [projectId],
  );

  /** Every row's errors, plus a row repeating an earlier row's booking. */
  function validateRows(
    rows: TradieScheduleInputRow[],
  ): TradieScheduleRowErrors[] {
    return rows.map((row, index) => {
      const errors = validateRow(row);
      const repeated = rows
        .slice(0, index)
        .some(
          (earlier) =>
            earlier.tradieId === row.tradieId
            && earlier.milestoneId === row.milestoneId,
        );
      if (!errors.milestoneId && row.tradieId && repeated) {
        errors.milestoneId =
          "This tradie is already on this milestone in an earlier row.";
      }
      return errors;
    });
  }

  const addRow = () => {
    const newRow = createEmptyRow(initialProjectStage);
    setScheduleRows((prev) => [...prev, newRow]);
  };

  const updateRow = useCallback(
    (index: number, updatedRow: Partial<TradieScheduleInputRow>) => {
      let updatedRows: TradieScheduleInputRow[] = [];

      setScheduleRows((prev) => {
        updatedRows = prev.map((row, i) =>
          i === index ? { ...row, ...updatedRow } : row,
        );

        return updatedRows;
      });

      setRowErrors((prev) =>
        prev.map((errors) =>
          errors.id === updatedRow.id && hasRowError(errors)
            ? validateRow({
                ...updatedRows[index],
              })
            : errors,
        ),
      );
    },
    [validateRow],
  );

  const removeRow = (index: number) => {
    const id = scheduleRows[index].id;
    setScheduleRows((prev) => prev.filter((_, i) => i !== index));
    setRowErrors((prev) => prev.filter((error) => error.id !== id));
  };

  // The single close path. Every dismissal — successful submit, Cancel, Esc,
  // overlay click — funnels through here so the modal can never reopen holding
  // the previous booking's rows or its stale validation errors.
  const closeAndReset = () => {
    setScheduleRows([createEmptyRow(initialProjectStage)]);
    setRowErrors([]);
    onClose();
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;

    const errors = validateRows(scheduleRows);

    setRowErrors(errors);

    if (errors.some(hasRowError)) {
      toast.error("Please fix the highlighted fields.");
      return;
    }

    setIsSubmitting(true);

    try {
      // `.unwrap()` matters: without it a rejected thunk resolves normally and
      // the modal reported success on a failed save.
      await dispatch(
        createBulkTradieScheduleForProject(
          scheduleRows.map((row) => ({
            tradieId: row.tradieId!,
            milestoneId: row.milestoneId,
            scheduledDate: row.scheduledDate!,
            durationDays: row.durationDays ?? 1,
            requiresQuote: row.requiresQuote ?? false,
            projectId,
            emailContent: row.emailContent,
          })),
        ),
      ).unwrap();

      toast.success("Tradies scheduled.");
      closeAndReset();
    } catch (error) {
      const message =
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "Failed to schedule tradies. Please try again.";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !isSubmitting) {
      closeAndReset();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-mobile-scroll="body"
        className="grid max-h-[calc(100dvh-1.5rem)] max-w-6xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0 shadow-lg"
      >
        <DialogHeader className="border-b px-4 py-4 pr-14 sm:px-6 sm:py-5">
          <DialogTitle>Schedule tradies</DialogTitle>

          <DialogDescription>
            Schedule several tradies at once. Requests for quote and enquiries
            are sent automatically. Fields marked * are required.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 p-4 sm:p-6">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
            {scheduleRows.map((row, index) => (
              <div
                key={row.id}
                className="rounded-xl border border-dashed border-border bg-muted/20 p-4"
              >
                <TradieScheduleRow
                  row={row}
                  position={index + 1}
                  milestones={milestones}
                  onChange={updateRow}
                  onRemove={
                    scheduleRows.length > 1 ? () => removeRow(index) : undefined
                  }
                  errors={
                    rowErrors.find((e) => e.id === row.id) ?? { id: row.id }
                  }
                />
              </div>
            ))}
          </div>

          <div className="flex shrink-0 flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="outline" onClick={addRow} disabled={isSubmitting}>
              <Plus className="mr-2 size-4" aria-hidden="true" />
              Add another tradie
            </Button>

            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>

              <Button
                onClick={handleSubmit}
                disabled={isSubmitting}
                aria-busy={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2
                    className="mr-1.5 size-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : null}
                {isSubmitting ? "Scheduling…" : "Schedule"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
