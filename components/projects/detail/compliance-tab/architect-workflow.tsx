"use client";

import { ComplianceMeetingStatus } from "@prisma/client";
import { CalendarClock, CheckCircle2, Loader2, Users } from "lucide-react";

import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { ARCHITECT_PLANS_BUSINESS_DAYS } from "@/constants/complianceDocuments";
import { businessDaysSince } from "@/lib/dates/business-days";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  complianceScope,
  selectComplianceMutations,
} from "@/lib/store/slices/projectsSlice";
import { openModal } from "@/lib/store/slices/uiSlice";
import {
  currentMeeting,
  meetingHeldAt,
  outstandingRevision,
  type ComplianceOutreachDetail,
  type VaultAttachmentOption,
} from "@/types/compliance";
import { dataTimeFormat, dateFormat } from "@/utils/formatters";

/**
 * Everything on the architect's block that is not a document row.
 *
 * Between engaging an architect and their plans arriving sits a conversation
 * the file could not see any of. The architect and the client have to sit down
 * together; that meeting routinely moves; the plans follow some days later; and
 * the client either signs off or asks for changes, sometimes twice. All of it
 * happened by phone, and the only trace was plans appearing one day with
 * nothing to say whether that was quick or a month overdue.
 *
 * So this is three controls in a strict sequence, and only ever one of them is
 * on screen:
 *
 *   1. Schedule a meeting with the client — until one is booked.
 *   2. Meeting resolution — while one is booked and unresolved.
 *   3. Client approved plans — once the meeting has been held and a set of
 *      plans is actually on the file: the preliminary set, or the full design
 *      where that is what the architect delivered instead.
 *
 * The third is what opens the send to the certifier, which is why it is not
 * offered before there is something for the client to have looked at.
 */

type ArchitectWorkflowProps = {
  projectId: string;
  outreach: ComplianceOutreachDetail | undefined;
  /**
   * Whether the architect's plans are on the file, at either stage.
   *
   * Not the preliminary row alone: a file holding only the full design never
   * offered the approval control, and the certifier send waits on it.
   */
  hasPlans: boolean;
  /**
   * What is on the file already, carried straight through to the two dialogs
   * this card opens.
   *
   * Passed down rather than derived, for the reason everything else here is:
   * this card holds one outreach and knows nothing about the rest of the
   * engagement. Built with `vaultAttachmentOptions`.
   */
  vaultOptions?: readonly VaultAttachmentOption[];
};

