"use client";

import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Timer,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { COMPLIANCE_ALERT_COPY } from "@/constants/complianceAlerts";
import { cn } from "@/lib/utils";
import type {
  ComplianceStage,
  ComplianceStageId,
} from "@/lib/domain/compliance/stage-flow";

import {
  BRANCH_DROP,
  BRANCH_STUB,
  NODE_PAD_TOP,
  RAIL_TOP,
  StageCaption,
  StageMarker,
} from "./compliance-stage-node";

/**
 * The route this file takes, drawn.
 *
 * The tab has always known which block the flow was waiting on and for a while
 * said so with a row of seven dots. Which answered "which step" and nothing
 * else, because a row of dots can only ever say one thing: that these are seven
 * equal steps on one line, in order, every job. None of which is true. Two of
 * the three things a reader actually wants from a picture of this process were
 * missing from it —
 *
 *  - **It is not one line.** Development approval leaves the main run at
 *    whichever step the job was on when somebody said it was needed, runs for a
 *    month or two with its own paperwork, and comes back in at the checklist.
 *    Drawn as a seventh dot it read as a step every job takes; dropped from the
 *    jobs that had not taken it, a reader who has never seen one had no way to
 *    learn the road exists. So it is a branch: drawn on every job, off to one
 *    side, joined to the line at both ends, and dark until the alert that puts a
 *    job on it is raised.
 *  - **Steps have people behind them.** "Checklist — 9d in" says a twenty-item
 *    list is open and nothing about eighteen of those items being the builder's
 *    own paperwork and two being a structural engineer who has not written back.
 *    Every node carries its cast, which is the whole point of drawing the
 *    approval branch on a job that is not on it: a reader can see what taking it
 *    would cost before anybody commits to it.
 *
 * Still deliberately thin on words. A node is a name, a state, one short line
 * and a few badges. The detail is a scroll away in the block itself and a
 * sentence away in the alert above the tabs; repeating either here would turn a
 * header meant to be read at a glance into a third copy of the same paragraph.
 *
 * The geometry, since it is load-bearing: the main run is a grid of equal
 * columns with no column gap, so a column's centre is exactly where a connector
 * has to meet it. The branch is one grid cell spanning from the column it
 * leaves to the column it rejoins, inset on each side by half a column — which
 * lands its two uprights precisely under those two nodes at any width, with no
 * measuring and nothing to fall out of step when the number of stages changes.
 *
 * That geometry is the whole of what is left in this file. What a single node
 * says -- its mark, its words, its clock, its cast -- is in
 * `compliance-stage-node.tsx` beside it, which is where to read about any of
 * the four.
 */

type ComplianceStageFlowProps = {
  stages: ComplianceStage[];
  /** Focuses the block this stage corresponds to. */
  onSelectStage?: (stage: ComplianceStage) => void;
  className?: string;
};

const STAGE_DETAILS: Readonly<Record<ComplianceStageId, string>> = {
  SURVEYOR:
    "Requests the property and site information that establishes the project’s starting constraints.",
  ARCHITECT:
    "Assembles the design pack and resolves the design information needed for certification.",
  COUNCIL:
    "Collects council records and planning information needed to assess the proposal.",
  CERTIFIER:
    "Reviews the submission and turns any missing evidence into checklist items to resolve.",
  DEVELOPMENT_APPLICATION:
    "Runs the development approval detour from lodgement through to the authority’s determination.",
  CHECKLIST:
    "Tracks each certifier request until the evidence is supplied or the item is marked not required.",
  PLANNING_PORTAL:
    "Lodges the application and waits for the planning portal or authority to determine it.",
  CERTIFICATE:
    "Collects the final certificate and cover so the compliance file can be closed.",
};

const STAGE_DATE_FORMATTER = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Australia/Sydney",
});

const businessDays = (days: number) =>
  `${days} business ${days === 1 ? "day" : "days"}`;

