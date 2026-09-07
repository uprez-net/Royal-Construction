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
       * The one-click chase, where the alert has one.
       *
       * Only the title search does today, because it is the only condition
       * whose remedy is a request we can compose ourselves — the mail says
       * which names are on the register and which we hold, which is exactly
       * what a person would otherwise retype off this screen. A DA is not a
       * thing anybody can be asked for in one line.
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
};

type ComplianceAlertsPanelProps = {
  alerts: ComplianceAlertRecord[];
  onResolve: (alert: ComplianceAlertRecord) => void;
  /**
   * Sends the alert's follow-up request. Absent when there is nobody to send it
   * to — a file whose surveyor documents the client supplied has no thread, and
   * offering a button that can only fail is worse than not offering one.
   */
  onFollowUp?: (alert: ComplianceAlertRecord) => void;
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
                {copy.followUp && onFollowUp ? (
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
