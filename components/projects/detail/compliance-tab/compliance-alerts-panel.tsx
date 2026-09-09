"use client";

import {
  ComplianceAlertSource,
  ComplianceAlertStatus,
  ComplianceAlertType,
} from "@prisma/client";
import { AlertTriangle, CheckCircle2, Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/common/status-pill";

import { cn } from "@/lib/utils";
import type { ComplianceAlertRecord } from "@/types/compliance";
import { dataTimeFormat } from "@/utils/formatters";

/**
 * What each alert is called, and what closing it actually requires.
 *
 * The guidance is the load-bearing half. An alert nobody knows how to close is
 * an alert that sits open forever, and in the DA case it would sit there
 * suppressing the planning certificate while everyone waited for something to
 * happen on its own.
 */
export const COMPLIANCE_ALERT_COPY: Readonly<
  Record<
    ComplianceAlertType,
    {
      title: string;
      guidance: string;
      /**
       * The label on the one-click chase, where the alert has one.
       *
       * Ten of the sixteen do. What they have in common is that the remedy is a
       * request we can compose ourselves out of what is already on this screen
       * — which names are on the register against which we hold, what was asked
       * for and when, the revisions that went across a fortnight ago. The two
       * six that have none are the ones nobody can be asked: a portal does not
       * read email, and a development application is a decision about the whole
       * job rather than a document to be reminded about.
       *
       * A label here is necessary but not sufficient. Whether the button
       * actually appears also depends on that party having a live thread on
       * this file, which is `canFollowUp` below.
       */
      followUp?: string;
    }
  >
> = {
  [ComplianceAlertType.STALE_TITLE_SEARCH]: {
    title: "Title search does not name the owners",
    guidance:
      "The proprietors on this search do not match the owners recorded on the project — the land registry has most likely not updated since settlement. Ask for a fresh search; it closes itself once a replacement is uploaded and the names check out.",
    followUp: "Request updated title search",
  },
  [ComplianceAlertType.DA_APPROVAL_REQUIRED]: {
    title: "Development approval required",
    guidance:
      "This job cannot go through as a CDC. The planning certificate is no longer required while this is open. Close it once development consent has been granted — or if it turns out a CDC is viable after all.",
  },

  // -------------------------------------------------------------------
  // The overdue conditions, raised by the daily sweep.
  //
  // All six read the same way and all six close themselves: the thing being
  // waited for lands, and the sweep resolves the alert on its next pass. So
  // the guidance says what is late and what the button does, and never asks
  // anybody to come back and tick it off — a person resolving one by hand is
  // saying the wait no longer applies, not that it ended.
  // -------------------------------------------------------------------

  [ComplianceAlertType.PLANNING_CERTIFICATE_DELAYED]: {
    title: "Planning certificate taking longer than usual",
    guidance:
      "The 10.7(2) & (5) application has been with the portal past the three to five working days it normally takes. Chase it with the council using the application number on the council block, and tick it received once the certificate lands. This closes itself when the certificate is on the file.",
  },
  [ComplianceAlertType.SURVEYOR_RESPONSE_OVERDUE]: {
    title: "Surveyor response pending",
    guidance:
      "The surveyor was engaged more than eleven working days ago and has not sent their documents through. The follow-up asks for an update on the thread they are already reading; it closes itself when the documents arrive.",
    followUp: "Send a follow up",
  },
  [ComplianceAlertType.ARCHITECT_PLANS_OVERDUE]: {
    title: "Preliminary plans pending",
    guidance:
      "The client and the architect met more than eleven working days ago and no preliminary plans have come back. The follow-up asks for an update on the architect's thread; it closes itself when the plans land.",
    followUp: "Follow up with the architect",
  },
  [ComplianceAlertType.ARCHITECT_REVISION_OVERDUE]: {
    title: "Client revisions pending",
    guidance:
      "The client's revisions went to the architect more than eleven working days ago and no revised set has come back. The follow-up re-sends the feedback and asks where the redraw is up to; it closes itself when the revised plans arrive.",
    followUp: "Send a revision reminder",
  },
  [ComplianceAlertType.BASIX_RESPONSE_OVERDUE]: {
    title: "BASIX certificate pending",
    guidance:
      "The BASIX consultant was engaged more than eleven working days ago and has not sent the certificate through. The follow-up asks for an update on their thread; it closes itself when the certificate arrives.",
    followUp: "Send a follow up",
  },
  [ComplianceAlertType.BUSHFIRE_RESPONSE_OVERDUE]: {
    title: "Bushfire assessment pending",
    guidance:
      "The bushfire consultant was engaged more than eleven working days ago and has not sent their assessment through. The follow-up asks for an update on their thread; it closes itself when the report arrives.",
    followUp: "Send a follow up",
  },
  [ComplianceAlertType.STRUCTURAL_RESPONSE_OVERDUE]: {
    title: "Structural engineer response pending",
    guidance:
      "The structural engineer was engaged more than eleven working days ago and at least one of their three documents has not come back. The follow-up lists whichever are still outstanding and asks for an update on their thread; it closes itself when the last of them arrives.",
    followUp: "Send a follow up",
  },
  [ComplianceAlertType.WATER_AUTHORITY_RESPONSE_OVERDUE]: {
    title: "Water servicing approval pending",
    guidance:
      "The water servicing coordinator was engaged more than eleven working days ago and has not sent the tap-in approval or the section 73 notice through. The follow-up asks for an update on their thread; it closes itself when they arrive.",
    followUp: "Send a follow up",
  },
  [ComplianceAlertType.TRAFFIC_RESPONSE_OVERDUE]: {
    title: "Traffic control plan pending",
    guidance:
      "The traffic control consultant was engaged more than eleven working days ago and has not sent their plan through. The follow-up asks for an update on their thread; it closes itself when the plan arrives.",
    followUp: "Send a follow up",
  },
  [ComplianceAlertType.WASTE_MANAGEMENT_PLAN_OVERDUE]: {
    title: "Waste management plan pending",
    guidance:
      "The architect was asked for the waste management plan more than eleven working days ago and has not sent it. The follow-up goes on the thread they are already on; it closes itself when the plan arrives.",
    followUp: "Follow up with the architect",
  },

  // -------------------------------------------------------------------
  // The portal waits.
  //
  // None of these has a chase, and for the same reason the planning
  // certificate above has none: there is nobody at the other end reading
  // email about this job. Each one is chased by ringing the body with the
  // reference number the block itself shows, which is why the guidance names
  // where to find that number rather than offering a button.
  // -------------------------------------------------------------------

  [ComplianceAlertType.ROAD_OPENING_DELAYED]: {
    title: "Road opening approval taking longer than usual",
    guidance:
      "The road opening and vehicle crossing application has been with the council past the fortnight it normally takes. Chase it with the council using the application number on the permit block, and tick it received once the approval lands. This closes itself when the approval is on the file.",
  },
  [ComplianceAlertType.LONG_SERVICE_LEVY_DELAYED]: {
    title: "Long service levy receipt outstanding",
    guidance:
      "The levy payment was recorded more than a working week ago and no receipt has been uploaded. Download it from the Long Service Corporation portal using the payment reference on the block. This closes itself when the receipt is on the file.",
  },
  [ComplianceAlertType.MINE_SUBSIDENCE_DELAYED]: {
    title: "Mine subsidence approval taking longer than usual",
    guidance:
      "Subsidence Advisory NSW has had the application past the three weeks it normally takes. Chase it using the application number on the block, and tick it received once the approval lands. This closes itself when the approval is on the file.",
  },
  [ComplianceAlertType.DA_DETERMINATION_OVERDUE]: {
    title: "Development application still undetermined",
    guidance:
      "The DA has been with the council for more than sixty working days, which is well past what a residential application normally takes. Ring the assessing officer using the DA number on the block. This closes itself when the determination is recorded.",
  },
};


/**
 * How each source reads on the pill.
 *
 * Its own map rather than PARTY_LABEL, because the certifier is a source and
 * not an outreach party — and because the pill wording is "via the X", which
 * wants the lower-case form.
 */
const ALERT_SOURCE_LABEL: Readonly<Record<ComplianceAlertSource, string>> = {
  [ComplianceAlertSource.SURVEYOR]: "surveyor",
  [ComplianceAlertSource.ARCHITECT]: "architect",
  [ComplianceAlertSource.COUNCIL]: "NSW Planning",
  [ComplianceAlertSource.CERTIFIER]: "certifier",
  [ComplianceAlertSource.BASIX_CONSULTANT]: "BASIX consultant",
  [ComplianceAlertSource.BUSHFIRE_CONSULTANT]: "bushfire consultant",
  [ComplianceAlertSource.STRUCTURAL_ENGINEER]: "structural engineer",
  [ComplianceAlertSource.WATER_AUTHORITY]: "water servicing coordinator",
  [ComplianceAlertSource.TRAFFIC_CONSULTANT]: "traffic control consultant",
};

type ComplianceAlertsPanelProps = {
  alerts: ComplianceAlertRecord[];
  onResolve: (alert: ComplianceAlertRecord) => void;
  /** Sends the alert's follow-up request, on the thread it belongs to. */
  onFollowUp?: (alert: ComplianceAlertRecord) => void;
  /**
   * Whether this particular alert has anybody to chase.
   *
   * Per alert rather than per panel, which is the correction. One flag for the
   * whole list got it wrong in both directions: a file whose surveyor documents
   * the client supplied has nobody to write to about a title search, and may at
   * the same moment have a live architect thread with a redraw overdue on it.
   * Absent means every alert with copy for a chase gets the button.
   */
  canFollowUp?: (alert: ComplianceAlertRecord) => boolean;
  isBusy: (alertId: string) => boolean;
};

/**
 * The conditions raised on this file, open ones first.
 *
 * Above the document blocks rather than inside one, because that is the shape
 * of what they do: a stale title search is about the surveyor's section and a
 * DA requirement removes a row from the council's, so filing either under a
 * single block would hide it from the section it actually changes.
 *
 * Resolved alerts stay listed, quietly. What was raised and settled on a job is
 * exactly what somebody auditing it later is looking for, and a list that
 * empties itself as things are fixed leaves no trace that anything was.
 */
export function ComplianceAlertsPanel({
  alerts,
  onResolve,
  onFollowUp,
  canFollowUp,
  isBusy,
}: ComplianceAlertsPanelProps) {
  if (alerts.length === 0) {
    return null;
  }

  return (
    <ul className="space-y-2">
      {alerts.map((alert) => {
        const copy = COMPLIANCE_ALERT_COPY[alert.type];
        const isOpen = alert.status === ComplianceAlertStatus.OPEN;

        return (
          <li
            key={alert.id}
            className={cn(
              "flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3",
              isOpen
                ? "border-warning/40 bg-warning-light"
                : "border-border/70 bg-muted/40",
            )}
          >
            {isOpen ? (
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0 text-warning-ink"
                aria-hidden="true"
              />
            ) : (
              <CheckCircle2
                className="mt-0.5 size-4 shrink-0 text-success-ink"
                aria-hidden="true"
              />
            )}

            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-foreground">{copy.title}</p>
                {alert.raisedBySource ? (
                  // Who supplied the document, not who reported the problem.
                  // On a stale title search nobody reported it — the surveyor
                  // could not have known — so "from the surveyor" would be an
                  // accusation rather than a fact. "via" is the honest word,
                  // and it is also the answer to who to go back to.
                  <StatusPill tone="neutral">
                    via the {ALERT_SOURCE_LABEL[alert.raisedBySource]}
                  </StatusPill>
                ) : null}
                {!isOpen ? (
                  <StatusPill tone="success">Resolved</StatusPill>
                ) : null}
              </div>

              {/* The raiser's own sentence, where the message carried one. It
                  is quoted rather than summarised — "we'll re-pull the title
                  once the registry updates" is the whole instruction. */}
              {alert.detail ? (
                <p className="text-sm text-muted-foreground italic">
                  &ldquo;{alert.detail}&rdquo;
                </p>
              ) : null}

              <p className="text-xs leading-relaxed text-muted-foreground">
                {isOpen
                  ? copy.guidance
                  : `${alert.resolutionNote ?? "Resolved"}${
                      alert.resolvedAt
                        ? ` — ${dataTimeFormat.format(new Date(alert.resolvedAt))}`
                        : ""
                    }`}
              </p>
            </div>

            {isOpen ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {/* The chase comes first and carries the weight: on a freshly
                    raised alert it is what someone is here to do, and Resolve
                    is what they come back for once the replacement lands. */}
                {copy.followUp &&
                onFollowUp &&
                (canFollowUp?.(alert) ?? true) ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={isBusy(alert.id)}
                    onClick={() => onFollowUp(alert)}
                  >
                    {isBusy(alert.id) ? (
                      <Loader2
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Send className="size-4" aria-hidden="true" />
                    )}
                    {copy.followUp}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isBusy(alert.id)}
                  onClick={() => onResolve(alert)}
                >
                  Resolve
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
