import { Button } from "@/components/ui/button";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import {
  findInsuranceTriggerMilestoneId,
  hasInsuranceClaimDates,
} from "@/lib/projects/insurance-claim-dates";
import type { UIMilestone } from "@/types/project";
import { BanIcon, Camera, FilePenLine, Play } from "lucide-react";
import { useMemo } from "react";

export function MilestoneActionGroup({
  prevMilestone,
  milestone,
  onOpenAddUpdateModal,
  onStatusUpdate,
  onStartMilestone,
  onMarkasNotRequired,
}: {
  prevMilestone?: UIMilestone;
  milestone: UIMilestone;
  onOpenAddUpdateModal: (id: string) => void;
  onStatusUpdate: (id: string) => void;
  onStartMilestone: (id: string) => void;
  onMarkasNotRequired: (id: string) => void;
}) {
  const dispatch = useAppDispatch();
  const project = useAppSelector((state) => state.projects.activeProject);
  const isFirstMilestone = milestone.order === 1;
  const isChildOfFirstMilestone =
    prevMilestone?.order === 1 && milestone.parentId === prevMilestone.id;
  const hasChildren = milestone.childrenMilestones.length > 0;
  const prevMilestoneToParent = useMemo(() => {
    const milestones = project?.milestones ?? [];
    const parentMilestone = milestones.find((m) => m.id === milestone.parentId);
    if (!parentMilestone) return undefined;
    return milestones.find((m) => m.order === parentMilestone.order - 1);
  }, [project?.milestones, milestone]);

  const isPending = milestone.status === "PENDING";
  const hasNoChildren = !hasChildren;
  const isFirstChildOfMilestone =
    prevMilestone?.id === milestone.parentId &&
    prevMilestone?.order === milestone.order - 1;

  const isUnlocked =
    isFirstMilestone ||
    isChildOfFirstMilestone ||
    prevMilestone?.status === "DONE" ||
    prevMilestone?.status === "NOT_REQUIRED" ||
    ((prevMilestoneToParent?.status === "DONE" ||
      prevMilestoneToParent?.status === "NOT_REQUIRED") &&
      isFirstChildOfMilestone);

  const canStart = isPending && hasNoChildren && isUnlocked;

  // The Slab stage is the physical start of construction, so the first activity
  // under it cannot begin until the project's insurance coverage window is on
  // record. Once both dates are saved the gate is transparent — this is also
  // what stops the prompt reappearing on later start attempts.
  const needsInsuranceClaimDates = useMemo(() => {
    if (!project || hasInsuranceClaimDates(project.requirements)) {
      return false;
    }

    return findInsuranceTriggerMilestoneId(project.milestones) === milestone.id;
  }, [project, milestone.id]);

  const handleStart = () => {
    if (needsInsuranceClaimDates && project) {
      dispatch(
        openModal({
          type: "insuranceClaimDates",
          payload: { projectId: project.id, milestoneId: milestone.id },
        }),
      );
      return;
    }

    onStartMilestone(milestone.id);
  };

  const isActive = milestone.status === "ACTIVE";

  if (canStart) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={handleStart}>
          <Play className="mr-1 h-4 w-4" aria-hidden="true" />
          Start Activity
        </Button>
        <Button
          size="sm"
          variant="secondary"
          aria-label={`Mark ${milestone.name} as not required`}
          onClick={() => onMarkasNotRequired(milestone.id)}
        >
          <BanIcon className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    );
  }

  if (isActive) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={() => onOpenAddUpdateModal(milestone.id)}>
          <Camera className="mr-1 h-4 w-4" aria-hidden="true" />
          Add photo
        </Button>

        {!hasChildren && (
          <Button size="sm" onClick={() => onStatusUpdate(milestone.id)}>
            <FilePenLine className="mr-1 h-4 w-4" aria-hidden="true" />
            Finish Activity
          </Button>
        )}
      </div>
    );
  }

  return null;
}
