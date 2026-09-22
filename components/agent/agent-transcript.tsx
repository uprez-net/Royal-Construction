"use client";

import type { EveMessage, UseEveAgentStatus } from "eve/react";
import {
  ArrowDown,
  Bot,
  CircleStop,
  GitFork,
  Layers,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
} from "lucide-react";
import type { RefObject } from "react";
import { useMemo } from "react";
import { AgentApprovalBar } from "@/components/agent/agent-approval-bar";
import type { AgentInputResponse } from "@/components/agent/agent-approval";
import { AgentMessage } from "@/components/agent/agent-message";
import type {
  AgentPendingApproval,
  AgentSubagentRun,
  AgentTranscriptData,
  AgentTurn,
} from "@/components/agent/agent-reducer";
import type { AgentResultAction } from "@/components/agent/agent-result";
import { AgentSessionMeter } from "@/components/agent/agent-session-meter";
import type { AgentAnnotation } from "@/components/agent/agent-annotations";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Find the latest offer for a client",
  "Show the revision history for an offer",
  "Find a lead and list their open tasks",
] as const;

export function AgentTranscript({
  agentError,
  agentStatus,
  archiveError,
  busy,
  data,
  forkConversation,
  handleMessageScroll,
  historyOpen,
  messageAnnotations,
  onAction,
  onCancel,
  onEditMessage,
  onRespond,
  onRetry,
  onSuggestion,
  onToggleHistory,
  pendingMessageAnnotations,
  scrollToBottom,
  sendError,
  showScrollToBottom,
  statusLabel,
  viewportRef,
}: {
  agentError: Error | null;
  agentStatus: UseEveAgentStatus;
  archiveError: string | null;
  busy: boolean;
  data: AgentTranscriptData;
  forkConversation: () => void;
  handleMessageScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  historyOpen: boolean;
  messageAnnotations: Record<string, AgentAnnotation[]>;
  onAction: (action: AgentResultAction) => Promise<void>;
  onCancel: () => void;
  onEditMessage: (messageId: string, text: string) => void;
  onRespond: (responses: readonly AgentInputResponse[]) => Promise<void>;
  onRetry: () => void;
  onSuggestion: (suggestion: string) => void;
  onToggleHistory: () => void;
  pendingMessageAnnotations: AgentAnnotation[] | null;
  scrollToBottom: () => void;
  sendError: string | null;
  showScrollToBottom: boolean;
  statusLabel: string;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const turnsById = useMemo(
    () => new Map(data.turns.map((turn) => [turn.turnId, turn])),
    [data.turns],
  );
  const subagentsByTurn = useMemo(() => {
    const map = new Map<string, AgentSubagentRun[]>();
    for (const run of data.subagents) {
      if (!run.turnId) continue;
      const runs = map.get(run.turnId);
      if (runs) runs.push(run);
      else map.set(run.turnId, [run]);
    }
    return map;
  }, [data.subagents]);

  return (
    <div className="order-1 grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden md:order-2">
      <header className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            aria-controls="agent-conversation-history"
            aria-expanded={historyOpen}
            aria-label={
              historyOpen
                ? "Collapse conversation history"
                : "Expand conversation history"
            }
            onClick={onToggleHistory}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            {historyOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-royal-gold-light text-royal-gold-ink">
            <Bot aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="font-heading truncate text-base font-semibold text-foreground sm:text-lg">
              Operations desk
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              Leads, offers and controlled business actions
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AgentSessionMeter usage={data.usage} />
          <Badge variant="outline">
            <span
              className={cn(
                "size-1.5 rounded-full",
                busy
                  ? "animate-pulse bg-royal-gold"
                  : agentStatus === "error"
                    ? "bg-destructive"
                    : "bg-emerald-600",
              )}
            />
            {statusLabel}
          </Badge>
          {busy ? (
            <Button
              onClick={onCancel}
              size="sm"
              type="button"
              variant="outline"
            >
              <CircleStop data-icon="inline-start" />
              <span className="hidden sm:inline">Stop</span>
            </Button>
          ) : null}
          {data.messages.length > 0 ? (
            <Button
              aria-label="Fork conversation"
              onClick={forkConversation}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <GitFork />
            </Button>
          ) : null}
        </div>
      </header>

      <div className="relative min-h-0 overflow-hidden">
        <div
          className="absolute inset-0 overflow-y-auto overscroll-contain"
          onScroll={handleMessageScroll}
          ref={viewportRef}
        >
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
            {data.messages.length === 0 && agentStatus !== "resuming" ? (
              <Empty className="min-h-96 border-0">
                <EmptyHeader>
                  <EmptyMedia
                    className="size-12 rounded-xl bg-royal-gold-light text-royal-gold-ink"
                    variant="icon"
                  >
                    <Sparkles aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle className="text-xl">
                    What needs moving today?
                  </EmptyTitle>
                  <EmptyDescription>
                    Ask for a live business lookup. The agent will show the
                    exact target and ask before any controlled action.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent className="max-w-xl sm:grid sm:grid-cols-3">
                  {SUGGESTIONS.map((suggestion) => (
                    <Button
                      className="h-auto min-h-16 w-full justify-start whitespace-normal px-3 py-2 text-left"
                      key={suggestion}
                      onClick={() => onSuggestion(suggestion)}
                      type="button"
                      variant="outline"
                    >
                      {suggestion}
                    </Button>
                  ))}
                </EmptyContent>
              </Empty>
            ) : null}

            {agentStatus === "resuming" ? (
              <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-muted-foreground">
                <span className="size-2 animate-pulse rounded-full bg-royal-gold" />
                Restoring conversation…
              </div>
            ) : null}

            {data.messages.map((message) => {
              const turnId = message.metadata?.turnId;
              const turn = turnId ? turnsById.get(turnId) : undefined;
              return (
                <div className="flex flex-col gap-3" key={message.id}>
                  <AgentMessage
                    annotations={
                      messageAnnotations[message.id]
                      ?? (message.metadata?.optimistic
                        ? (pendingMessageAnnotations ?? undefined)
                        : undefined)
                    }
                    canRespond={!busy}
                    isStreaming={agentStatus === "streaming"}
                    labels={data.labels}
                    message={message}
                    onAction={onAction}
                    onEditMessage={onEditMessage}
                    onInputResponses={onRespond}
                    subagents={
                      message.role === "assistant" && turnId
                        ? (subagentsByTurn.get(turnId) ?? [])
                        : []
                    }
                    timestamp={messageTime(message, turn)}
                    toolTimes={toolTimes(turn)}
                  />
                  {message.role === "assistant" ? (
                    <TurnOutcome turn={turn} />
                  ) : null}
                </div>
              );
            })}

            {data.compaction?.status === "requested" ? (
              <p className="flex items-center gap-2 self-start rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <Layers aria-hidden="true" className="size-3.5" />
                Summarising earlier messages to make room — nothing is lost from
                the record.
              </p>
            ) : null}

            {agentStatus === "streaming" ? (
              <div className="flex items-center gap-2 self-start rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin" />
                Live response · assembling the next operation step…
              </div>
            ) : null}

            {agentError ? (
              <Alert variant="destructive">
                <AlertTitle>The agent could not continue</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center gap-3">
                  <span>{agentError.message}</span>
                  <Button
                    onClick={onRetry}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Reconnect
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            {sendError ? (
              <Alert variant="destructive">
                <AlertTitle>The message could not be sent</AlertTitle>
                <AlertDescription>{sendError}</AlertDescription>
              </Alert>
            ) : null}

            {archiveError ? (
              <Alert variant="destructive">
                <AlertTitle>The conversation could not be archived</AlertTitle>
                <AlertDescription>{archiveError}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </div>

        <AgentApprovalBar
          approvals={data.pendingApprovals}
          viewportRef={viewportRef}
        />

        {showScrollToBottom ? (
          <Button
            aria-label="Scroll to the latest message"
            className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border-border/80 bg-white/95 text-foreground shadow-lg backdrop-blur transition hover:-translate-y-0.5 hover:bg-royal-gold-light"
            onClick={scrollToBottom}
            size="icon-sm"
            title="Scroll to latest message"
            type="button"
            variant="outline"
          >
            <ArrowDown aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A turn that ended without an answer.
 *
 * A cancelled turn is not a failure and is labelled as such, so an operator who
 * pressed Stop is not left wondering whether something broke.
 */
function TurnOutcome({ turn }: { turn: AgentTurn | undefined }) {
  if (!turn || turn.status === "running" || turn.status === "completed")
    return null;
  if (turn.status === "cancelled") {
    return (
      <p className="self-start rounded-lg border border-border/60 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
        You stopped this response. The conversation is ready to continue.
      </p>
    );
  }
  return (
    <Alert variant="destructive">
      <AlertTitle>This request did not finish</AlertTitle>
      <AlertDescription>
        {turn.failure?.message ?? "The turn ended before it produced a result."}
      </AlertDescription>
    </Alert>
  );
}

function messageTime(message: EveMessage, turn: AgentTurn | undefined) {
  if (!turn) return null;
  return message.role === "user" ? turn.startedAt : (turn.endedAt ?? null);
}

/**
 * The window each step's tool calls ran in.
 *
 * Tools execute between one model step finishing and the next one starting, so
 * that gap — not the step itself — is the duration worth showing.
 */
function toolTimes(turn: AgentTurn | undefined) {
  if (!turn) return {};
  const times: Record<
    number,
    { startedAt: string | null; endedAt: string | null }
  > = {};
  turn.steps.forEach((step, index) => {
    times[step.stepIndex] = {
      endedAt: turn.steps[index + 1]?.startedAt ?? turn.endedAt,
      startedAt: step.endedAt,
    };
  });
  return times;
}

export type { AgentPendingApproval };
