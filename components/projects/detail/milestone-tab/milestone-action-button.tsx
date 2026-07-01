import { Button } from "@/components/ui/button";
import { useAppSelector } from "@/lib/store/hooks";
import type {
  MilestoneWithFilesTradiesUpdates,
  UIMilestone,
} from "@/types/project";
import { Camera, Download, FilePenLine, Play } from "lucide-react";
import { useMemo } from "react";

export function MilestoneActionGroup({
  prevMilestone,
  milestone,
  onOpenAddUpdateModal,
  onStatusUpdate,
  onStartMilestone,
  onSendInvoice,
}: {
  prevMilestone?: UIMilestone;
  milestone: UIMilestone;
  onOpenAddUpdateModal: (id: string) => void;
  onStatusUpdate: (id: string) => void;
  onStartMilestone: (id: string) => void;
  onSendInvoice: () => void;
}) {
  const project = useAppSelector((state) => state.projects.activeProject);
  const milestones = project?.milestones ?? [];
  const isFirstMilestone = milestone.order === 1;
  const isChildOfFirstMilestone =
    prevMilestone?.order === 1 && milestone.parentId === prevMilestone.id;
  const hasChildren = milestone.childrenMilestones.length > 0;
  const prevMilestoneToParent = useMemo(() => {
    const parentMilestone = milestones.find((m) => m.id === milestone.parentId);
    if (!parentMilestone) return undefined;
    return milestones.find((m) => m.order === parentMilestone.order - 1);
  }, [milestones, milestone]);

  const isPending = milestone.status === "PENDING";
  const hasNoChildren = !hasChildren;
  const isFirstChildOfMilestone =
    prevMilestone?.id === milestone.parentId &&
    prevMilestone?.order === milestone.order - 1;

  const isUnlocked =
    isFirstMilestone ||
    isChildOfFirstMilestone ||
    prevMilestone?.status === "DONE" ||
    (prevMilestoneToParent?.status === "DONE" && isFirstChildOfMilestone);

  console.log("isUnlocked", isUnlocked, {
    name: milestone.name,
    order: milestone.order,
    prevMilestone: prevMilestone?.name,
    prevMilestoneOrder: prevMilestone?.order,
    isFirstMilestone,
    isChildOfFirstMilestone,
    prevMilestoneStatus: prevMilestone?.status,
    prevMilestoneChildren: prevMilestone?.childrenMilestones.length,
    prevMilestoneToParentStatus: prevMilestoneToParent?.status,
  });

  const canStart = isPending && hasNoChildren && isUnlocked;

  const isActive = milestone.status === "ACTIVE";
  const isDone = milestone.status === "DONE";

  if (canStart) {
    return (
      <Button size="sm" onClick={() => onStartMilestone(milestone.id)}>
        <Play className="mr-1 h-4 w-4" />
        Start Milestone
      </Button>
    );
  }

  if (isActive) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={() => onOpenAddUpdateModal(milestone.id)}>
          <Camera className="mr-1 h-4 w-4" />
          Add Photo
        </Button>

        {!hasChildren && (
          <Button size="sm" onClick={() => onStatusUpdate(milestone.id)}>
            <FilePenLine className="mr-1 h-4 w-4" />
            Update Status
          </Button>
        )}
      </div>
    );
  }

  if (isDone) {
    return (
      <Button variant="outline" size="sm" onClick={onSendInvoice}>
        <Download className="mr-1 h-4 w-4" />
        Invoice
      </Button>
    );
  }

  return null;
}
