import { MilestoneStatus } from "@prisma/client";

export function shouldCompleteParent(
  outstanding: number,
  total: number,
  waived: number,
): boolean {
  return outstanding === 0 && waived < total;
}

export function allChildrenNotRequired(
  children: readonly { status: MilestoneStatus }[],
): boolean {
  return (
    children.length > 0
    && children.every((child) => child.status === MilestoneStatus.NOT_REQUIRED)
  );
}

/** The same state machine is used by the command and the update form. */
export function allowedMilestoneTransitions(
  from: MilestoneStatus,
  children: readonly { status: MilestoneStatus }[] = [],
): readonly MilestoneStatus[] {
  if (
    allChildrenNotRequired(children)
    && (from === MilestoneStatus.PENDING || from === MilestoneStatus.ACTIVE)
  ) {
    return [
      MilestoneStatus.ACTIVE,
      MilestoneStatus.DONE,
      MilestoneStatus.NOT_REQUIRED,
    ];
  }
  const transitions: Record<MilestoneStatus, MilestoneStatus[]> = {
    PENDING: [MilestoneStatus.ACTIVE, MilestoneStatus.NOT_REQUIRED],
    ACTIVE: [MilestoneStatus.DONE],
    DONE: [MilestoneStatus.DONE],
    NOT_REQUIRED: [MilestoneStatus.PENDING],
  };
  return transitions[from];
}
