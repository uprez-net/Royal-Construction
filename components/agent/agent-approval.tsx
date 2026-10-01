"use client";

import { useEffect, useState } from "react";
import type { EveMessageInputRequest } from "eve/react";
import { CircleAlert, MessageCircleQuestion, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toInputFields } from "@/components/agent/agent-format";
import {
  AgentOutreach,
  type AgentOutreachDetails,
} from "@/components/agent/agent-outreach";
import { cn } from "@/lib/utils";

export type AgentInputResponse = {
  optionId?: string;
  requestId: string;
  text?: string;
};

/**
 * A human-in-the-loop gate: a tool approval, a question from the agent, or a
 * session-limit prompt.
 *
 * A tool approval shows the operation's actual arguments. Thirty-four
 * operations are approval-gated and many of them put a number, a date or an
 * email in front of a client, so approving one without seeing the recipient and
 * the body is the expensive mistake here. The arguments are the approval.
 */
export function AgentApproval({
  canRespond,
  input,
  label,
  onRespond,
  request,
  responded,
}: {
  canRespond: boolean;
  input: unknown;
  label: string;
  onRespond: (responses: readonly AgentInputResponse[]) => Promise<void>;
  request: EveMessageInputRequest;
  responded: boolean;
}) {
  const [answer, setAnswer] = useState("");
  const [decliningOptionId, setDecliningOptionId] = useState<string | null>(
    null,
  );
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [respondError, setRespondError] = useState<string | null>(null);
  const isApproval = request.kind === "tool-approval";
  const isLimit = request.kind === "session-limit";
  const outreach = isApproval ? approvalOutreach(input) : null;
  // The email body is the approval when there is one, so it is rendered rather
  // than repeated as a raw argument below the preview.
  const fields = (isApproval ? toInputFields(input) : []).filter(
    (field) => !(outreach && OUTREACH_KEYS.has(field.key)),
  );
  const targetLabels = useApprovalTargetLabels(isApproval ? input : undefined);
  const hasOptions = (request.options?.length ?? 0) > 0;
  const acceptsText = request.allowFreeform === true || !hasOptions;
  const Icon = isApproval
    ? ShieldCheck
    : isLimit
      ? CircleAlert
      : MessageCircleQuestion;

  /**
   * Submits one response, once.
   *
   * Eve rejects a second response while a turn is in flight, and the double
   * click that causes it is entirely reachable for one person: the buttons stay
   * enabled until `canRespond` re-renders. A dropped rejection here would leave
   * the operator believing they had approved something they had not — so the
   * attempt is guarded locally and any refusal is shown beside the buttons
   * rather than swallowed.
   */
  async function respond(response: AgentInputResponse) {
    if (submitting) return;
    setSubmitting(true);
    setRespondError(null);
    try {
      await onRespond([response]);
      setDecliningOptionId(null);
      setReason("");
      setAnswer("");
    } catch (error) {
      setRespondError(
        error instanceof Error && error.message
          ? error.message
          : "The response could not be sent. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const busy = !canRespond || submitting;

  return (
    <section
      aria-label={
        isApproval ? "Approval required" : "The agent needs an answer"
      }
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-3",
        responded
          ? "border-border/70 bg-muted/30"
          : isApproval || isLimit
            ? "border-royal-gold/55 bg-royal-gold-light/50 shadow-xs"
            : "border-border bg-background",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 grid size-7 shrink-0 place-items-center rounded-md",
            responded
              ? "bg-background text-muted-foreground"
              : "bg-royal-gold text-royal-gold-ink",
          )}
        >
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {isApproval
              ? "Approval required"
              : isLimit
                ? "Session limit"
                : "Question"}
          </p>
          <p className="text-sm font-medium text-foreground">
            {isApproval ? label : request.prompt}
          </p>
          {isApproval && request.prompt !== label ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {request.prompt}
            </p>
          ) : null}
        </div>
      </div>

      {outreach ? <AgentOutreach outreach={outreach} /> : null}

      {fields.length > 0 ? (
        <dl className="flex flex-col gap-2 rounded-lg border border-border/60 bg-background/80 p-2.5">
          {fields
            .filter((field) => !field.prose)
            .map((field) => (
              <div
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                key={field.key}
              >
                <dt className="min-w-28 shrink-0 text-xs text-muted-foreground">
                  {field.label}
                </dt>
                <dd
                  className={cn(
                    "min-w-0 flex-1 wrap-break-word text-xs",
                    field.clientFacing || targetLabels[field.key]
                      ? "font-semibold text-foreground"
                      : "text-foreground/80",
                  )}
                >
                  {targetLabels[field.key] ? (
                    <>
                      {targetLabels[field.key]}
                      <span className="block font-mono text-[10px] font-normal text-muted-foreground">
                        {field.value}
                      </span>
                    </>
                  ) : (
                    field.value
                  )}
                </dd>
              </div>
            ))}
          {fields
            .filter((field) => field.prose)
            .map((field) => (
              <div className="flex flex-col gap-1" key={field.key}>
                <dt className="text-xs text-muted-foreground">{field.label}</dt>
                <dd className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-border/60 bg-muted/30 p-2 text-xs text-foreground">
                  {field.value}
                </dd>
              </div>
            ))}
        </dl>
      ) : null}

      {responded ? (
        <p className="text-xs text-muted-foreground">
          Response recorded. Waiting for the agent to continue.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {hasOptions && decliningOptionId === null ? (
            <div className="flex flex-wrap gap-2">
              {request.options?.map((option) => (
                <Button
                  disabled={busy}
                  key={option.id}
                  onClick={() =>
                    option.style === "danger"
                      ? setDecliningOptionId(option.id)
                      : void respond({
                          optionId: option.id,
                          requestId: request.requestId,
                        })
                  }
                  size="sm"
                  title={option.description}
                  type="button"
                  variant={
                    option.style === "danger"
                      ? "outline"
                      : option.style === "primary"
                        ? "default"
                        : "secondary"
                  }
                >
                  {option.label}
                </Button>
              ))}
            </div>
          ) : null}

          {decliningOptionId !== null ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void respond({
                  optionId: decliningOptionId,
                  requestId: request.requestId,
                  ...(reason.trim() ? { text: reason.trim() } : {}),
                });
              }}
            >
              <Textarea
                aria-label="Why are you declining?"
                className="min-h-16 text-sm"
                autoFocus
                disabled={busy}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why not? The agent reads this before it tries again (optional)."
                value={reason}
              />
              <div className="flex gap-2">
                <Button
                  disabled={busy}
                  size="sm"
                  type="submit"
                  variant="destructive"
                >
                  Decline
                </Button>
                <Button
                  onClick={() => {
                    setDecliningOptionId(null);
                    setReason("");
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Back
                </Button>
              </div>
            </form>
          ) : null}

          {respondError ? (
            <p
              className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive"
              role="alert"
            >
              {respondError}
            </p>
          ) : null}

          {acceptsText && decliningOptionId === null ? (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const text = answer.trim();
                if (!text) return;
                void respond({ requestId: request.requestId, text });
              }}
            >
              <Input
                aria-label="Your response"
                disabled={busy}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="Type your response"
                value={answer}
              />
              <Button disabled={busy || !answer.trim()} size="sm" type="submit">
                Send
              </Button>
            </form>
          ) : null}
        </div>
      )}
    </section>
  );
}

