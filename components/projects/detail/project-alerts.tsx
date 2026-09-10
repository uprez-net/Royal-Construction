"use client";

import { useMemo } from "react";
import { addWeeks, isWithinInterval, startOfDay } from "date-fns";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Loader2,
  Send,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import {
  ComplianceAlertStatus,
  ComplianceOutreachMode,
} from "@prisma/client";

import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ALERT_SOURCE_LABEL,
  COMPLIANCE_ALERT_COPY,
} from "@/constants/complianceAlerts";
import { COMPLIANCE_ALERT_PARTY } from "@/lib/compliance/alert-parties";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import {
  complianceScope,
  selectComplianceMutations,
  sendComplianceFollowUp,
} from "@/lib/store/slices/projectsSlice";
import { cn } from "@/lib/utils";
import type { ComplianceAlertRecord } from "@/types/compliance";
import { outreachForParty } from "@/types/compliance";
import type { ProjectDetail, TradieScheduleListItem } from "@/types/project";
import { dataTimeFormat, dateFormat } from "@/utils/formatters";

/**
 * Everything raised on this project, in one place above the tabs.
 *
 * This was two components that never appeared together: upcoming tradie
 * reminders sat here above the tabs, and the compliance conditions sat inside
 * the Compliance tab, several screens down and invisible unless you were already
 * on it. Both are the same kind of thing to the person reading -- something on
 * this job needs attention, and here is the one control that deals with it --
 * and splitting them by which subsystem raised them meant a job with a surveyor
 * eleven working days late looked, from the project page, exactly like a job
 * with nothing wrong.
 *
 * The compliance half leads. A trade reminder is a courtesy about next week; an
 * open compliance condition is a document nobody has and a clock that is
 * already past. Within it, open before resolved, which is the order the read
 * returns them in.
 *
 * Resolved alerts stay listed. What was raised and settled on a job is exactly
 * what somebody auditing it later is looking for, and a list that empties itself
 * as things are fixed leaves no trace that anything was.
 */

