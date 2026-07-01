import { useAppDispatch } from "@/lib/store/hooks";
import { createBulkTradieScheduleForProject } from "@/lib/store/slices/projectsSlice";
import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { TradieScheduleRow } from "./schedule-tradie-row";
import { v4 as uuidv4 } from "uuid";

interface ScheduleTradieModalProps {
  open: boolean;
  onClose: () => void;
  milestones: { id: string; name: string }[];
  projectId: string;
}

export interface TradieScheduleInputRow {
  id: string;
  tradeCategory?: string;
  tradieId?: string;
  milestoneId?: string;
  scheduledDate?: string;
  durationDays?: number;
  requiresQuote?: boolean;
}

export interface TradieScheduleRowErrors {
  id: string;
  tradeCategory?: string;
  tradieId?: string;
  milestoneId?: string;
  scheduledDate?: string;
  durationDays?: string;
}

const createEmptyRow = (): TradieScheduleInputRow => ({
  id: uuidv4(),
  requiresQuote: false,
  durationDays: 1,
});

export default function ScheduleTradieModal({
  open,
  onClose,
  milestones,
  projectId,
}: ScheduleTradieModalProps) {
  const dispatch = useAppDispatch();

  const [scheduleRows, setScheduleRows] = useState<TradieScheduleInputRow[]>([
    createEmptyRow(),
  ]);
  const [rowErrors, setRowErrors] = useState<TradieScheduleRowErrors[]>([]);

  function validateRow(row: TradieScheduleInputRow): TradieScheduleRowErrors {
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

    return errors;
  }

  const addRow = () => {
    const newRow = createEmptyRow();
    setScheduleRows((prev) => [...prev, newRow]);
    setRowErrors((prev) => [...prev, { id: newRow.id }]);
  };

  const updateRow = (index: number, updatedRow: TradieScheduleInputRow) => {
    // const errors = validateRow(updatedRow);
    // setRowErrors((prev) => {
    //   const newErrors = [...prev];
    //   newErrors[index] = errors;
    //   return newErrors;
    // });
    setScheduleRows((prev) =>
      prev.map((row, i) => (i === index ? updatedRow : row)),
    );
  };

  const removeRow = (index: number) => {
    const id = scheduleRows[index].id;
    setScheduleRows((prev) => prev.filter((_, i) => i !== index));
    setRowErrors((prev) => prev.filter((error) => error.id !== id));
  };

  const handleSubmit = async () => {
    const errors = scheduleRows.map(validateRow);

    setRowErrors(errors);

    const hasErrors = errors.some(
      (rowError) => Object.keys(rowError).length > 1, // ID would always be present, so we check for other keys
    );

    if (hasErrors) {
      toast.error("Please fix the highlighted fields.");
      return;
    }

    try {
      await dispatch(
        createBulkTradieScheduleForProject(
          scheduleRows.map((row) => ({
            tradieId: row.tradieId!,
            milestoneId: row.milestoneId,
            scheduledDate: row.scheduledDate!,
            durationDays: row.durationDays ?? 1,
            requiresQuote: row.requiresQuote ?? false,
            projectId,
          })),
        ),
      );
      toast.success("Tradies scheduled successfully!");
      onClose();
    } catch (error) {
      console.error("Error scheduling tradie:", error);
      toast.error("Failed to schedule tradie. Please try again.");
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-6xl p-0">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>Schedule Tradies</DialogTitle>

          <DialogDescription>
            Schedule multiple tradies simultaneously. RFQs and inquiries will be
            dispatched automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 p-6">
          <div className="max-h-112.5 space-y-3 overflow-y-auto pr-2">
            {scheduleRows.map((row, index) => (
              <div
                key={index}
                className="rounded-xl border border-dashed bg-muted/20 p-4"
              >
                <TradieScheduleRow
                  row={row}
                  milestones={milestones}
                  onChange={(updated) => updateRow(index, updated)}
                  onRemove={() => removeRow(index)}
                  errors={
                    rowErrors.find((e) => e.id === row.id) ?? { id: row.id }
                  }
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <Button variant="outline" onClick={addRow}>
              <Plus className="mr-2 h-4 w-4" />
              Schedule More Tradie
            </Button>

            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>

              <Button onClick={handleSubmit}>Schedule</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
