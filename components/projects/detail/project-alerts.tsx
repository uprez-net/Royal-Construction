"use client";

import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock10,
  Download,
  Loader2,
  Send,
} from "lucide-react";
import { toast } from "sonner";

import { ComplianceAlertStatus, ComplianceOutreachMode } from "@prisma/client";

import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ALERT_SOURCE_LABEL,
  COMPLIANCE_ALERT_COPY,
} from "@/constants/complianceAlerts";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { COMPLIANCE_ALERT_PARTY } from "@/lib/domain/compliance/alert-parties";
import { missingMilestoneTrades } from "@/lib/domain/projects/tradie-dependencies";
import { bookingTrade } from "@/lib/domain/tradies/request-rules";
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
import type { ProjectDetail } from "@/types/project";
import { dataTimeFormat } from "@/utils/formatters";
import {
  TradieAttentionActionButton,
  useTradieAttention,
  type TradieAttentionEntry,
} from "./tradie-attention";

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
 * The compliance half leads. A trade follow-up is a booking to chase or
 * re-book, and the Tradies tab carries the same list with its own count; an
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
  const followUpKey = useIdempotencyKey();
  const copy = COMPLIANCE_ALERT_COPY[alert.type];
  const isOpen = alert.status === ComplianceAlertStatus.OPEN;

  /**
   * An open alert that is good news, rendered as such.
   *
   * Three of the twenty-four are raised by the NSW Planning Portal *approving*
   * something and sending no document with the email — so the file is approved
   * and holding nothing, and there is one download left. Before this they came out
   * in the same amber as a surveyor three weeks late, which was actively
   * misleading: somebody scanning this panel saw a job in trouble on the morning
   * its CDC came through.
   *
   * Still an open alert rather than a quiet status change, because the step that
   * is left only a person can take, and a file that went silently "approved" with
   * nothing on it is how a certificate sits undownloaded for a fortnight. What
   * changes is the colour, the icon and the verb — not whether it is listed.
   */
  const isPositive = isOpen && copy.tone === "positive";

  const handleFollowUp = async () => {
    try {
      await dispatch(
        sendComplianceFollowUp({
          projectId,
          alertId: alert.id,
          // Held until this send succeeds, so a second click lands on the same
          // key and the consultant is chased once. Rotating on success is what
          // lets the office chase them again later the same day, which the
          // derived day-bucket key used to report as sent and swallow.
          idempotencyKey: followUpKey.current(),
        }),
      ).unwrap();
      followUpKey.rotate();
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
        isPositive
          ? "border-success/40 bg-success-light"
          : isOpen
            ? "border-warning/40 bg-warning-light"
            : "border-border/70 bg-muted/40",
      )}
    >
      {/* A download rather than a tick on the positive ones, which is the
          distinction the icon has to carry: a resolved alert also renders green,
          and a tick on both would say "nothing to do here" on the one row that
          has something to do. */}
      {isPositive ? (
        <Download
          className="mt-0.5 size-4 shrink-0 text-success-ink"
          aria-hidden="true"
        />
      ) : isOpen ? (
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
          {isPositive ? <StatusPill tone="success">Approved</StatusPill> : null}
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
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
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

/**
 * One trade booking that needs somebody, with the control that deals with it.
 *
 * The same entry, wording and button as the Tradies tab's attention card. This
 * row used to list confirmed bookings and bookings whose milestone was due,
 * each with a reminder bell — so a tradie who had already confirmed was
 * offered a reminder here while the tab disabled that bell, and a tradie who
 * had declined showed in the tab and not here at all.
 */
function TradieAlertRow({
  entry,
  project,
}: {
  entry: TradieAttentionEntry;
  project: ProjectDetail;
}) {
  const { schedule, title, detail } = entry;
  const isDanger = entry.attention.tone === "danger";

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-[10px] border border-border/70 bg-card p-3.5">
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          isDanger
            ? "bg-destructive-light text-destructive"
            : "bg-warning-light text-warning-ink",
        )}
      >
        {isDanger ? (
          <AlertTriangle className="size-5" aria-hidden="true" />
        ) : (
          <Clock10 className="size-5" aria-hidden="true" />
        )}
      </div>

      <div className="min-w-0 flex-1 break-words">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {bookingTrade(schedule)} ·{" "}
          {schedule.milestone?.name ?? "General works"} · {detail}
        </p>
      </div>

      <div className="ml-auto">
        <TradieAttentionActionButton entry={entry} project={project} />
      </div>
    </li>
  );
}

/** How many trade alerts the card lists before pointing at the Tradies tab. */
const TRADIE_ALERT_LIMIT = 4;

