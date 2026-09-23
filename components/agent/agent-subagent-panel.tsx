"use client";

import { useState } from "react";
import { useEveAgent } from "eve/react";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  CircleMinus,
  CircleX,
  LoaderCircle,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  agentTranscriptReducer,
  childProgressLabel,
  type AgentSubagentRun,
  type AgentTranscriptData,
} from "@/components/agent/agent-reducer";
import { formatDuration, humanize } from "@/components/agent/agent-format";
import { cn } from "@/lib/utils";

/**
 * A delegated specialist's own progress, anchored to the turn that delegated it.
 *
 * Status, output and failure come from the parent projection, so a reload
 * rebuilds the panel exactly as it was. The child's step-by-step detail lives
 * on the child session's stream, which is attached only while the panel is open
 * or the specialist is still running — one extra stream per visible specialist,
 * not one per delegation ever made.
 */
export function AgentSubagentPanel({ run }: { run: AgentSubagentRun }) {
  const live = isLive(run.status);
  const [open, setOpen] = useState(false);
  const followable = run.childSessionId !== null && !run.remote;
  const duration = formatDuration(run.startedAt, run.endedAt);
  const name = humanize(run.name || run.toolName || "Specialist");
  const summary =
    run.error
    ?? run.output
    ?? run.progress
    ?? (run.status === "requested"
      ? "Queued"
      : run.status === "delegating"
        ? "Preparing the specialist"
        : run.status === "interrupted"
          ? "The turn ended before this specialist reported back."
          : "Working in a separate session");

  return (
    <Collapsible
      className={cn(
        "rounded-xl border",
        run.status === "failed"
          ? "border-destructive/30 bg-destructive/5"
          : run.status === "completed"
            ? "border-emerald-200 bg-emerald-50/60"
            : run.status === "interrupted"
              ? "border-border/70 bg-muted/30"
              : "border-blue-200/80 bg-blue-50/50",
      )}
      onOpenChange={setOpen}
      open={open}
    >
      <CollapsibleTrigger
        aria-live={live ? "polite" : undefined}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left"
      >
        <span
          className={cn(
            "mt-0.5 grid size-7 shrink-0 place-items-center rounded-md",
            run.status === "failed"
              ? "bg-destructive/10 text-destructive"
              : run.status === "completed"
                ? "bg-emerald-100 text-emerald-700"
                : run.status === "interrupted"
                  ? "bg-background text-muted-foreground"
                  : "bg-blue-100 text-blue-700",
          )}
        >
          <Bot aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
            <p className="text-sm font-medium text-foreground">{name}</p>
            <StatusChip duration={duration} status={run.status} />
          </div>
          {live && followable && !open ? (
            <AgentSubagentLiveSummary
              childSessionId={run.childSessionId as string}
              fallback={summary}
            />
          ) : (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {summary}
            </p>
          )}
        </div>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border/50 px-3 py-2.5">
          {open && followable ? (
            <AgentSubagentTimeline
              childSessionId={run.childSessionId as string}
              fallback={summary}
            />
          ) : (
            <p className="whitespace-pre-wrap text-xs text-foreground/80">
              {summary}
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * One line of what a running specialist is doing, read from its own stream.
 *
 * eve publishes a specialist's steps on the child session, not the parent, so
 * without this the collapsed card says "Working" and nothing else for however
 * long the specialist takes. Mounted only while the specialist is live and the
 * card is closed; the open card's timeline attaches to the same stream itself.
 */
function AgentSubagentLiveSummary({
  childSessionId,
  fallback,
}: {
  childSessionId: string;
  fallback: string;
}) {
  const [reducer] = useState(agentTranscriptReducer);
  const child = useEveAgent<AgentTranscriptData>({
    initialSession: { sessionId: childSessionId, streamIndex: 0 },
    reducer,
    resume: true,
  });
  let progress: string | null = null;
  for (let index = child.events.length - 1; index >= 0; index -= 1) {
    progress = childProgressLabel(
      child.events[index] as Parameters<typeof childProgressLabel>[0],
    );
    if (progress) break;
  }
  return (
    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
      {progress ?? fallback}
    </p>
  );
}

/** The child session's own steps, read from the child stream. */
function AgentSubagentTimeline({
  childSessionId,
  fallback,
}: {
  childSessionId: string;
  fallback: string;
}) {
  const [reducer] = useState(agentTranscriptReducer);
  // Parameterized explicitly: the transcript projection is assignable to
  // `EveMessageData`, so the untyped overload would otherwise win and hide the
  // step and usage fields this panel reads.
  const child = useEveAgent<AgentTranscriptData>({
    initialSession: { sessionId: childSessionId, streamIndex: 0 },
    reducer,
    resume: true,
  });
  const steps = child.data.turns.flatMap((turn) => turn.steps);
  const text = child.data.messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.parts)
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  const tools = child.data.messages
    .flatMap((message) => message.parts)
    .filter((part) => part.type === "dynamic-tool");

  if (child.status === "resuming") {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
        Loading the specialist&rsquo;s work…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {tools.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {tools.map((tool) => (
            <li
              className="flex items-center gap-2 text-xs text-foreground/80"
              key={tool.toolCallId}
            >
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  tool.state === "output-error"
                    || tool.state === "output-denied"
                    ? "bg-destructive"
                    : tool.state === "output-available"
                      ? "bg-emerald-600"
                      : "animate-pulse bg-blue-500",
                )}
              />
              <span className="truncate">{humanize(tool.toolName)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {steps.length > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {steps.length} {steps.length === 1 ? "model step" : "model steps"}
          {child.data.usage.inputTokens > 0
            ? ` · ${child.data.usage.inputTokens.toLocaleString("en-AU")} input tokens`
            : ""}
        </p>
      ) : null}
      <p className="whitespace-pre-wrap text-xs text-foreground/80">
        {text || fallback}
      </p>
      {child.error ? (
        <p className="text-xs text-amber-700">
          Live progress is reconnecting; the specialist is still running.
        </p>
      ) : null}
    </div>
  );
}

function StatusChip({
  duration,
  status,
}: {
  duration: string | null;
  status: AgentSubagentRun["status"];
}) {
  const live = isLive(status);
  const Icon =
    status === "failed"
      ? CircleX
      : status === "completed"
        ? CheckCircle2
        : status === "interrupted"
          ? CircleMinus
          : status === "requested"
            ? CircleDashed
            : LoaderCircle;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] font-medium",
        status === "failed"
          ? "text-destructive"
          : status === "completed"
            ? "text-emerald-700"
            : status === "interrupted"
              ? "text-muted-foreground"
              : "text-blue-700",
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("size-3.5", status === "working" && "animate-spin")}
      />
      {statusLabel(status)}
      {duration && !live ? ` · ${duration}` : ""}
    </span>
  );
}

function statusLabel(status: AgentSubagentRun["status"]) {
  const labels: Record<AgentSubagentRun["status"], string> = {
    completed: "Complete",
    delegating: "Starting",
    failed: "Needs attention",
    interrupted: "Did not report",
    requested: "Queued",
    working: "Working",
  };
  return labels[status];
}

function isLive(status: AgentSubagentRun["status"]) {
  return (
    status === "requested" || status === "delegating" || status === "working"
  );
}
