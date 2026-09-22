"use client";

import { useEveAgent } from "eve/react";
import type { MessageStreamEvent } from "eve/client";
import {
  Bot,
  CheckCircle2,
  CircleDashed,
  CircleX,
  LoaderCircle,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

export type AgentSubagentActivityRecord = {
  callId: string;
  childSessionId: string;
  name: string;
  toolName: string;
  status: "delegating" | "working" | "completed" | "failed";
  taskId?: string;
  summary?: string;
  progressLabel?: string;
  remote?: boolean;
};

export function AgentSubagentActivity({
  activity,
}: {
  activity: AgentSubagentActivityRecord;
}) {
  const childAgent = useEveAgent({
    initialSession: activity.remote
      ? undefined
      : { sessionId: activity.childSessionId, streamIndex: 0 },
    resume: !activity.remote,
  });
  const childProgress = useMemo(
    () => getLatestChildProgress(childAgent.events),
    [childAgent.events],
  );
  const isComplete = activity.status === "completed";
  const isFailed = activity.status === "failed";
  const isLive = !isComplete && !isFailed;
  const Icon = isFailed
    ? CircleX
    : isComplete
      ? CheckCircle2
      : activity.status === "delegating"
        ? CircleDashed
        : LoaderCircle;
  const progress =
    activity.summary
    ?? childProgress.label
    ?? activity.progressLabel
    ?? (activity.status === "delegating"
      ? "Preparing the specialist"
      : "Working in a separate session");

  return (
    <article
      aria-live={isLive ? "polite" : undefined}
      className={cn(
        "rounded-xl border px-3 py-3 shadow-xs transition-colors",
        isFailed
          ? "border-destructive/30 bg-destructive/5"
          : isComplete
            ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/20"
            : "border-blue-200/80 bg-blue-50/60 dark:border-blue-900/60 dark:bg-blue-950/20",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg",
            isFailed
              ? "bg-destructive/10 text-destructive"
              : isComplete
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                : "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
          )}
        >
          <Bot aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="text-sm font-medium text-foreground">
              {activity.name}
            </p>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-[11px] font-medium",
                isFailed
                  ? "text-destructive"
                  : isComplete
                    ? "text-emerald-700 dark:text-emerald-300"
                    : "text-blue-700 dark:text-blue-300",
              )}
            >
              <Icon
                aria-hidden="true"
                className={cn("size-3.5", isLive && "animate-spin")}
              />
              {subagentStatusLabel(activity.status)}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Delegated specialist · {toolLabel(activity.toolName)}
          </p>
          <div className="mt-2 flex items-start gap-2 rounded-lg bg-background/70 px-2.5 py-2 text-xs text-foreground/80">
            {childProgress.kind === "tool" ? (
              <Wrench
                aria-hidden="true"
                className="mt-0.5 size-3.5 shrink-0 text-blue-600"
              />
            ) : (
              <Sparkles
                aria-hidden="true"
                className="mt-0.5 size-3.5 shrink-0 text-blue-600"
              />
            )}
            <span className="line-clamp-3 whitespace-pre-wrap">{progress}</span>
          </div>
          {childAgent.error && isLive ? (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              Live progress is reconnecting; the specialist is still running.
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function subagentStatusLabel(status: AgentSubagentActivityRecord["status"]) {
  if (status === "delegating") return "Starting";
  if (status === "completed") return "Complete";
  if (status === "failed") return "Needs attention";
  return "Working";
}

function toolLabel(toolName: string) {
  return toolName
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getLatestChildProgress(events: readonly MessageStreamEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    switch (event.type) {
      case "message.completed":
        if (event.data.message?.trim()) {
          return { kind: "message" as const, label: event.data.message.trim() };
        }
        break;
      case "message.appended":
        if (event.data.messageDelta.trim()) {
          return {
            kind: "message" as const,
            label: event.data.messageDelta.trim(),
          };
        }
        break;
      case "actions.requested": {
        const names = event.data.actions
          .map((action) =>
            action.kind === "tool-call" || action.kind === "workflow-tool-call"
              ? action.toolName
              : action.kind === "subagent-call"
                  || action.kind === "remote-agent-call"
                ? action.name
                : action.kind,
          )
          .filter(Boolean)
          .join(", ");
        if (names) return { kind: "tool" as const, label: `Running ${names}` };
        break;
      }
      case "action.input.appended":
        return {
          kind: "tool" as const,
          label: `Preparing ${toolLabel(event.data.toolName)}`,
        };
      case "action.result":
        return {
          kind: "tool" as const,
          label:
            event.data.status === "failed"
              ? "A specialist action failed"
              : "Action completed",
        };
      case "session.completed":
        return {
          kind: "message" as const,
          label: "Specialist session completed",
        };
      case "session.failed":
        return { kind: "message" as const, label: "Specialist session failed" };
      default:
        break;
    }
  }
  return { kind: "message" as const, label: null };
}