export function ArchitectWorkflow({
  projectId,
  outreach,
  hasPlans,
  vaultOptions,
}: ArchitectWorkflowProps) {
  const dispatch = useAppDispatch();
  const mutations = useAppSelector(selectComplianceMutations);
  const isMeetingBusy =
    mutations[complianceScope.meeting]?.status === "pending";
  const isReviewBusy =
    mutations[complianceScope.planReview]?.status === "pending";

  // No architect, or one the client stood in for. There is nobody to meet and
  // nobody to send revisions to, and a card offering both would be offering to
  // email a firm that was never engaged.
  if (!outreach?.contactEmail) {
    return null;
  }

  const meeting = currentMeeting(outreach);
  const heldAt = meetingHeldAt(outreach);
  const revision = outstandingRevision(outreach);
  const approvedAt = outreach.clientPlansApprovedAt
    ? new Date(outreach.clientPlansApprovedAt)
    : null;

  const rescheduleCount = outreach.meetings.filter(
    (entry) => entry.status === ComplianceMeetingStatus.RESCHEDULED,
  ).length;

  /**
   * Working days since the meeting, where the plans are still outstanding.
   *
   * Shown rather than left to the alert panel, because this is the card
   * somebody is looking at when they wonder — and a number here is what stops
   * the question being asked in the first place. Null once the plans land: the
   * clock stops mattering the moment the thing it was measuring arrives.
   */
  const daysSinceMeeting =
    heldAt && !hasPlans ? businessDaysSince(new Date(heldAt)) : null;

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-border/70 bg-muted/40 p-3">
      <div className="flex items-center gap-2">
        <Users className="size-4 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">
          Client and architect
        </p>
        {approvedAt ? (
          <StatusPill tone="success">Plans approved</StatusPill>
        ) : null}
      </div>

      {/* -----------------------------------------------------------------
          Where the meeting is up to.
      ----------------------------------------------------------------- */}
      {meeting ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {meeting.status === ComplianceMeetingStatus.HELD
            ? `Met on ${dataTimeFormat.format(new Date(meeting.heldAt ?? meeting.scheduledFor))}.`
            : `Booked for ${dataTimeFormat.format(new Date(meeting.scheduledFor))}. Both sides have the invitation.`}
          {rescheduleCount > 0
            ? ` Moved ${rescheduleCount === 1 ? "once" : `${rescheduleCount} times`}.`
            : ""}
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          The architect needs to sit down with the owners before they draw
          anything. Book it here and both sides get the invitation on this
          thread.
        </p>
      )}

      {/* Only while the plans are actually outstanding, and only past the
          point where saying so means anything. "1 working day" is not news. */}
      {daysSinceMeeting !== null && daysSinceMeeting > 0 ? (
        <p
          className={
            daysSinceMeeting > ARCHITECT_PLANS_BUSINESS_DAYS
              ? "text-xs text-warning-ink"
              : "text-xs text-muted-foreground"
          }
        >
          {daysSinceMeeting > ARCHITECT_PLANS_BUSINESS_DAYS
            ? `${daysSinceMeeting} working days since the meeting and no preliminary plans yet.`
            : `${daysSinceMeeting} working day${daysSinceMeeting === 1 ? "" : "s"} since the meeting. Plans usually take about ${ARCHITECT_PLANS_BUSINESS_DAYS}.`}
        </p>
      ) : null}

      {/* -----------------------------------------------------------------
          The revision round, where one is open.

          Its own line rather than folded into the meeting copy: they are two
          different waits and a file can be in the second having long finished
          with the first.
      ----------------------------------------------------------------- */}
      {revision ? (
        <div className="rounded-md border border-border/70 bg-background px-3 py-2">
          <p className="text-xs font-medium text-foreground">
            Revisions with the architect since{" "}
            {dateFormat.format(new Date(revision.requestedAt))}
          </p>
          <p className="mt-1 line-clamp-3 text-xs text-muted-foreground italic">
            &ldquo;{revision.feedback}&rdquo;
          </p>
        </div>
      ) : null}

      {/* -----------------------------------------------------------------
          The one control this card is currently offering.
      ----------------------------------------------------------------- */}
      <div className="flex flex-wrap gap-2">
        {!meeting ? (
          <Button
            type="button"
            size="sm"
            disabled={isMeetingBusy}
            onClick={() =>
              dispatch(
                openModal({
                  type: "scheduleComplianceMeeting",
                  payload: { projectId, vaultOptions },
                }),
              )
            }
          >
            {isMeetingBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <CalendarClock className="size-4" aria-hidden="true" />
            )}
            Schedule a meeting with the client
          </Button>
        ) : null}

        {meeting && meeting.status === ComplianceMeetingStatus.SCHEDULED ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isMeetingBusy}
            onClick={() =>
              dispatch(
                openModal({
                  type: "resolveComplianceMeeting",
                  payload: {
                    projectId,
                    scheduledFor: new Date(meeting.scheduledFor).toISOString(),
                    vaultOptions,
                  },
                }),
              )
            }
          >
            {isMeetingBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            Meeting resolution
          </Button>
        ) : null}

        {/* Offered once there is something to have an opinion about, and gone
            once the opinion is recorded. A revision round still open is the
            client already having answered — the answer was "no", and the next
            move is the architect's. */}
        {heldAt && hasPlans && !approvedAt && !revision ? (
          <Button
            type="button"
            size="sm"
            disabled={isReviewBusy}
            onClick={() =>
              dispatch(
                openModal({
                  type: "reviewArchitectPlans",
                  payload: { projectId, vaultOptions },
                }),
              )
            }
          >
            {isReviewBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="size-4" aria-hidden="true" />
            )}
            Client approved plans
          </Button>
        ) : null}
      </div>

      {/* The one thing worth saying about why the send is shut, said where
          the answer to it lives. The send bar says it too; somebody looking at
          the architect card should not have to scroll to find out that this is
          what is holding it. */}
      {heldAt && hasPlans && !approvedAt && !revision ? (
        <p className="text-xs text-muted-foreground">
          The pack cannot go to the certifier until the client has signed off on
          these plans.
        </p>
      ) : null}
    </div>
  );
}
