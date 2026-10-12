"use client";

import type { UseEveAgentStatus } from "eve/react";
import {
  Bot,
  CircleStop,
  GitFork,
  PanelLeft,
  PanelRight,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentSessionMeter } from "@/components/agent/agent-session-meter";
import type { AgentSessionUsage } from "@/components/agent/agent-reducer";
import { cn } from "@/lib/utils";

/**
 * The workspace's one top bar, spanning every pane.
 *
 * It previously lived inside the transcript column, which put the session's
 * status and budget above the messages rather than above the workspace, and
 * left no room for the inspector's controls.
 */
export function AgentHeader({
  agentStatus,
  busy,
  canFork,
  historyOpen,
  inspectorOpen,
  onCancel,
  onFork,
  onToggleHistory,
  onToggleInspector,
  pendingCount,
  sessionTitle,
  statusLabel,
  usage,
}: {
  agentStatus: UseEveAgentStatus;
  busy: boolean;
  canFork: boolean;
  historyOpen: boolean;
  inspectorOpen: boolean;
  onCancel: () => void;
  onFork: () => void;
  onToggleHistory: () => void;
  onToggleInspector: () => void;
  pendingCount: number;
  sessionTitle: string;
  statusLabel: string;
  usage: AgentSessionUsage;
}) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-border/70 bg-white px-3 py-2.5 sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <Button
          aria-controls="agent-conversation-history"
          aria-expanded={historyOpen}
          aria-label={
            historyOpen
              ? "Hide conversation history"
              : "Show conversation history"
          }
          onClick={onToggleHistory}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <PanelLeft />
        </Button>
        <span className="hidden size-8 shrink-0 place-items-center rounded-lg bg-royal-gold-light text-royal-gold-ink sm:grid">
          <Bot aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0">
          <h1 className="font-heading text-sm font-semibold leading-tight text-foreground sm:truncate sm:text-base">
            Operations desk
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {sessionTitle}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <AgentSessionMeter usage={usage} />
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
          <span className="sr-only sm:not-sr-only">{statusLabel}</span>
        </Badge>
        {busy ? (
          <Button onClick={onCancel} size="sm" type="button" variant="outline">
            <CircleStop data-icon="inline-start" />
            <span className="hidden sm:inline">Stop</span>
          </Button>
        ) : null}
        {canFork ? (
          <Button
            aria-label="Fork this conversation"
            onClick={onFork}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <GitFork />
          </Button>
        ) : null}
        <Button
          aria-expanded={inspectorOpen}
          aria-label={
            pendingCount > 0
              ? `Session inspector, ${pendingCount} waiting on you`
              : "Toggle the session inspector"
          }
          className="relative"
          onClick={onToggleInspector}
          size="icon-sm"
          type="button"
          variant={pendingCount > 0 ? "default" : "ghost"}
        >
          {pendingCount > 0 ? <ShieldAlert /> : <PanelRight />}
          {pendingCount > 0 ? (
            <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-destructive text-[10px] font-semibold text-white">
              {pendingCount}
            </span>
          ) : null}
        </Button>
      </div>
    </header>
  );
}
