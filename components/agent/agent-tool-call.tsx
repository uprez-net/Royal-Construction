"use client";

import { useState } from "react";
import type { EveDynamicToolPart } from "eve/react";
import {
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  LoaderCircle,
  ShieldCheck,
  Wrench,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AgentApproval,
  type AgentInputResponse,
} from "@/components/agent/agent-approval";
import {
  formatDuration,
  humanize,
  toInputFields,
} from "@/components/agent/agent-format";
import {
  AgentResult,
  resultEnvelope,
  type AgentResultAction,
} from "@/components/agent/agent-result";
import { cn } from "@/lib/utils";

/**
 * One operation the agent ran, from the first streamed argument to the result.
 *
 * The header carries the tool's authored `label.start` when the runtime sent
 * one, so the operator reads "Send builder outreach" rather than the tool's
 * function name. Arguments stay collapsed for an ordinary lookup and open
 * automatically once something has gone wrong or is waiting on a person.
 */
export function AgentToolCall({
  canRespond,
  label,
  onAction,
  onRespond,
  part,
  startedAt,
  endedAt,
}: {
  canRespond: boolean;
  label: string | undefined;
  onAction: (action: AgentResultAction) => Promise<void>;
  onRespond: (responses: readonly AgentInputResponse[]) => Promise<void>;
  part: EveDynamicToolPart;
  startedAt: string | null;
  endedAt: string | null;
}) {
  const request = part.toolMetadata?.eve?.inputRequest;
  const responded = part.toolMetadata?.eve?.inputResponse !== undefined;
  const awaitingApproval = part.state === "approval-requested" && !responded;
  const failed =
    part.state === "output-error" || part.state === "output-denied";
  const complete = part.state === "output-available";
  const partial = part.state === "output-available" && part.partial === true;
  const running =
    part.state === "input-streaming"
    || part.state === "input-available"
    || partial;
  const [open, setOpen] = useState(false);

  const title = label ?? humanize(part.toolName);
  const fields = toInputFields("input" in part ? part.input : undefined);
  const result = complete ? resultEnvelope(part.output) : null;
  const duration = formatDuration(startedAt, endedAt);
  const Icon = failed
    ? XCircle
    : complete && !partial
      ? CheckCircle2
      : awaitingApproval
        ? ShieldCheck
        : running
          ? LoaderCircle
          : CircleDashed;

  return (
    <article
      // What the inspector's "Review in the transcript" link and the approval
      // bar scroll to. Without it both looked for an element that never existed.
      data-approval-id={request?.requestId}
      className={cn(
        "overflow-hidden rounded-xl border",
        failed
          ? "border-destructive/35 bg-destructive/5"
          : awaitingApproval
            ? "border-royal-gold/45 bg-royal-gold-light/25"
            : "border-border/70 bg-muted/25",
      )}
    >
      <header className="flex items-center gap-2.5 px-3 py-2.5">
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-md bg-background",
            failed
              ? "text-destructive"
              : complete && !partial
                ? "text-emerald-600"
                : "text-muted-foreground",
          )}
        >
          <Icon
            aria-hidden="true"
            className={cn("size-4", running && "animate-spin")}
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {title}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {toolStateLabel(part.state, partial, responded)}
            {duration ? ` · ${duration}` : ""}
          </p>
        </div>
        <Badge
          variant={failed ? "destructive" : complete ? "secondary" : "outline"}
        >
          <Wrench data-icon="inline-start" />
          Operation
        </Badge>
      </header>

      {part.state === "input-streaming" && part.inputText ? (
        <p className="truncate border-t border-border/60 px-3 py-2 font-mono text-[11px] text-muted-foreground">
          {part.inputText.slice(-160)}
        </p>
      ) : null}

      {fields.length > 0 && !awaitingApproval ? (
        <Collapsible onOpenChange={setOpen} open={open}>
          <CollapsibleTrigger className="flex w-full items-center gap-2 border-t border-border/60 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground">
            <span>
              {fields.length} {fields.length === 1 ? "argument" : "arguments"}
            </span>
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "ml-auto size-3.5 transition-transform",
                open && "rotate-180",
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <dl className="flex flex-col gap-1.5 border-t border-border/60 bg-background/60 px-3 py-2.5">
              {fields.map((field) => (
                <div
                  className="flex flex-wrap items-baseline gap-x-2"
                  key={field.key}
                >
                  <dt className="min-w-28 shrink-0 text-xs text-muted-foreground">
                    {field.label}
                  </dt>
                  <dd
                    className={cn(
                      "min-w-0 flex-1 text-xs text-foreground/85",
                      field.prose
                        ? "max-h-32 overflow-y-auto whitespace-pre-wrap"
                        : "wrap-break-word",
                    )}
                  >
                    {field.value}
                  </dd>
                </div>
              ))}
            </dl>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {request ? (
        <div className="border-t border-border/60 p-2.5">
          <AgentApproval
            canRespond={canRespond}
            input={"input" in part ? part.input : undefined}
            label={title}
            onRespond={onRespond}
            request={request}
            responded={responded || part.state !== "approval-requested"}
          />
        </div>
      ) : null}

      {result ? (
        <div className="border-t border-border/60 px-3 py-2.5">
          <AgentResult
            canRespond={canRespond}
            onAction={onAction}
            partial={partial}
            result={result}
          />
        </div>
      ) : null}

      {part.state === "output-error" ? (
        <p className="border-t border-border/60 px-3 py-2.5 text-sm text-destructive">
          {part.errorText}
        </p>
      ) : null}

      {part.state === "output-denied" ? (
        <p className="border-t border-border/60 px-3 py-2.5 text-sm text-muted-foreground">
          {part.approval.reason
            ?? "You declined this operation. Nothing was changed."}
        </p>
      ) : null}
    </article>
  );
}

function toolStateLabel(
  state: EveDynamicToolPart["state"],
  partial: boolean,
  responded: boolean,
) {
  if (partial) return "Streaming a result";
  switch (state) {
    case "approval-requested":
      return responded ? "Approval recorded" : "Waiting for your approval";
    case "approval-responded":
      return "Approval recorded · running";
    case "input-available":
    case "input-streaming":
      return "Preparing the operation";
    case "output-available":
      return "Completed";
    case "output-denied":
      return "Declined";
    case "output-error":
      return "Could not complete";
  }
}
