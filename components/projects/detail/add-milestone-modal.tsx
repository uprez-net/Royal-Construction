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
import { FilePlus2, Loader2, Plus } from "lucide-react";

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

  const handleOpenChange = (open: boolean) => {
    if (!open) onClose();
  };

  const handleFormReset = () => {
    setFormState(initialFormState);
  };

  const handleFormChange = (target: keyof MilestoneCreationData, value: unknown) => {
    setFormState((prev) => ({ ...prev, [target]: value }));
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
      handleFormReset();
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

        <form
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => await handleSubmit(formState));
          }}
        >
          <div className="grid w-full items-center gap-4 py-4">
            <div className="grid-cols-2 w-full space-y-2">
              <Label htmlFor="name">Milestone Name</Label>
              <Input
                id="name"
                className="h-9 rounded-[7px] bg-white px-3 py-2 text-[13px] transition-all focus-visible:border-teal-600 focus-visible:ring-4 focus-visible:ring-teal-600/10"
                placeholder="Enter milestone name"
                value={formState.name}
                onChange={(e) => handleFormChange("name", e.target.value)}
              />
            </div>
            <div className="grid-cols-2 w-full space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                className="min-h-24 rounded-[7px] bg-white px-3 py-2 text-[13px] transition-all focus-visible:border-teal-600 focus-visible:ring-4 focus-visible:ring-teal-600/10"
                placeholder="Enter milestone description"
                value={formState.description}
                onChange={(e) =>
                  handleFormChange("description", e.target.value)
                }
              />
            </div>
            <div className="grid-cols-1 w-full space-y-2">
              <Label htmlFor="targetDate">Target Date</Label>
              <Input
                id="targetDate"
                type="date"
                value={formState.targetDate}
                onChange={(e) => handleFormChange("targetDate", e.target.value)}
              />
            </div>
            <div className="grid-cols-1 w-full space-y-2">
              <Label htmlFor="budget">Budget</Label>
              <Input
                id="budget"
                type="number"
                className="h-9 rounded-[7px] bg-white px-3 py-2 text-[13px] transition-all focus-visible:border-teal-600 focus-visible:ring-4 focus-visible:ring-teal-600/10"
                placeholder="Enter milestone budget"
                value={formState.budget}
                onChange={(e) => handleFormChange("budget", e.target.value)}
              />
            </div>
            <div className="grid-cols-2 w-full space-y-2">
              <Label htmlFor="parentMilestone">Parent Milestone</Label>
              <Select
                value={formState.parentId}
                onValueChange={(value) => handleFormChange("parentId", value)}
              >
                <SelectTrigger className="h-9 w-full rounded-[7px] bg-white px-3 py-2 text-[13px] transition-all focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10">
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  {milestones.map((milestone) => (
                    <SelectItem key={milestone.id} value={milestone.id}>
                      {milestone.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