const OUTREACH_KEYS = new Set(["body", "contactEmail", "contactName", "party"]);

/**
 * Reads an outreach preview out of a send tool's arguments.
 *
 * `send_compliance_outreach` and `send_compliance_follow_up` carry the exact
 * HTML body they will email. Approving one of those from a truncated text field
 * is how a mangled or half-substituted email reaches a certifier, so when the
 * arguments look like an email, the approval shows the email.
 */
function approvalOutreach(input: unknown): AgentOutreachDetails | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (typeof value.body !== "string" || value.body.trim().length === 0)
    return null;
  const hasRecipient =
    typeof value.contactEmail === "string" || typeof value.party === "string";
  if (!hasRecipient) return null;
  return {
    alertId: typeof value.alertId === "string" ? value.alertId : null,
    alertType: null,
    attachmentCount:
      (Array.isArray(value.deliverables) ? value.deliverables.length : 0)
      + (Array.isArray(value.extraAttachmentIds)
        ? value.extraAttachmentIds.length
        : 0),
    body: value.body,
    contactEmail:
      typeof value.contactEmail === "string" ? value.contactEmail : null,
    contactName:
      typeof value.contactName === "string" ? value.contactName : null,
    daysOpen: null,
    lastFollowUpAt: null,
    party: typeof value.party === "string" ? value.party : "Follow-up",
    slaStatus: null,
    subject: null,
  };
}

/**
 * Names for the ids an approval carries — "Cut & Fill - Concretor · Lot 9028
 * Sommerville Dr" rather than a bare milestone UUID.
 *
 * Looked up from the database by the signed-in operator's own access, never
 * taken from the model: a name the model supplied could disagree with the id
 * the tool will actually act on. An id the operator may not see, or a failed
 * lookup, leaves the raw id showing as before.
 */
function useApprovalTargetLabels(
  input: unknown,
): Readonly<Record<string, string>> {
  const [labels, setLabels] = useState<Readonly<Record<string, string>>>({});
  const ids =
    input && typeof input === "object" && !Array.isArray(input)
      ? Object.fromEntries(
          Object.entries(input as Record<string, unknown>).filter(
            ([key, value]) =>
              /Id$/.test(key)
              && (typeof value === "string" || typeof value === "number"),
          ),
        )
      : {};
  const idKey = JSON.stringify(ids);

  useEffect(() => {
    const targets = JSON.parse(idKey) as Record<string, unknown>;
    if (Object.keys(targets).length === 0) return;
    const controller = new AbortController();
    void fetch("/api/agent/approval-targets", {
      body: JSON.stringify({ input: targets }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { labels?: Record<string, string> } | null) => {
        if (payload?.labels) setLabels(payload.labels);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [idKey]);

  return labels;
}
