"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppDispatch } from "@/lib/store/hooks";
import { addProjectMilestone } from "@/lib/store/slices/projectsSlice";
import {
  milestoneCreationSchema,
  type MilestoneCreationData,
} from "@/utils/validators";
import { useTransition } from "react";
import { toast } from "sonner";

interface AddMilestoneProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function AddMilestoneModal({
  projectId,
  isOpen,
  onClose,
}: AddMilestoneProps) {
  const dispatch = useAppDispatch();
  const [isPending, startTransition] = useTransition();

  const handleOpenChange = (open: boolean) => {
    if (!open) onClose();
  };

  const handleSubmit = async (data: MilestoneCreationData) => {
    try {
      const validatedData = milestoneCreationSchema.safeParse(data);
      if (!validatedData.success) {
        throw new Error(
          "Validation failed: " +
            validatedData.error.issues.map((e) => e.message).join(", "),
        );
      }
      await dispatch(
        addProjectMilestone({
          ...validatedData.data,
          projectId,
        }),
      ).unwrap();
      toast.success("Milestone created successfully");
      onClose();
    } catch (error) {
      toast.error("Failed to create milestone. Please try again.");
      console.error("Error creating milestone:", error);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Milestone</DialogTitle>
          <DialogDescription>
            Create a new milestone for this project.
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
