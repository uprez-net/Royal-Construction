import { BanIcon, Camera, Check, Edit, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { isSettled } from "@/lib/projects/milestone-ledger";
import type { UIMilestone } from "@/types/project";
import { MilestoneStatus } from "@prisma/client";

/**
 * The controls on one activity row.
 *
 * Two rules hold this together. Only one action per stage is filled — finishing
 * the activity in flight — so the eye lands on the next thing to do rather than
 * on whichever button happens to be nearest; everything else is an outline.
 * And a stage that is gated renders no controls at all: the stage banner above
 * already says what it is waiting on, so repeating that on every row adds noise
 * without adding an affordance.
 *
 * Sizes are `default` (h-8) rather than `sm` (h-7) deliberately — these are the
 * primary targets on a screen used one-handed on site, and 28px is under the
 * comfortable minimum.
 */
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

  if (milestone.status === MilestoneStatus.ACTIVE) {
    const outstandingChildren = milestone.childrenMilestones.filter(
      (child) => !isSettled(child),
    ).length;

    return (
      <>
        {/* A parent is finished by its children, so it carries no Finish of its
            own. Saying so beats an empty action slot the user has to interpret. */}
        {hasChildren ? (
          <span className="text-xs text-muted-foreground">
            Finishes when {outstandingChildren} item
            {outstandingChildren === 1 ? "" : "s"} below{" "}
            {outstandingChildren === 1 ? "is" : "are"} done
          </span>
        ) : null}

        <Button
          size="default"
          variant="outline"
          onClick={() => onOpenAddUpdateModal(milestone.id)}
        >
          <Camera className="size-4" aria-hidden="true" />
          Add photo
          <span className="sr-only">to {milestone.name}</span>
        </Button>

        {!hasChildren && (
          <Button size="default" onClick={() => onStatusUpdate(milestone.id)}>
            <Check className="size-4" aria-hidden="true" />
            Finish
            <span className="sr-only">{milestone.name}</span>
          </Button>
        )}
      </>
    );
  }

  if (milestone.status === MilestoneStatus.PENDING) {
    // Gated stage: the banner owns the explanation.
    if (!isActiveStage) {
      return null;
    }

    return (
      <>
        <Button
          size="default"
          variant="outline"
          onClick={() => onStartMilestone(milestone.id)}
        >
          <Play className="size-4" aria-hidden="true" />
          Start
          <span className="sr-only">{milestone.name}</span>
        </Button>

        <Button
          size="icon"
          variant="ghost"
          aria-label={`Mark ${milestone.name} as not required`}
          onClick={() => onMarkasNotRequired(milestone.id)}
        >
          <BanIcon className="size-4" aria-hidden="true" />
        </Button>
      </>
    );
  }

  if (hasChildren) {
    return null;
  }

  return (
    <Button
      size="default"
      variant="ghost"
      onClick={() => onStatusUpdate(milestone.id, milestone.status)}
    >
      <Edit className="size-4" aria-hidden="true" />
      Edit
      <span className="sr-only">{milestone.name}</span>
    </Button>
  );
}
