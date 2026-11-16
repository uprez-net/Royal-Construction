"use client";

import { Gauge } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AgentSessionUsage } from "@/components/agent/agent-reducer";
import { formatCost, formatTokens } from "@/components/agent/agent-format";
import { OPERATIONS_SESSION_LIMITS } from "@/lib/agent/session-limits";
import { cn } from "@/lib/utils";

/**
 * How much of the session's ceiling this conversation has spent.
 *
 * The runtime stops a session that exceeds its input-token, output-token or
 * cost limit. Without this, the first sign is the agent refusing mid-task with
 * a limit prompt, which reads like a fault rather than a budget. Shown once the
 * conversation is past a quarter of any ceiling, so an ordinary lookup keeps a
 * clean header.
 */
export function AgentSessionMeter({ usage }: { usage: AgentSessionUsage }) {
  const ratios = {
    cost: usage.costUsd / OPERATIONS_SESSION_LIMITS.maxTokenCostUsdPerSession,
    input:
      usage.inputTokens / OPERATIONS_SESSION_LIMITS.maxInputTokensPerSession,
    output:
      usage.outputTokens / OPERATIONS_SESSION_LIMITS.maxOutputTokensPerSession,
  };
  const highest = Math.max(ratios.cost, ratios.input, ratios.output);
  if (usage.steps === 0 || highest < 0.25) return null;
  const percent = Math.min(100, Math.round(highest * 100));

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={`Session budget ${percent}% used`}
          className="hidden items-center gap-1.5 rounded-full border border-border/70 px-2 py-1 text-[11px] text-muted-foreground sm:inline-flex"
        >
          <Gauge
            aria-hidden="true"
            className={cn(
              "size-3.5",
              highest >= 0.9
                ? "text-destructive"
                : highest >= 0.6
                  ? "text-warning-ink"
                  : "text-muted-foreground",
            )}
          />
          <span
            aria-hidden="true"
            className="h-1 w-12 overflow-hidden rounded-full bg-muted"
          >
            <span
              className={cn(
                "block h-full rounded-full transition-[width]",
                highest >= 0.9
                  ? "bg-destructive"
                  : highest >= 0.6
                    ? "bg-warning"
                    : "bg-success",
              )}
              style={{ width: `${percent}%` }}
            />
          </span>
          {percent}%
        </span>
      </TooltipTrigger>
      <TooltipContent className="text-xs">
        <p className="font-medium">Session budget</p>
        <p>
          Cost {formatCost(usage.costUsd)} of{" "}
          {formatCost(OPERATIONS_SESSION_LIMITS.maxTokenCostUsdPerSession)}
        </p>
        <p>
          Input {formatTokens(usage.inputTokens)} of{" "}
          {formatTokens(OPERATIONS_SESSION_LIMITS.maxInputTokensPerSession)}{" "}
          tokens
        </p>
        <p>
          Output {formatTokens(usage.outputTokens)} of{" "}
          {formatTokens(OPERATIONS_SESSION_LIMITS.maxOutputTokensPerSession)}{" "}
          tokens
        </p>
        <p className="mt-1 text-muted-foreground">
          Start a new conversation before this runs out.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
