"use client";

import { useState } from "react";
import type { EveDynamicToolPart } from "eve/react";
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  LoaderCircle,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AgentApproval,
  type AgentInputResponse,
} from "@/components/agent/agent-approval";
import { useApprovalBatch } from "@/components/agent/agent-approval-batch";
import {
  formatDuration,
  humanize,
  toolOutcome,
  toInputFields,
} from "@/components/agent/agent-format";
import {
  AgentResult,
  resultEnvelope,
  type AgentResultAction,
} from "@/components/agent/agent-result";
import { cn } from "@/lib/utils";

/** Tools whose arguments are routing for the agent, not a change to review. */
const INTERNAL_ARGUMENT_TOOLS: ReadonlySet<string> = new Set([
  "delegate",
  "recall_crm_context",
]);

/** Framework tools with no authored label, named for the office. */
const TOOL_TITLES: Readonly<Record<string, string>> = {
  ask_question: "Question for you",
};

const SPECIALIST_NAMES: Readonly<Record<string, string>> = {
  "admin-operations": "admin",
  "compliance-operations": "compliance",
  "lead-operations": "lead",
  "offer-operations": "offer",
  "project-operations": "project",
  "tradie-operations": "tradie",
};

/**
 * "Asking the lead and project specialists": what a `delegate` card is doing,
 * read from its own arguments. "Delegate" told the office nothing (#432).
 */
