"use client";

import type { RefObject } from "react";
import {
  Bot,
  CheckCircle2,
  Gauge,
  Layers,
  PanelRightClose,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatCost,
  formatDuration,
  formatTokens,
  humanize,
} from "@/components/agent/agent-format";
import type { AgentTranscriptData } from "@/components/agent/agent-reducer";
import { OPERATIONS_SESSION_LIMITS } from "@/lib/agent/session-limits";
import { cn } from "@/lib/utils";

/**
 * What the agent needs from a person, and what it is spending.
 *
 * These three things were previously discoverable only by scrolling the
 * transcript: an approval that moved out of view left the session parked with
 * nothing on screen, a running specialist was a card somewhere above, and the
 * budget was a tooltip in the header. With two or three people sharing a login
 * and nobody watching the runtime, a blocked session has to be visible from
 * wherever the operator happens to be looking.
 */
export function AgentInspector({
  data,
  onClose,
  viewportRef,
}: {
  data: AgentTranscriptData;
  onClose: () => void;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const running = data.subagents.filter(
    (run) =>
      run.status === "requested"
      || run.status === "delegating"
      || run.status === "working",
  );
  const finished = data.subagents.filter(
    (run) => run.status === "completed" || run.status === "failed",
  );

  function scrollTo(requestId: string) {
    viewportRef.current
      ?.querySelector(`[data-approval-id="${CSS.escape(requestId)}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <aside
      aria-label="Session inspector"
      className="flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-border/70 bg-muted/20"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2.5">
        <p className="font-heading text-sm font-semibold text-foreground">
          This session
        </p>
        <Button
          aria-label="Hide the session inspector"
          onClick={onClose}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <PanelRightClose />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-3">
        <Section
          count={data.pendingApprovals.length}
          icon={ShieldAlert}
          title="Needs you"
          urgent={data.pendingApprovals.length > 0}
        >
          {data.pendingApprovals.length === 0 ? (
            <Quiet icon={CheckCircle2}>Nothing is waiting on you.</Quiet>
          ) : (
            data.pendingApprovals.map((approval) => (
              <button
                className="w-full rounded-lg border border-royal-gold/50 bg-royal-gold-light/50 px-2.5 py-2 text-left transition-colors hover:bg-royal-gold-light"
                key={approval.requestId}
                onClick={() => scrollTo(approval.requestId)}
                type="button"
              >
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  {approval.kind === "tool-approval"
                    ? "Approval"
                    : approval.kind === "session-limit"
                      ? "Session limit"
                      : "Question"}
                </p>
                <p className="text-sm font-medium text-foreground">
                  {data.labels[approval.callId] ?? humanize(approval.toolName)}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {approval.prompt}
                </p>
                <span className="mt-1 inline-block text-[11px] font-medium text-royal-gold-ink">
                  Review in the transcript →
                </span>
              </button>
            ))
          )}
        </Section>

        <Section count={running.length} icon={Bot} title="Specialists">
          {data.subagents.length === 0 ? (
            <Quiet icon={Bot}>No work has been delegated yet.</Quiet>
          ) : (
            <>
              {running.map((run) => (
                <div
                  className="flex items-center gap-2 rounded-lg border border-blue-200/80 bg-blue-50/60 px-2.5 py-2 text-xs"
                  key={run.callId}
                >
                  <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-blue-500" />
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {humanize(run.name || run.toolName || "Specialist")}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {run.status === "working" ? "working" : "starting"}
                  </span>
                </div>
              ))}
              {finished.map((run) => (
                <div
                  className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/70 px-2.5 py-2 text-xs"
                  key={run.callId}
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      run.status === "failed"
                        ? "bg-destructive"
                        : "bg-emerald-600",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-foreground/85">
                    {humanize(run.name || run.toolName || "Specialist")}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatDuration(run.startedAt, run.endedAt)
                      ?? (run.status === "failed" ? "failed" : "done")}
                  </span>
                </div>
              ))}
            </>
          )}
        </Section>

        <Section icon={Gauge} title="Budget">
          <Meter
            label="Cost"
            limit={OPERATIONS_SESSION_LIMITS.maxTokenCostUsdPerSession}
            render={formatCost}
            value={data.usage.costUsd}
          />
          <Meter
            label="Input"
            limit={OPERATIONS_SESSION_LIMITS.maxInputTokensPerSession}
            render={formatTokens}
            value={data.usage.inputTokens}
          />
          <Meter
            label="Output"
            limit={OPERATIONS_SESSION_LIMITS.maxOutputTokensPerSession}
            render={formatTokens}
            value={data.usage.outputTokens}
          />
          <p className="text-[11px] text-muted-foreground">
            {data.usage.steps} model {data.usage.steps === 1 ? "step" : "steps"}{" "}
            so far. The runtime stops this session at its ceiling — start a new
            conversation before then.
          </p>
        </Section>

        {data.compaction ? (
          <Section icon={Layers} title="Context">
            <p className="text-xs text-muted-foreground">
              {data.compaction.status === "requested"
                ? "Summarising earlier messages to make room."
                : "Earlier messages were summarised to make room. Nothing is lost from the record."}
            </p>
          </Section>
        ) : null}
      </div>
    </aside>
  );
}

function Section({
  children,
  count,
  icon: Icon,
  title,
  urgent,
}: {
  children: React.ReactNode;
  count?: number;
  icon: typeof Bot;
  title: string;
  urgent?: boolean;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        <Icon
          aria-hidden="true"
          className={cn("size-3.5", urgent && "text-royal-gold-ink")}
        />
        {title}
        {count ? (
          <span
            className={cn(
              "ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
              urgent
                ? "bg-royal-gold text-royal-gold-ink"
                : "bg-muted text-muted-foreground",
            )}
          >
            {count}
          </span>
        ) : null}
      </h2>
      {children}
    </section>
  );
}

function Quiet({
  children,
  icon: Icon,
}: {
  children: React.ReactNode;
  icon: typeof Bot;
}) {
  return (
    <p className="flex items-center gap-2 rounded-lg border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground">
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {children}
    </p>
  );
}

function Meter({
  label,
  limit,
  render,
  value,
}: {
  label: string;
  limit: number;
  render: (value: number) => string;
  value: number;
}) {
  const ratio = limit === 0 ? 0 : Math.min(1, value / limit);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">
          {render(value)}{" "}
          <span className="font-normal text-muted-foreground">
            / {render(limit)}
          </span>
        </span>
      </div>
      <span className="block h-1 overflow-hidden rounded-full bg-muted">
        <span
          className={cn(
            "block h-full rounded-full transition-[width]",
            ratio >= 0.9
              ? "bg-destructive"
              : ratio >= 0.6
                ? "bg-royal-gold"
                : "bg-emerald-600",
          )}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </span>
    </div>
  );
}