function stageTimeline(stage: ComplianceStage) {
  if (!stage.isActive || stage.elapsedBusinessDays === null) {
    return null;
  }

  const percentUsed =
    stage.slaBusinessDays === null
      ? null
      : Math.max(
          0,
          (stage.elapsedBusinessDays / Math.max(stage.slaBusinessDays, 1))
            * 100,
        );

  return {
    progress:
      percentUsed === null ? null : Math.min(100, Math.max(0, percentUsed)),
    percentUsed,
    elapsedBusinessDays: stage.elapsedBusinessDays,
    daysLeft: stage.daysLeft,
    slaBusinessDays: stage.slaBusinessDays,
    startedAt: stage.startedAt,
    isComplete: stage.state === "done",
  };
}

function timelineProgressColor(progress: number): string {
  if (progress <= 60) {
    const warning = (progress / 60) * 100;
    return `color-mix(in oklab, var(--success) ${100 - warning}%, var(--warning) ${warning}%)`;
  }

  const destructive = ((progress - 60) / 40) * 100;
  return `color-mix(in oklab, var(--warning) ${100 - destructive}%, var(--destructive) ${destructive}%)`;
}

function stageStatus(stage: ComplianceStage): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  tone?: "warning";
} {
  if (!stage.isActive) return { label: "Optional route", variant: "outline" };
  if (stage.isOverdue) {
    return { label: "Needs attention", variant: "destructive" };
  }
  if (stage.daysLeft !== null && stage.daysLeft < 0) {
    return { label: "SLA exceeded", variant: "outline", tone: "warning" };
  }
  if (stage.hasPortalDownload) {
    return { label: "Ready to download", variant: "secondary" };
  }
  if (stage.state === "done") {
    return { label: "Complete", variant: "secondary" };
  }
  if (stage.state === "current") {
    return { label: "In progress", variant: "default" };
  }
  return { label: "Not started", variant: "outline" };
}

function remainingLabel(daysLeft: number | null, isComplete: boolean): string {
  if (isComplete) return "Complete";
  if (daysLeft === null) return "No SLA";
  if (daysLeft < 0) return `${businessDays(Math.abs(daysLeft))} over`;
  if (daysLeft === 0) return "Due today";
  return `${businessDays(daysLeft)} left`;
}

function StageTimeline({ stage }: { stage: ComplianceStage }) {
  const timeline = stageTimeline(stage);

  if (!timeline) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg bg-background/10 px-3 py-2.5">
        <Clock3
          className="size-4 shrink-0 text-background/60"
          aria-hidden="true"
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[11px] font-medium text-background/90">
            {stage.isActive
              ? "Timeline not started"
              : "No timeline on this job"}
          </span>
          <span className="text-[10px] leading-relaxed text-background/55">
            {stage.isActive
              ? "The clock starts when this stage is engaged or lodged."
              : "This route only starts if development approval is required."}
          </span>
        </div>
      </div>
    );
  }

  const percentUsed =
    timeline.percentUsed === null ? null : Math.round(timeline.percentUsed);
  const isOverdue = timeline.daysLeft !== null && timeline.daysLeft < 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-background/80">
          <Timer className="size-4" aria-hidden="true" />
          <span className="text-[11px] font-semibold tracking-[0.08em] uppercase">
            Timeline
          </span>
        </div>
        {timeline.startedAt ? (
          <span className="flex items-center gap-1.5 text-[10px] text-background/55">
            <CalendarClock className="size-3" aria-hidden="true" />
            Started {STAGE_DATE_FORMATTER.format(timeline.startedAt)}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5 rounded-lg bg-background/10 px-3 py-2.5">
          <span className="text-lg leading-none font-semibold tabular-nums text-background">
            {timeline.elapsedBusinessDays}
          </span>
          <span className="text-[10px] text-background/55">
            {timeline.elapsedBusinessDays === 1
              ? "business day"
              : "business days"}{" "}
            elapsed
          </span>
        </div>
        <div
          className={cn(
            "flex flex-col gap-0.5 rounded-lg px-3 py-2.5",
            isOverdue ? "bg-warning/25" : "bg-background/10",
          )}
        >
          <span
            className={cn(
              "text-sm leading-none font-semibold tabular-nums",
              isOverdue ? "text-warning-light" : "text-background",
            )}
          >
            {remainingLabel(timeline.daysLeft, timeline.isComplete)}
          </span>
          <span className="text-[10px] text-background/55">
            {timeline.isComplete
              ? "timeline stopped"
              : timeline.slaBusinessDays === null
                ? "no quoted turnaround"
                : "until quoted completion"}
          </span>
        </div>
      </div>

      {timeline.progress !== null && timeline.slaBusinessDays !== null ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 text-[10px] text-background/60">
            <span>SLA budget used</span>
            <span className="tabular-nums">
              {timeline.elapsedBusinessDays} / {timeline.slaBusinessDays} days ·{" "}
              {percentUsed}%
            </span>
          </div>
          <Progress
            value={timeline.progress}
            aria-label={`${stage.label} SLA time used`}
            aria-valuetext={`${timeline.elapsedBusinessDays} of ${timeline.slaBusinessDays} business days used`}
            className="h-2.5 bg-background/15 [&_[data-slot=progress-indicator]]:bg-(--sla-progress-color)"
            style={
              {
                "--sla-progress-color": timelineProgressColor(
                  timeline.progress,
                ),
              } as CSSProperties
            }
          />
          <div className="flex justify-between text-[9px] font-medium tracking-wide text-background/45 uppercase">
            <span>Started</span>
            <span>Attention</span>
            <span>SLA limit</span>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg border border-dashed border-background/15 px-3 py-2 text-[10px] leading-relaxed text-background/55">
          <Clock3 className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          Elapsed time is tracked, but this stage has no published SLA to count
          down against.
        </div>
      )}
    </div>
  );
}

