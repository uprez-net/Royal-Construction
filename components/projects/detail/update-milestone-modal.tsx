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
import { Edit, Loader2 } from "lucide-react";

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

  const handleOpenChange = (open: boolean) => {
    if (!open) onClose();
  };

  const handleFormChange = (
    target: keyof MilestoneUpdateData,
    value: unknown,
  ) => {
    setFormState((prev) => ({ ...prev, [target]: value }));
  };

  const handleSubmit = async (data: MilestoneUpdateData) => {
    try {
      const validatedData = milestoneUpdateSchema.safeParse(data);
      if (!validatedData.success) {
        throw new Error(
          "Validation failed: " +
            validatedData.error.issues.map((e) => e.message).join(", "),
        );
      }
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
      toast.error("Failed to update milestone. Please try again.");
      console.error("Error updating milestone:", error);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update Milestone Status</DialogTitle>
          <DialogDescription>
            Update the status of this milestone.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => await handleSubmit(formState));
          }}
        >
          <div className="grid w-full items-center gap-4 py-4">
            <div className="grid-cols-2 w-full space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                disabled={status === "ACTIVE"}
                value={formState.status}
                onValueChange={(value) => handleFormChange("status", value)}
              >
                <SelectTrigger className="h-9 w-full rounded-[7px] bg-white px-3 py-2 text-[13px] transition-all focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10">
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
            </div>

            {formState.status === "ACTIVE" && (
              <div className="grid-cols-2 w-full space-y-2">
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="date"
                  className="h-9 rounded-[7px] bg-white px-3 py-2 text-[13px] transition-all focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                  value={formState.startDate || ""}
                  onChange={(e) =>
                    handleFormChange("startDate", e.target.value)
                  }
                />
              </div>
            )}
            {formState.status === "DONE" && (
              <>
                <div className="grid-cols-1 w-full space-y-2">
                  <Label htmlFor="actualDate">Actual Date</Label>
                  <Input
                    id="actualDate"
                    type="date"
                    className="h-9 rounded-[7px] bg-white px-3 py-2 text-[13px] transition-all focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                    value={formState.actualDate || ""}
                    onChange={(e) =>
                      handleFormChange("actualDate", e.target.value)
                    }
                  />
                </div>
                <div className="grid-cols-1 w-full space-y-2">
                  <Label htmlFor="spend">Spend</Label>
                  <Input
                    id="spend"
                    type="number"
                    className="h-9 rounded-[7px] bg-white px-3 py-2 text-[13px] transition-all focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                    value={formState.spend || ""}
                    onChange={(e) => handleFormChange("spend", e.target.value)}
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="h-9 rounded-[7px] px-3.5 text-[12.5px] font-medium transition-all hover:border-teal-600 hover:bg-slate-50 hover:text-teal-600"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="h-9 rounded-[7px] bg-[#0D9488] px-3.5 text-[12.5px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-[#0F766E] hover:shadow-[0_4px_12px_rgba(13,148,136,0.3)]"
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