/** The compliance half, with the two controls an open condition carries. */
function ComplianceAlertRow({
  alert,
  projectId,
  canFollowUp,
  isBusy,
}: {
  alert: ComplianceAlertRecord;
  projectId: string;
  canFollowUp: boolean;
  isBusy: boolean;
}) {
  const dispatch = useAppDispatch();
  const copy = COMPLIANCE_ALERT_COPY[alert.type];
  const isOpen = alert.status === ComplianceAlertStatus.OPEN;

  const handleFollowUp = async () => {
    try {
      await dispatch(
        sendComplianceFollowUp({ projectId, alertId: alert.id }),
      ).unwrap();
      toast.success("Follow-up sent.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not send the follow-up.",
      );
    }
  };

  return (
    <li
      className={cn(
        "flex flex-wrap items-start gap-3 rounded-[10px] border px-4 py-3",
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
          <p className="text-sm font-medium text-foreground">{copy.title}</p>
          {alert.raisedBySource ? (
            // Who supplied the document, not who reported the problem. On a
            // stale title search nobody reported it — the surveyor could not
            // have known — so "from the surveyor" would be an accusation rather
            // than a fact. "via" is the honest word, and it is also the answer
            // to who to go back to.
            <StatusPill tone="neutral">
              via the {ALERT_SOURCE_LABEL[alert.raisedBySource]}
            </StatusPill>
          ) : null}
          {!isOpen ? <StatusPill tone="success">Resolved</StatusPill> : null}
        </div>

        {/* The raiser's own sentence, where the message carried one. It is
            quoted rather than summarised — "we'll re-pull the title once the
            registry updates" is the whole instruction. */}
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
          {/* The chase comes first and carries the weight: on a freshly raised
              alert it is what someone is here to do, and Resolve is what they
              come back for once the replacement lands. */}
          {copy.followUp && canFollowUp ? (
            <Button
              type="button"
              size="sm"
              disabled={isBusy}
              onClick={() => void handleFollowUp()}
            >
              {isBusy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
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
            disabled={isBusy}
            onClick={() =>
              dispatch(
                openModal({
                  type: "resolveComplianceAlert",
                  payload: {
                    projectId,
                    alertId: alert.id,
                    alertTitle: copy.title,
                    guidance: copy.guidance,
                  },
                }),
              )
            }
          >
            Resolve
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** One upcoming trade booking, with the reminder that goes to them. */
function TradieAlertRow({
  schedule,
  project,
}: {
  schedule: ProjectDetail["tradieSchedules"][number];
  project: ProjectDetail;
}) {
  const dispatch = useAppDispatch();

  return (
    <li className="flex items-center gap-3 rounded-[10px] border border-border/70 bg-card p-3.5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-warning-light text-warning-ink">
        <Wrench className="size-5" aria-hidden="true" />
      </div>

      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">
          {schedule.tradie.trade} • {schedule.tradie.name}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          ABN{" "}
          <span className="font-mono tabular-nums">{schedule.tradie.abn}</span>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Needed for {schedule.milestone?.name ?? "general works"} on{" "}
          <span className="font-mono tabular-nums">
            {dateFormat.format(new Date(schedule.scheduledDate))}
          </span>
        </p>
      </div>

      <div className="ml-auto">
        <Button
          variant="outline"
          size="icon"
          className="size-9"
          aria-label={`Send reminder to ${schedule.tradie.name}`}
          onClick={() =>
            dispatch(
              openModal({
                type: "tradieReminder",
                payload: {
                  schedule: {
                    id: schedule.id,
                    tradieId: schedule.tradieId,
                    milestoneId: schedule.milestoneId ?? undefined,
                    scheduledDate: new Date(
                      schedule.scheduledDate,
                    ).toISOString(),
                    status: schedule.status,
                    abn: schedule.tradie.abn,
                    tradieName: schedule.tradie.name,
                    lastQuotedPriceUnit: schedule.tradie.lastQuotedPriceUnit,
                    tradeType: schedule.tradie.trade,
                    projectId: schedule.projectId,
                    projectName: project.name,
                    taskLabel: `${project.milestones.find((m) => m.id === schedule.milestoneId)?.name ?? "General"} - ${schedule.tradie.trade}`,
                    durationDays: schedule.durationDays,
                    updatedAt: new Date(schedule.updatedAt).toISOString(),
                    contact: {
                      email: schedule.tradie.email,
                      phone: schedule.tradie.phone,
                      additionalEmails: schedule.tradie.additionalEmails,
                    },
                    siteManager: {
                      name: project.siteManager?.name ?? "Site Manager",
                      email: project.siteManager?.email ?? "Site Manager Email",
                      phone: project.siteManager?.phone ?? "Site Manager Phone",
                    },
                    isFavourite: schedule.tradie.isFavourite,
                    note: schedule.tradie.note,
                    requiresQuote: schedule.requiresQuote,
                    quotedPrice: schedule.quotedPrice ?? undefined,
                  } satisfies TradieScheduleListItem,
                },
              }),
            )
          }
        >
          <Bell className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

export function ProjectAlerts({ project }: { project: ProjectDetail }) {
  const complianceMutations = useAppSelector(selectComplianceMutations);
  const engagement = project.certifierEngagement;

  const tradieAlerts = useMemo(() => {
    const now = new Date();
    const nextWeek = addWeeks(now, 1);
    // Midnight, not the current instant. A trade booked for this morning is
    // still today's work at two in the afternoon, and dropping it off the list
    // the moment the clock passes it is the opposite of useful.
    const today = startOfDay(now);

    return project.tradieSchedules.filter((schedule) => {
      // Confirmed and still ahead. The row prints `scheduledDate`, so an
      // unbounded status test put a booking from three months ago under a
      // heading that says "Upcoming" with a date in the past beside it — and
      // every one of those pushed a genuinely upcoming trade further down a
      // list that shows four.
      const isConfirmedAndAhead =
        schedule.status === "CONFIRMED" &&
        new Date(schedule.scheduledDate) >= today;

      // Kept as it was, and deliberately not bounded the same way: this arm is
      // about a milestone falling due within the week, which is actionable
      // whatever state the booking behind it is in.
      const targetDate = schedule.milestone?.targetDate;
      const isMilestoneDueSoon =
        targetDate &&
        isWithinInterval(new Date(targetDate), {
          start: now,
          end: nextWeek,
        });

      return isConfirmedAndAhead || isMilestoneDueSoon;
    });
  }, [project.tradieSchedules]);

  const complianceAlerts = engagement?.alerts ?? [];
  const openCount = complianceAlerts.filter(
    (alert) => alert.status === ComplianceAlertStatus.OPEN,
  ).length;

  /**
   * Whether one alert has anybody to chase.
   *
   * The same reading the server takes before it refuses the send — which party
   * the condition belongs to, and whether that party has a live thread — so a
   * button that offers a chase and a request that refuses one cannot disagree.
   * A button that can only fail is worse than no button.
   *
   * Per alert rather than per list, which is the correction one flag got wrong
   * in both directions: a file whose surveyor documents the client supplied has
   * nobody to write to about a title search, and may at the same moment have a
   * live architect thread with a redraw overdue on it.
   */
  const canChaseAlert = (alert: ComplianceAlertRecord) => {
    const party = COMPLIANCE_ALERT_PARTY[alert.type];
    if (!party) return false;
    const outreach = outreachForParty(engagement, party);
    return Boolean(
      outreach?.contactEmail &&
        outreach.mode === ComplianceOutreachMode.OUTREACH,
    );
  };

  // Empty chrome was eating a full card slot between the budget cards and the
  // tabs on every quiet project. Alerts only earn the surface when there is
  // something to act on; the "none" case is silence, not a placeholder panel.
  if (tradieAlerts.length === 0 && complianceAlerts.length === 0) {
    return null;
  }

  return (
    <Card className="rounded-xl border-border/70 bg-card shadow-sm">
      <CardHeader className="border-b border-border/70 pb-4">
        <CardTitle
          as="h2"
          className="flex items-center gap-2 text-base font-semibold text-foreground"
        >
          <Bell className="size-4 text-warning-ink" aria-hidden="true" />
          Alerts
          {/* Open compliance conditions only. A trade reminder is not something
              anybody is behind on, and counting the two together would put a
              number on this card that goes up when a job is going well. */}
          {openCount > 0 ? (
            <StatusPill tone="warning">{openCount} open</StatusPill>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-5">
        {complianceAlerts.length > 0 ? (
          <ul className="space-y-2">
            {complianceAlerts.map((alert) => (
              <ComplianceAlertRow
                key={alert.id}
                alert={alert}
                projectId={project.id}
                canFollowUp={canChaseAlert(alert)}
                isBusy={
                  complianceMutations[complianceScope.alert(alert.id)]
                    ?.status === "pending"
                }
              />
            ))}
          </ul>
        ) : null}

        {tradieAlerts.length > 0 ? (
          <>
            {/* A heading only once there is something above it to be told
                apart from. On a job with no compliance file this is the whole
                card and a label over a single list is noise. */}
            {complianceAlerts.length > 0 ? (
              <p className="pt-1 text-xs font-medium text-muted-foreground">
                Upcoming trades
              </p>
            ) : null}
            <ul className="space-y-3">
              {tradieAlerts.slice(0, 4).map((schedule) => (
                <TradieAlertRow
                  key={schedule.id}
                  schedule={schedule}
                  project={project}
                />
              ))}
            </ul>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