function StageTooltip({
  stage,
  children,
}: {
  stage: ComplianceStage;
  children: ReactNode;
}) {
  const actors = stage.actors;
  const status = stageStatus(stage);
  const problemAlerts = stage.alerts.filter(
    (alert) => COMPLIANCE_ALERT_COPY[alert.type].tone !== "positive",
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={10}
        className="block w-80 max-w-[calc(100vw-2rem)] rounded-xl p-0 shadow-xl"
      >
        <div className="flex flex-col gap-3.5 p-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold text-background">
                {stage.label}
              </p>
              <Badge
                variant={status.variant}
                className={cn(
                  "shrink-0",
                  status.variant === "outline"
                    && "border-background/20 text-background",
                  status.tone === "warning"
                    && "border-warning/40 bg-warning-light text-warning-ink",
                )}
              >
                {status.label === "Complete" ? (
                  <CheckCircle2 data-icon="inline-start" aria-hidden="true" />
                ) : null}
                {status.label}
              </Badge>
            </div>
            <p className="text-xs leading-relaxed text-background/70">
              {STAGE_DETAILS[stage.id]}
            </p>
          </div>

          <Separator className="bg-background/15" />

          <StageTimeline stage={stage} />

          {problemAlerts.length > 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/15 px-3 py-2.5">
              <AlertTriangle
                className="mt-0.5 size-3.5 shrink-0 text-destructive-light"
                aria-hidden="true"
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[10px] font-semibold tracking-wide text-background/55 uppercase">
                  Open alert
                </span>
                <span className="text-[11px] leading-relaxed text-background/85">
                  {COMPLIANCE_ALERT_COPY[problemAlerts[0].type].title}
                  {problemAlerts.length > 1
                    ? ` + ${problemAlerts.length - 1} more`
                    : ""}
                </span>
              </div>
            </div>
          ) : null}

          <Separator className="bg-background/15" />

          {actors.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-[10px] font-semibold tracking-[0.12em] text-background/55 uppercase">
                Parties
              </p>
              <div className="flex flex-wrap gap-1.5">
                {actors.map((actor) => (
                  <Badge
                    key={actor.id}
                    variant="outline"
                    className="h-auto border-background/20 bg-background/10 py-1 text-[11px] text-background"
                  >
                    {actor.label}
                    <span className="text-background/55">
                      ·{" "}
                      {actor.state === "outstanding"
                        ? "outstanding"
                        : actor.state === "settled"
                          ? "settled"
                          : "not engaged"}
                    </span>
                  </Badge>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-background/60">
              No parties are attached to this stage yet.
            </p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function ComplianceStageFlow({
  stages,
  onSelectStage,
  className,
}: ComplianceStageFlowProps) {
  const main = stages.filter((stage) => stage.track === "main");
  const branch = stages.find((stage) => stage.track === "approval") ?? null;

  if (main.length === 0) return null;

  const columnOf = (id: ComplianceStageId | null) =>
    id === null ? -1 : main.findIndex((stage) => stage.id === id);

  // Both ends of the branch, in main-run columns. A branch whose ends cannot be
  // placed is not drawn at all rather than drawn somewhere arbitrary — which is
  // unreachable today, since `branchOrigin` only ever names stages that are on
  // the main run, and is cheaper to hold than to prove.
  const from = columnOf(branch?.branchesFrom ?? null);
  const to = columnOf(branch?.rejoinsAt ?? null);
  const hasBranch = branch !== null && from >= 0 && to > from;

  /** Half a column, as a percentage of the branch's own span. */
  const inset = hasBranch ? 50 / (to - from + 1) : 0;

  const selectable = (stage: ComplianceStage) =>
    Boolean(onSelectStage) && stage.isActive;

  // A dormant branch is a picture rather than a control: the block it would
  // open is not on the tab at all on a job with no development application, and
  // a node that looks pressable and does nothing is worse than one that plainly
  // is not.
  const BranchNode = branch && selectable(branch) ? "button" : "div";

  const nodeProps = (stage: ComplianceStage) =>
    selectable(stage)
      ? {
          type: "button" as const,
          onClick: () => onSelectStage?.(stage),
          "aria-current":
            stage.state === "current" ? ("step" as const) : undefined,
        }
      : { "aria-current": undefined, tabIndex: 0 };

  return (
    <TooltipProvider delayDuration={180}>
      <nav
        aria-label="Compliance stages"
        className={cn(
          "rounded-xl border border-border/70 bg-card px-3 py-4 shadow-sm",
          className,
        )}
      >
        {/* Scrolls rather than wraps. Six stages plus a branch is wider than a
          phone, and wrapping them puts the last two on a line of their own
          under a connector that no longer connects anything — which reads as
          two flows rather than one. */}
        <div className="overflow-x-auto pb-1">
          <div
            role="list"
            className="grid"
            style={{
              // No column gap on purpose: a gap moves a column's centre away from
              // the point the branch inset computes, and the connectors would
              // then meet the nodes a few pixels off at every width.
              gridTemplateColumns: `repeat(${main.length}, minmax(8.5rem, 1fr))`,
            }}
          >
            {/* Rendered in route order — the branch between the certifier and the
              checklist — and placed by grid rather than by position, so the
              order a screen reader walks is the order the job happens in while
              the drawing puts the branch on its own line. */}
            {stages.map((stage) => {
              if (stage.track === "approval") return null;

              const index = main.indexOf(stage);
              const isLast = index === main.length - 1;
              const railDone = stage.state === "done";
              const Node = selectable(stage) ? "button" : "div";

              return (
                <div
                  key={stage.id}
                  role="listitem"
                  className="relative px-1"
                  style={{ gridRow: 1, gridColumn: index + 1 }}
                >
                  {/* Centre to centre of the next column, under the markers. The
                    marker sits above it on its own stacking context, so the
                    rail passes behind rather than through. */}
                  {!isLast ? (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute flex items-center"
                      style={{
                        top: `calc(${RAIL_TOP} - 1px)`,
                        left: "50%",
                        width: "100%",
                      }}
                    >
                      <span
                        className={cn(
                          "h-0.5 flex-1 rounded-full",
                          railDone ? "bg-success/50" : "bg-border",
                        )}
                      />
                      <ChevronRight
                        className={cn(
                          "-ml-1 size-3 shrink-0",
                          railDone ? "text-success/60" : "text-border",
                        )}
                      />
                    </span>
                  ) : null}

                  <StageTooltip stage={stage}>
                    <Node
                      {...nodeProps(stage)}
                      className={cn(
                        "flex w-full flex-col items-center gap-1.5 rounded-lg px-1 text-center",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                        selectable(stage) && "hover:bg-muted/60",
                      )}
                      style={{
                        paddingTop: NODE_PAD_TOP,
                        paddingBottom: NODE_PAD_TOP,
                      }}
                    >
                      <StageMarker stage={stage} />
                      <StageCaption stage={stage} actorLimit={3} />
                    </Node>
                  </StageTooltip>
                </div>
              );
            })}

            {hasBranch && branch ? (
              <div
                role="listitem"
                className="relative"
                style={{ gridRow: 2, gridColumn: `${from + 1} / ${to + 2}` }}
              >
                <div
                  className="relative"
                  style={{
                    marginLeft: `${inset}%`,
                    marginRight: `${inset}%`,
                    paddingTop: `calc(${BRANCH_DROP} + ${BRANCH_STUB})`,
                  }}
                >
                  {/* The three pieces of the connector: down out of the stage it
                    leaves, along, and back up into the checklist. Drawn as
                    borders rather than as an SVG so they inherit the theme's
                    own colours and need no viewBox to keep in step with a grid
                    that resizes. */}
                  {(
                    [
                      ["left", "left-0 rounded-bl-2xl border-b-2 border-l-2"],
                      ["right", "right-0 rounded-br-2xl border-r-2 border-b-2"],
                    ] as const
                  ).map(([side, classes]) => (
                    <span
                      key={side}
                      aria-hidden="true"
                      className={cn(
                        "pointer-events-none absolute top-0 w-6",
                        branch.isActive
                          ? "border-primary/40"
                          : "border-dashed border-border",
                        classes,
                      )}
                      style={{ height: BRANCH_DROP }}
                    />
                  ))}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "pointer-events-none absolute right-6 left-6 border-t-2",
                      branch.isActive
                        ? "border-primary/40"
                        : "border-dashed border-border",
                    )}
                    style={{ top: `calc(${BRANCH_DROP} - 2px)` }}
                  />

                  {/* Where it rejoins. An arrowhead rather than a plain join,
                    because the two uprights are otherwise identical and nothing
                    on the drawing would say which way round the detour goes. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "pointer-events-none absolute top-0 right-0 size-0 -translate-x-0.75 border-x-4 border-b-4 border-x-transparent",
                      branch.isActive
                        ? "border-b-primary/50"
                        : "border-b-border",
                    )}
                  />

                  {/* And down off the run into the card. The card hangs below
                    the line rather than sitting on it, which is what lets it be
                    whatever size its contents need: a card centred *on* the run
                    has to be a known height for the run to meet its middle, and
                    a known height is a card that breaks the first time a branch
                    leaves two columns from where it rejoins and the label
                    inside it wraps. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "pointer-events-none absolute left-1/2 w-0 border-l-2",
                      branch.isActive
                        ? "border-primary/40"
                        : "border-dashed border-border",
                    )}
                    style={{ top: BRANCH_DROP, height: BRANCH_STUB }}
                  />

                  {/* Centred by a flex parent rather than by `mx-auto`, which is
                    not the same thing once the card is wider than the box it
                    sits in: auto margins resolve to zero on the overflowing
                    side and push the whole card right, so a short branch drew
                    its card hanging off one upright and clear of the other. */}
                  <span className="flex justify-center">
                    <StageTooltip stage={branch}>
                      <BranchNode
                        {...nodeProps(branch)}
                        className={cn(
                          // A floor as well as a ceiling. The branch can leave from
                          // the column right next to the one it rejoins — a certifier
                          // asking for a DA on the checklist they have just issued —
                          // and half a column each side of that is not a card's
                          // width. So it keeps its own size and hangs past the
                          // uprights, which is harmless now that it sits under the
                          // run rather than on it.
                          "relative z-10 flex w-fit min-w-60 max-w-88 items-center gap-2.5 rounded-xl border px-3 py-2 text-left",
                          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                          branch.isActive
                            ? "border-border bg-card shadow-sm"
                            : "border-dashed border-border/80 bg-muted/30",
                          selectable(branch) && "hover:bg-muted/60",
                        )}
                      >
                        <StageMarker stage={branch} />
                        <StageCaption
                          stage={branch}
                          actorLimit={4}
                          align="start"
                        />
                      </BranchNode>
                    </StageTooltip>
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </nav>
    </TooltipProvider>
  );
}
