"use client";

import {
  AlertTriangle,
  BadgeCheck,
  Check,
  ChevronRight,
  ClipboardList,
  Compass,
  FileStack,
  Landmark,
  PencilRuler,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { ComplianceStageActor } from "@/lib/compliance/stage-actors";
import type {
  ComplianceStage,
  ComplianceStageId,
} from "@/lib/compliance/stage-flow";

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
 */

/** What each stage is, in one mark. */
const STAGE_ICON: Readonly<Record<ComplianceStageId, LucideIcon>> = {
  SURVEYOR: Compass,
  ARCHITECT: PencilRuler,
  COUNCIL: Landmark,
  CERTIFIER: ShieldCheck,
  DEVELOPMENT_APPLICATION: FileStack,
  CHECKLIST: ClipboardList,
  CERTIFICATE: BadgeCheck,
};

/** The node's own padding above its marker, and the marker's own radius. */
const NODE_PAD_TOP = "0.375rem";
const MARKER_RADIUS = "1.25rem";
/**
 * How far down a node the rail runs — the marker's own centre line.
 *
 * Both terms spelled out rather than one figure, because forgetting the first
 * of them is exactly what went wrong: the rail was set to the marker's radius
 * alone and drew six pixels low, through the bottom third of every node on the
 * run. Written as the sum, a change to the node's padding moves the rail with
 * it instead of quietly leaving it behind.
 */
const RAIL_TOP = `calc(${NODE_PAD_TOP} + ${MARKER_RADIUS})`;

/** How far the branch drops below the main run before it turns and runs across. */
const BRANCH_DROP = "1.25rem";
/** The stub from that run down into the card hanging off it. */
const BRANCH_STUB = "0.75rem";

type Tone = "danger" | "warn" | "ok" | "muted";

/**
 * The state, in words, for a reader who cannot see the colour.
 *
 * Everything the marker says is carried by an icon and a fill, and
 * `aria-current="step"` only ever labels one node. Without this a screen reader
 * announced "Surveyor" identically for a finished stage, a stage nine days late
 * and a stage nobody has started — seven names and no state at all, which is
 * the whole of what this header is for.
 */
function stageStateLabel(stage: ComplianceStage): string {
  if (!stage.isActive) {
    return "not required on this job";
  }
  if (stage.isOverdue) {
    return "needs attention";
  }
  switch (stage.state) {
    case "done":
      return stage.elapsedBusinessDays !== null
        ? `completed in ${stage.elapsedBusinessDays} working days`
        : "completed";
    case "current":
      return stage.daysLeft !== null
        ? stage.daysLeft < 0
          ? `in progress, ${Math.abs(stage.daysLeft)} working days past the quoted turnaround`
          : `in progress, ${stage.daysLeft} working days left`
        : "in progress";
    default:
      return "not started";
  }
}

/**
 * The one line under a stage name.
 *
 * Read in state order rather than in figure order, which is the correction. It
 * used to ask "is there a `daysLeft`" first and only then "is this finished",
 * so a surveyor who answered inside their quote carried "3d left" under a green
 * tick and one who answered late carried "9d over" — a countdown running on a
 * wait that ended a month ago, on a firm that had done nothing wrong. A stage
 * that is finished has a duration; only a stage still running has a countdown.
 *
 * `daysLeft` is now null on anything settled, so this could not say it again
 * even if it asked in the old order. Both halves changed on purpose: the shape
 * of the data stops it and the shape of this function stops it, because the
 * failure was silent and cost nothing to make impossible twice.
 */
function stageTiming(
  stage: ComplianceStage,
): { text: string; tone: Tone } | null {
  if (!stage.isActive) {
    return { text: "If required", tone: "muted" };
  }

  // Red without a clock behind it. A stale title search is raised against a
  // surveyor who answered on time, and a development approval requirement
  // against nobody at all, so there is no figure to show — but the node is red
  // and a node that is red and says nothing reads as a rendering fault.
  if (stage.isOverdue) {
    return { text: "Needs attention", tone: "danger" };
  }

  if (stage.state === "done") {
    return stage.elapsedBusinessDays !== null
      ? { text: `Done in ${stage.elapsedBusinessDays}d`, tone: "ok" }
      : { text: "Done", tone: "ok" };
  }

  const { daysLeft, elapsedBusinessDays } = stage;

  if (daysLeft !== null) {
    if (daysLeft < 0) {
      // Past the quote with no alert against it yet — the sweep runs nightly,
      // so there is a window where this knows before the panel does.
      return { text: `${Math.abs(daysLeft)}d over`, tone: "warn" };
    }
    return {
      text: daysLeft === 0 ? "Due today" : `${daysLeft}d left`,
      tone: daysLeft <= 2 ? "warn" : "muted",
    };
  }

  // No quote to measure against, so how long it has been running is all there
  // is to say. Nothing at all for a stage nobody has started, which is the
  // honest answer there — "0 days" on a surveyor nobody has written to reads as
  // a clock that is running.
  if (elapsedBusinessDays !== null) {
    return {
      text:
        elapsedBusinessDays === 0
          ? "Started today"
          : `${elapsedBusinessDays}d in`,
      tone: "muted",
    };
  }

  return null;
}

const TIMING_CLASS: Readonly<Record<Tone, string>> = {
  danger: "border-destructive/40 bg-destructive-light text-destructive-ink",
  warn: "border-warning/40 bg-warning-light text-warning-ink",
  ok: "border-success/30 bg-success-light text-success-ink",
  muted: "border-transparent bg-muted text-muted-foreground",
};

const ACTOR_CLASS: Readonly<Record<ComplianceStageActor["state"], string>> = {
  outstanding: "border-warning/40 bg-warning-light text-warning-ink",
  settled: "border-success/30 bg-success-light text-success-ink",
  idle: "border-border/70 bg-transparent text-muted-foreground",
};

/**
 * Who is behind a node, capped.
 *
 * A development application pulls in nine parties and a checklist that has not
 * arrived yet pulls in seven, and nine badges under a node in a row of six is a
 * wall rather than a picture. So the first few are drawn and the rest are a
 * count — with everybody's name on the group's title, because the count is only
 * useful if there is some way to find out who it is counting.
 *
 * The ones still owing come first. That is the ordering that makes the badges
 * worth reading at all: on a stage half way through, "who is holding this up"
 * is the question, and answering it with whichever consultant happens to sit
 * first in the deliverables table answers a different one.
 */
function StageActors({
  actors,
  limit,
  dimmed,
  align,
}: {
  actors: ComplianceStageActor[];
  limit: number;
  dimmed: boolean;
  align: "center" | "start";
}) {
  if (actors.length === 0) return null;

  const rank: Record<ComplianceStageActor["state"], number> = {
    outstanding: 0,
    idle: 1,
    settled: 2,
  };
  const ordered = [...actors].sort((a, b) => rank[a.state] - rank[b.state]);
  const shown = ordered.slice(0, limit);
  const hidden = ordered.length - shown.length;

  return (
    <span
      className={cn(
        "flex flex-wrap items-center gap-1",
        align === "center" ? "justify-center" : "w-full justify-start",
        dimmed && "opacity-60",
      )}
      title={ordered.map((actor) => actor.label).join(", ")}
    >
      {shown.map((actor) => (
        <span
          key={actor.id}
          className={cn(
            "rounded-full border px-1.5 py-px text-[10px] leading-4 font-medium whitespace-nowrap",
            ACTOR_CLASS[actor.state],
          )}
        >
          {actor.short}
        </span>
      ))}
      {hidden > 0 ? (
        <span className="rounded-full border border-border/70 px-1.5 py-px text-[10px] leading-4 text-muted-foreground">
          +{hidden}
        </span>
      ) : null}
    </span>
  );
}

/** The marker, which carries the state before any text is read. */
function StageMarker({ stage }: { stage: ComplianceStage }) {
  const Icon = STAGE_ICON[stage.id];
  const dormant = !stage.isActive;

  return (
    <span className="relative z-10 block" aria-hidden="true">
      <span
        className={cn(
          "flex size-10 items-center justify-center rounded-xl border-2 transition-colors",
          dormant
            ? "border-dashed border-border bg-card text-muted-foreground/70"
            : stage.isOverdue
              ? "border-destructive/60 bg-destructive-light text-destructive-ink"
              : stage.state === "done"
                ? "border-success/50 bg-success-light text-success-ink"
                : stage.state === "current"
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4.5" />
      </span>

      {/* The corner mark, so a finished node and a late one are told apart
          without reading the fill. The alert wins where a stage is both, which
          happens more than it sounds: a stale title search is raised against a
          surveyor who sent everything they were asked for. */}
      {stage.isActive && (stage.isOverdue || stage.state === "done") ? (
        <span
          className={cn(
            "absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full border-2 border-card",
            stage.isOverdue
              ? "bg-destructive text-white"
              : "bg-success text-white",
          )}
        >
          {stage.isOverdue ? (
            <AlertTriangle className="size-2.5" />
          ) : (
            <Check className="size-2.5" strokeWidth={3} />
          )}
        </span>
      ) : null}
    </span>
  );
}

/** The name, the clock and the cast — everything under a marker. */
function StageCaption({
  stage,
  actorLimit,
  align = "center",
}: {
  stage: ComplianceStage;
  actorLimit: number;
  /**
   * Centred under a marker on the main run, and beside one on the branch.
   *
   * Not only an alignment. A node in a column six wide has one line to work
   * with and stacks its three parts; the branch card is beside its marker
   * rather than under it and can put the name and the clock on one line, which
   * is what keeps it two lines tall where the branch leaves the column next to
   * the one it rejoins and there is barely a card's width to draw in.
   */
  align?: "center" | "start";
}) {
  const timing = stageTiming(stage);

  return (
    <span
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1",
        align === "center"
          ? "flex-col justify-center gap-y-1.5"
          : "justify-start",
      )}
    >
      <span
        className={cn(
          "text-xs leading-tight font-medium",
          !stage.isActive
            ? "text-muted-foreground"
            : stage.isOverdue
              ? "text-destructive-ink"
              : stage.state === "upcoming"
                ? "text-muted-foreground"
                : "text-foreground",
        )}
      >
        {stage.label}
        {/* Inside the label rather than beside it, so the two are announced as
            one thing: "Surveyor, needs attention". The chip below says the same
            in fewer characters for a sighted reader, so it is hidden from the
            accessibility tree rather than read out twice. */}
        <span className="sr-only">, {stageStateLabel(stage)}</span>
      </span>

      {timing ? (
        <span
          aria-hidden="true"
          className={cn(
            "rounded-full border px-1.5 py-px text-[10px] leading-4 font-medium tabular-nums",
            TIMING_CLASS[timing.tone],
          )}
        >
          {timing.text}
        </span>
      ) : null}

      <StageActors
        actors={stage.actors}
        limit={actorLimit}
        dimmed={!stage.isActive}
        align={align}
      />
    </span>
  );
}

type ComplianceStageFlowProps = {
  stages: ComplianceStage[];
  /** Focuses the block this stage corresponds to. */
  onSelectStage?: (stage: ComplianceStage) => void;
  className?: string;
};

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
      : { "aria-current": undefined };

  return (
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
                    branch.isActive ? "border-b-primary/50" : "border-b-border",
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
                    <StageCaption stage={branch} actorLimit={4} align="start" />
                  </BranchNode>
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
