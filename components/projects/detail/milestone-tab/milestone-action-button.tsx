import { Button } from "@/components/ui/button";
import { useAppSelector } from "@/lib/store/hooks";
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
    prevMilestone.childrenMilestones.at(0)?.id === milestone.id;

  const isUnlocked =
    isFirstMilestone ||
    isChildOfFirstMilestone ||
    prevMilestone?.status === "DONE" ||
    prevMilestone?.status === "NOT_REQUIRED" ||
    ((prevMilestoneToParent?.status === "DONE" ||
      prevMilestoneToParent?.status === "NOT_REQUIRED") &&
      isFirstChildOfMilestone);

  const canStart = isPending && hasNoChildren && isUnlocked;

  const isActive = milestone.status === "ACTIVE";

  if (canStart) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={() => onStartMilestone(milestone.id)}>
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
