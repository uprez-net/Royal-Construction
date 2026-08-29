import { MilestoneStatus } from "@prisma/client";

/**
 * Which status a milestone may move to, from the one it is in.
 *
 * This lived inside `update-milestone-modal.tsx` as `STATE_MACHES`, where it
 * disabled the options a person must not pick. That was enough while a person
 * was the only caller. It is not enough now: the WebMCP milestone tools reach
 * `updateProjectMilestoneStatus` without passing through the modal, so a rule
 * that only exists in a `SelectItem`'s `disabled` prop is a rule an agent can
 * walk straight past.
 *
 * `milestoneUpdateSchema` does not cover this. It checks that a target status
 * arrives with the fields it needs — `startDate` for ACTIVE, `startDate` +
 * `actualDate` + `spend` for DONE — but it has no idea what the milestone's
 * current status is, so a fully-populated DONE on a PENDING milestone passes
 * validation and skips the work.
 *
 * Note the two shapes of "finished": DONE is terminal, but NOT_REQUIRED can go
 * back to PENDING, because deciding a stage is not needed is a judgement call
 * and judgement calls get revisited.
 */
export const MILESTONE_TRANSITIONS: Record<MilestoneStatus, MilestoneStatus[]> = {
    PENDING: [MilestoneStatus.ACTIVE, MilestoneStatus.NOT_REQUIRED],
    ACTIVE: [MilestoneStatus.DONE],
    DONE: [],
    NOT_REQUIRED: [MilestoneStatus.PENDING],
};

export function canTransition(from: MilestoneStatus, to: MilestoneStatus): boolean {
    return MILESTONE_TRANSITIONS[from].includes(to);
}

/**
 * A refusal an agent can act on: what it tried, where the milestone actually
 * is, and what it could do instead.
 */
export function transitionRefusal(
    name: string,
    from: MilestoneStatus,
    to: MilestoneStatus,
): string {
    const legal = MILESTONE_TRANSITIONS[from];
    const options = legal.length > 0
        ? `From ${from} it can only move to ${legal.join(" or ")}.`
        : `${from} is final; it cannot move again.`;

    return `"${name}" is ${from}, so it cannot become ${to}. ${options}`;
}
