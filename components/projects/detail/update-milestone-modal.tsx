"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppDispatch } from "@/lib/store/hooks";
import { updateProjectMilestoneStatus } from "@/lib/store/slices/projectsSlice";
import { MilestoneUpdateData, milestoneUpdateSchema } from "@/utils/validators";
import type { MilestoneStatus } from "@prisma/client";
import { useTransition } from "react";
import { toast } from "sonner";

interface UpdateMilestoneModalProps {
  milestoneId: string;
  projectId: string;
  status?: MilestoneStatus;
  isOpen: boolean;
  onClose: () => void;
}

export default function UpdateMilestoneModal({
  milestoneId,
  projectId,
  status,
  isOpen,
  onClose,
}: UpdateMilestoneModalProps) {
  const dispatch = useAppDispatch();
  const [isPending, startTransition] = useTransition();

  const handleOpenChange = (open: boolean) => {
    if (!open) onClose();
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
        })
      ).unwrap();
      toast.success("Milestone updated successfully");
      onClose();
    } catch (error) {
      toast.error("Failed to update milestone. Please try again.");
      console.error("Error updating milestone:", error);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update Milestone Status</DialogTitle>
          <DialogDescription>
            Update the status of this milestone.
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
