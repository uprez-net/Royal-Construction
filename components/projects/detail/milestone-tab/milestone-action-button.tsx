import { Button } from "@/components/ui/button";
import { UIMilestone } from "@/types/project";
import { Camera, Download, FilePenLine, Play } from "lucide-react";

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
  const isFirstMilestone = milestone.order === 1;
  const isChildOfFirstMilestone = prevMilestone?.order === 1 && milestone.parentId === prevMilestone.id;
  const hasChildren = milestone.childrenMilestones.length > 0;

  const canStart =
    milestone.status === "PENDING" &&
    !hasChildren &&
    (isFirstMilestone || isChildOfFirstMilestone || prevMilestone?.status === "DONE");

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