export function ProjectAlerts({ project }: { project: ProjectDetail }) {
  const complianceMutations = useAppSelector(selectComplianceMutations);
  const engagement = project.certifierEngagement;

  // The Tradies tab's list, from the same rule, so the two never disagree
  // about which bookings need somebody or what to press.
  const tradieAlerts = useTradieAttention(project.tradieSchedules);

  const complianceAlerts = engagement?.alerts ?? [];
  // One alert per missing trade: an activity needing two trades can be
  // missing either, and each has its own booking to chase.
  const dependencyAlerts = project.milestones.flatMap((milestone) =>
    missingMilestoneTrades(milestone, project.tradieSchedules).map((trade) => ({
      milestone,
      trade,
    })),
  );

  /**
   * The two counts on the header, and why they are two.
   *
   * "Open" has always meant "something on this job needs attention", and the
   * download-ready alerts break that: they are open, and nothing is wrong. Folding
   * them in put a number on this card that went *up* when a job went well — a
   * builder whose CDC came through on the Tuesday saw their open count rise, which
   * is the opposite of what the badge is read for.
   *
   * So they are counted separately and shown in green beside it. Not counted at
   * all was the other option and is worse: a download nobody has done is the one
   * outstanding thing on a finished-looking file, and a collapsed card with no
   * number is a card nobody opens.
   */
  const openAlerts = complianceAlerts.filter(
    (alert) => alert.status === ComplianceAlertStatus.OPEN,
  );
  const readyCount = openAlerts.filter(
    (alert) => COMPLIANCE_ALERT_COPY[alert.type].tone === "positive",
  ).length;
  const openCount = openAlerts.length - readyCount + dependencyAlerts.length;

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
      outreach?.contactEmail
      && outreach.mode === ComplianceOutreachMode.OUTREACH,
    );
  };

  // Empty chrome was eating a full card slot between the budget cards and the
  // tabs on every quiet project. Alerts only earn the surface when there is
  // something to act on; the "none" case is silence, not a placeholder panel.
  if (
    tradieAlerts.length === 0
    && complianceAlerts.length === 0
    && dependencyAlerts.length === 0
  ) {
    return null;
  }

  return (
    <Card className="rounded-xl border-border/70 bg-card shadow-sm">
      <CardHeader className="border-b border-border/70 pb-4">
        <CardTitle
          as="h2"
          className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground"
        >
          <Bell className="size-4 text-warning-ink" aria-hidden="true" />
          Alerts
          {/* Compliance conditions and missing trades. Trade follow-ups are
              counted on the Tradies tab's own card, which lists the same
              bookings; counting them here too would put the same booking in
              two numbers on one page. */}
          {openCount > 0 ? (
            <StatusPill tone="warning">{openCount} open</StatusPill>
          ) : null}
          {readyCount > 0 ? (
            <StatusPill tone="success">
              {readyCount} ready to download
            </StatusPill>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-5">
        {dependencyAlerts.length > 0 ? (
          <ul
            className="flex flex-col gap-2"
            aria-label="Missing required trades"
          >
            {dependencyAlerts.map(({ milestone, trade }) => (
              <li
                key={`dependency-${milestone.id}-${trade}`}
                className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning-light px-4 py-3"
              >
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0 text-warning-ink"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-sm font-medium text-warning-ink">
                    No confirmed {trade} booking for this activity
                  </p>
                  <p className="mt-1 text-sm text-foreground">
                    {milestone.name} has started without a confirmed {trade}{" "}
                    booking. Book a tradie in this category against this
                    activity, approve the booking and obtain their final
                    confirmation. A booking against another activity does not
                    meet this dependency.
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {complianceAlerts.length > 0 ? (
          <ul className="space-y-2">
            {complianceAlerts.map((alert) => (
              <ComplianceAlertRow
                key={alert.id}
                alert={alert}
                projectId={project.id}
                canFollowUp={canChaseAlert(alert)}
                isBusy={
                  complianceMutations[complianceScope.alert(alert.id)]?.status
                  === "pending"
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
                Trades needing follow-up
              </p>
            ) : null}
            <ul className="space-y-3">
              {tradieAlerts.slice(0, TRADIE_ALERT_LIMIT).map((entry) => (
                <TradieAlertRow
                  key={entry.key}
                  entry={entry}
                  project={project}
                />
              ))}
            </ul>
            {tradieAlerts.length > TRADIE_ALERT_LIMIT ? (
              <p className="text-xs text-muted-foreground">
                {tradieAlerts.length - TRADIE_ALERT_LIMIT} more in the Tradies
                tab.
              </p>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