export function delegateTitle(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const value = input as { specialist?: unknown; tasks?: unknown };
  const names = (
    Array.isArray(value.tasks)
      ? value.tasks.map((task) =>
          task && typeof task === "object"
            ? (task as { specialist?: unknown }).specialist
            : undefined,
        )
      : [value.specialist]
  )
    .filter((name): name is string => typeof name === "string")
    .map((name) => SPECIALIST_NAMES[name] ?? humanize(name).toLowerCase());
  const unique = [...new Set(names)];
  if (unique.length === 0) return null;
  const list =
    unique.length === 1
      ? unique[0]
      : `${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
  return `Asking the ${list} specialist${unique.length === 1 ? "" : "s"}`;
}

/**
 * eve's own wording for a call that never ran because the person said no, or
 * the turn was stopped. Shown as what happened, in the word on the button.
 */
const SYSTEM_CANCEL_TEXT = /^tool execution was (cancelled|canceled|denied)/i;

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
  working,
}: {
  canRespond: boolean;
  label: string | undefined;
  onAction: (action: AgentResultAction) => Promise<void>;
  onRespond: (responses: readonly AgentInputResponse[]) => Promise<void>;
  part: EveDynamicToolPart;
  startedAt: string | null;
  endedAt: string | null;
  /** The agent is still working on this message's turn. */
  working: boolean;
}) {
  const request = part.toolMetadata?.eve?.inputRequest;
  const response = part.toolMetadata?.eve?.inputResponse;
  const responded = response !== undefined;
  // The button the person pressed was the danger option: Cancel.
  const cancelledByPerson =
    part.state === "output-denied"
    || (responded
      && request?.options?.find((option) => option.id === response.optionId)
        ?.style === "danger");
  const cancelledText =
    part.state === "output-error" && SYSTEM_CANCEL_TEXT.test(part.errorText);
  const cancelled = cancelledByPerson || cancelledText;
  // Approved, then stopped while it ran: something may already be written.
  const interrupted =
    part.state === "output-error" && part.approval?.approved === true;
  const awaitingApproval = part.state === "approval-requested" && !responded;
  const complete = part.state === "output-available";
  const partial = part.state === "output-available" && part.partial === true;
  // Completed on the wire, but the result itself says it failed.
  const outcome =
    complete && !partial
      ? toolOutcome(part.output)
      : { failed: false, note: null };
  const errored = outcome.failed;
  // A cancelled change is the person's answer, not a failure: it is not red.
  const failed = !cancelled && (errored || part.state === "output-error");
  // Approved and waiting for the agent to pick it back up. Once the turn has
  // finished the card stops spinning, whatever state the part was left in: a
  // card that still read "running" after the reply was shown said the work was
  // not done when it was (#432).
  // …unless other approvals from its step are still unanswered: eve runs none
  // of the step's calls until they are, so nothing is being applied (#616).
  const batch = useApprovalBatch(request?.requestId ?? "");
  const heldByBatch =
    batch !== null
    && batch.pending.some((item) => item.requestId !== request?.requestId);
  const applying =
    working
    && !cancelled
    && !heldByBatch
    && (part.state === "approval-responded"
      || (part.state === "approval-requested" && responded));
  const running =
    working
    && (part.state === "input-streaming"
      || part.state === "input-available"
      || partial
      || applying);
  const [open, setOpen] = useState(false);

  const title =
    label
    ?? (part.toolName === "delegate"
      ? delegateTitle("input" in part ? part.input : undefined)
      : null)
    ?? TOOL_TITLES[part.toolName]
    ?? humanize(part.toolName);
  // Ids mean nothing to the office, and the routing tools' arguments are
  // written by the model for other models — leadId=105, offer UUIDs — so they
  // stay out of the card; the specialist's own panel shows the work (#429).
  const fields = INTERNAL_ARGUMENT_TOOLS.has(part.toolName)
    ? []
    : toInputFields("input" in part ? part.input : undefined, {
        hideIds: true,
      });
  // A delegate's answer is shown once: in the specialist's own panel, collapsed,
  // with the orchestrator's reply as the answer. Repeating it here showed the
  // same sentence three times (#432).
  const result =
    complete && part.toolName !== "delegate"
      ? resultEnvelope(part.output)
      : null;
  const duration = formatDuration(startedAt, endedAt);
  const Icon = cancelled
    ? Ban
    : failed
      ? XCircle
      : complete && !partial
        ? CheckCircle2
        : awaitingApproval
          ? ShieldCheck
          : running
            ? LoaderCircle
            : responded
              ? ShieldCheck
              : CircleDashed;

  return (
    <article
      // What the inspector's "Review in the transcript" link and the approval
      // bar scroll to. Without it both looked for an element that never existed.
      data-approval-id={request?.requestId}
      className={cn(
        "overflow-hidden rounded-lg border bg-card",
        failed
          ? "border-destructive/35"
          : awaitingApproval
            ? "border-warning/40"
            : "border-border",
      )}
    >
      <header className="flex items-center gap-2.5 px-3 py-2.5">
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-md bg-background",
            failed
              ? "text-destructive-ink"
              : complete && !partial
                ? "text-success-ink"
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
            {cancelled
              ? "Cancelled"
              : (outcome.note
                ?? (errored
                  ? "Could not complete"
                  : toolStateLabel(part.state, {
                      applying,
                      partial,
                      responded,
                      working,
                    })))}
            {duration ? ` · ${duration}` : ""}
          </p>
        </div>
      </header>

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
            applying={applying}
            canRespond={canRespond}
            cancelled={cancelled && !interrupted}
            input={"input" in part ? part.input : undefined}
            label={title}
            onRespond={onRespond}
            request={request}
            responded={responded || part.state !== "approval-requested"}
            toolName={part.toolName}
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

      {part.state === "output-error" && !cancelled ? (
        <p className="border-t border-border/60 px-3 py-2.5 text-sm text-destructive">
          {part.errorText}
        </p>
      ) : null}

      {cancelled && (!request || interrupted) ? (
        <p className="border-t border-border/60 px-3 py-2.5 text-sm text-muted-foreground">
          {cancelNotice(part)}
        </p>
      ) : null}
    </article>
  );
}

/**
 * What a cancelled card says. "Cancelled", because Cancel is the button the
 * person pressed: the specialist said "declined", the orchestrator
 * "cancelled", and the card "Tool execution was cancelled." (#432). Their own
 * note, if they wrote one, is shown as theirs.
 */
export function cancelNotice(part: EveDynamicToolPart): string {
  if (part.state === "output-error" && part.approval?.approved === true)
    return "Cancelled while it was running. Check the record before trying again.";
  const note =
    part.state === "output-denied" ? part.approval.reason?.trim() : undefined;
  const own = note && !SYSTEM_CANCEL_TEXT.test(note) ? note : null;
  return own
    ? `You cancelled this. Nothing was changed. Your note: ${own}`
    : "You cancelled this. Nothing was changed.";
}

export function toolStateLabel(
  state: EveDynamicToolPart["state"],
  {
    applying,
    partial,
    responded,
    working,
  }: {
    applying: boolean;
    partial: boolean;
    responded: boolean;
    working: boolean;
  },
) {
  if (partial) return working ? "Streaming a result" : "Completed";
  if (applying) return "Applying your change…";
  switch (state) {
    case "approval-requested":
      return responded ? "Approved" : "Waiting for your approval";
    case "approval-responded":
      return "Approved";
    case "input-available":
    case "input-streaming":
      return working ? "Preparing the operation" : "Did not run";
    case "output-available":
      return "Completed";
    case "output-denied":
      return "Cancelled";
    case "output-error":
      return "Could not complete";
  }
}
