"use client";

import {
  AlertTriangle,
  BadgeCheck,
  Check,
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
 * One node on the compliance stage flow, and the words and colours behind it.
 *
 * Split from `compliance-stage-flow.tsx` so that file holds the one thing that
 * is genuinely hard about it -- the grid the main run is drawn on and the
 * branch geometry hung off it -- rather than that plus four hundred lines of
 * what a single node says. Nothing here knows there is a flow: a node is handed
 * a stage and renders it, which is why the branch card can reuse the same two
 * components at a different alignment and a different badge cap.
 *
 * The geometry constants live here rather than beside the layout because the
 * marker is what defines them. `RAIL_TOP` is the marker's own centre line, and
 * a rail computed anywhere other than next to the padding and radius it is the
 * sum of is a rail that silently stops meeting the markers the next time either
 * changes.
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
export const NODE_PAD_TOP = "0.375rem";
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
export const RAIL_TOP = `calc(${NODE_PAD_TOP} + ${MARKER_RADIUS})`;

/** How far the branch drops below the main run before it turns and runs across. */
export const BRANCH_DROP = "1.25rem";
/** The stub from that run down into the card hanging off it. */
export const BRANCH_STUB = "0.75rem";

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
 * The same three states, in words.
 *
 * The badge says who by colour and nothing else, so a reader who cannot see the
 * fill got seven or eight abbreviated firm names under a node and no way to
 * tell which of them the stage is waiting on -- which is the one thing the cast
 * is drawn to answer. Paired with `ACTOR_CLASS` above so the two cannot drift:
 * a fourth state would fail to compile until it had both a colour and a word.
 */
const ACTOR_STATE_LABEL: Readonly<
  Record<ComplianceStageActor["state"], string>
> = {
  outstanding: "still owing",
  settled: "settled",
  idle: "nothing running",
};

/** One party, as a screen reader should hear it. */
const actorSpoken = (actor: ComplianceStageActor) =>
  `${actor.label}, ${ACTOR_STATE_LABEL[actor.state]}`;

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
  const overflow = ordered.slice(shown.length);

  return (
    <span
      className={cn(
        "flex flex-wrap items-center gap-1",
        align === "center" ? "justify-center" : "w-full justify-start",
        dimmed && "opacity-60",
      )}
      // The pointer's shortcut to the same roster, kept. It is no longer the
      // only copy of it -- which is what was wrong with it -- and a hover that
      // names eight firms is still the cheapest way for somebody with a mouse
      // to read a row of eight-character pills.
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
          {/* Short on screen, full name and state in the tree. "Struct. eng."
              is a pill six stages wide has room for; "Structural engineer,
              still owing" is what the badge actually means, and the colour
              that carried the second half of it is not readable aloud. */}
          <span aria-hidden="true">{actor.short}</span>
          <span className="sr-only">{actorSpoken(actor)}</span>
        </span>
      ))}
      {overflow.length > 0 ? (
        <span className="rounded-full border border-border/70 px-1.5 py-px text-[10px] leading-4 text-muted-foreground">
          {/* "+3" is a count to look at and nothing to hear, so the three it
              stands for are spelled out here rather than left to the group's
              title -- which a pointer reaches and a screen reader does not. */}
          <span aria-hidden="true">+{overflow.length}</span>
          <span className="sr-only">
            {`and ${overflow.length} more: ${overflow.map(actorSpoken).join("; ")}`}
          </span>
        </span>
      ) : null}
    </span>
  );
}

/** The marker, which carries the state before any text is read. */
export function StageMarker({ stage }: { stage: ComplianceStage }) {
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
export function StageCaption({
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
