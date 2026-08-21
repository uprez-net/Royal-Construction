import { Button } from "@/components/ui/button";
import type { UIMilestone } from "@/types/project";
import { MilestoneStatus } from "@prisma/client";
import { BanIcon, Camera, Edit, FilePenLine, Play } from "lucide-react";

export function MilestoneActionGroup({
  isActiveStage,
  milestone,
  onOpenAddUpdateModal,
  onStatusUpdate,
  onStartMilestone,
  onMarkasNotRequired,
}: {
  isActiveStage: boolean;
  milestone: UIMilestone;
  onOpenAddUpdateModal: (id: string) => void;
  onStatusUpdate: (id: string, status?: MilestoneStatus) => void;
  onStartMilestone: (id: string) => void;
  onMarkasNotRequired: (id: string) => void;
}) {
  const hasChildren = milestone.childrenMilestones.length > 0;
  const isActive = milestone.status === "ACTIVE";
  const isPending = milestone.status === "PENDING";
  const isCompleted =
    milestone.status === "DONE" || milestone.status === "NOT_REQUIRED";

  if (isActiveStage && isPending) {
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

  if (isCompleted && !hasChildren) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onStatusUpdate(milestone.id, milestone.status)}
        >
          <Edit className="mr-1 h-4 w-4" aria-hidden="true" />
          Edit Activity
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
