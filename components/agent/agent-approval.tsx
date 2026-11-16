"use client";

import { useEffect, useState } from "react";
import type { EveMessageInputRequest } from "eve/react";
import {
  CircleAlert,
  LoaderCircle,
  MessageCircleQuestion,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toInputFields } from "@/components/agent/agent-format";
import {
  AgentOutreach,
  type AgentOutreachDetails,
} from "@/components/agent/agent-outreach";
import { AgentWhatsAppDraftView } from "@/components/agent/agent-whatsapp";
import {
  approvalWhatsApp,
  WHATSAPP_APPROVAL_KEYS,
} from "@/components/agent/agent-whatsapp-format";
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
  applying = false,
  canRespond,
  cancelled = false,
  input,
  label,
  onRespond,
  request,
  responded,
  toolName,
}: {
  /** Approved, and the agent has not picked the change back up yet. */
  applying?: boolean;
  canRespond: boolean;
  /** The person pressed Cancel (or the call was cancelled). */
  cancelled?: boolean;
  input: unknown;
  label: string;
  /** The tool being approved, when the request is a tool approval. */
  toolName?: string | null;
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
  const whatsapp = isApproval ? approvalWhatsApp(toolName, input) : null;
  const outreach = isApproval && !whatsapp ? approvalOutreach(input) : null;
  const { names: attachmentNames, unchanged: attachmentsUnchanged } =
    useOutreachAttachmentNames(outreach ? input : undefined);
  // An outreach cannot be approved before the owner can see its files.
  const filesLoading = outreach !== null && attachmentNames === undefined;
  const { labels: targetLabels, changeLabels } = useApprovalTargetLabels(
    isApproval ? input : undefined,
  );
  // The email or WhatsApp body is the approval when there is one, so it is
  // rendered rather than repeated as a raw argument below the preview. The
  // lead id stays: the preview names the lead only by number, and this row is
  // where the looked-up lead name appears.
  const fields = (
    isApproval ? toInputFields(input, { changeLabels }) : []
  ).filter(
    (field) =>
      !(outreach && OUTREACH_KEYS.has(field.key))
      && !(
        whatsapp
        && field.key !== "leadId"
        && WHATSAPP_APPROVAL_KEYS.has(field.key)
      ),
  );
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
  async function respond(
    response: AgentInputResponse,
    { verifyFiles = false }: { verifyFiles?: boolean } = {},
  ) {
    if (submitting) return;
    setSubmitting(true);
    setRespondError(null);
    try {
      if (verifyFiles && outreach && !(await attachmentsUnchanged())) {
        setRespondError(
          "The files on this email changed while you were reading it. Check the list above and approve again.",
        );
        return;
      }
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
            {/* Once answered, the heading says what happened: a card that
                still read "Approval required" after Approve looked like it
                needed another click (#432). */}
            {isApproval
              ? responded
                ? cancelled
                  ? "Cancelled"
                  : "Approved"
                : "Approval required"
              : isLimit
                ? "Session limit"
                : responded
                  ? "Answered"
                  : "Question"}
          </p>
          <p className="text-sm font-medium text-foreground">
            {isApproval ? label : request.prompt}
          </p>
          {isApproval
          && request.prompt !== label
          && !request.prompt.startsWith("Approve tool call:") ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {request.prompt}
            </p>
          ) : null}
        </div>
      </div>

      {outreach ? (
        <AgentOutreach
          checking={filesLoading}
          outreach={{ ...outreach, attachmentNames }}
        />
      ) : null}

      {whatsapp ? <AgentWhatsAppDraftView draft={whatsapp} /> : null}

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
                  {/* A named record shows its name only; the raw id stays
                      behind it for the tool. */}
                  {targetLabels[field.key]
                    ? targetLabels[field.key]
                    : field.value}
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
        <p
          className="flex items-center gap-2 text-xs text-muted-foreground"
          role="status"
        >
          {applying ? (
            <LoaderCircle
              aria-hidden="true"
              className="size-3.5 animate-spin"
            />
          ) : null}
          {respondedNotice({ applying, cancelled, isApproval })}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {hasOptions && decliningOptionId === null ? (
            <div className="flex flex-wrap gap-2">
              {request.options?.map((option) => (
                <Button
                  disabled={busy || (filesLoading && option.style !== "danger")}
                  key={option.id}
                  onClick={() =>
                    option.style === "danger"
                      ? setDecliningOptionId(option.id)
                      : void respond(
                          {
                            optionId: option.id,
                            requestId: request.requestId,
                          },
                          { verifyFiles: isApproval },
                        )
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
              {/* "Cancel", the word on the button that opened this. The agent
                  never retries a cancelled change, so the note is for its
                  reply, not for another attempt. */}
              <Textarea
                aria-label="Why are you cancelling?"
                className="min-h-16 text-sm"
                autoFocus
                disabled={busy}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Anything the agent should know? (optional)"
                value={reason}
              />
              <div className="flex gap-2">
                <Button
                  disabled={busy}
                  size="sm"
                  type="submit"
                  variant="destructive"
                >
                  Cancel the change
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
 * The line under an answered card. After Approve the agent can take a while
 * to pick the change back up, so the card says it is being applied instead of
 * looking finished or stuck (#432).
 */
export function respondedNotice({
  applying,
  cancelled,
  isApproval,
}: {
  applying: boolean;
  cancelled: boolean;
  isApproval: boolean;
}): string {
  if (!isApproval) return "Answer sent.";
  if (cancelled) return "You cancelled this. Nothing was changed.";
  return applying ? "Approved. Applying your change…" : "Approved.";
}

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
    // Only the extras the model named: deliverables are documents asked of the
    // party, not files on this email. The real list, standard pack included,
    // is looked up by `useOutreachAttachmentNames`.
    attachmentCount: Array.isArray(value.extraAttachmentIds)
      ? value.extraAttachmentIds.length
      : 0,
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

/** The server's list of files this outreach would attach now; null if unavailable. */
async function fetchOutreachAttachmentNames(
  input: unknown,
  signal?: AbortSignal,
): Promise<readonly string[] | null> {
  try {
    const response = await fetch("/api/agent/approval-attachments", {
      body: JSON.stringify({ input }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      attachments?: string[] | null;
    };
    return payload.attachments ?? null;
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") throw error;
    return null;
  }
}

/**
 * The file names an outreach approval will really attach.
 *
 * The party's standard pack is added by the send itself, so no argument the
 * model wrote lists it, and the card used to show only what the model named.
 * Looked up from the server's own selection (never taken from the model):
 * `names` is undefined while loading and null when the lookup failed or was
 * refused. The pack can change while the card is open (a file uploaded in
 * another tab), so `unchanged()` asks again at the moment of approval and
 * reports whether the list the owner read is still the list that would go.
 */
function useOutreachAttachmentNames(input: unknown) {
  const [resolved, setResolved] = useState<{
    key: string;
    names: readonly string[] | null;
  } | null>(null);
  const key = input === undefined ? null : JSON.stringify(input);

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    fetchOutreachAttachmentNames(JSON.parse(key), controller.signal)
      .then((names) => setResolved({ key, names }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [key]);

  const names =
    key !== null && resolved?.key === key ? resolved.names : undefined;

  async function unchanged(): Promise<boolean> {
    if (key === null) return true;
    const fresh = await fetchOutreachAttachmentNames(JSON.parse(key));
    setResolved({ key, names: fresh });
    return JSON.stringify(fresh) === JSON.stringify(names);
  }

  return { names, unchanged };
}

/**
 * Names for the ids an approval carries — "Cut & Fill - Concretor · Lot 9028
 * Sommerville Dr" rather than a bare milestone UUID — both at the top level
 * and inside a set of changes, where a reassignment names its new target.
 *
 * Looked up from the database by the signed-in operator's own access, never
 * taken from the model: a name the model supplied could disagree with the id
 * the tool will actually act on. An id the operator may not see, or a failed
 * lookup, leaves the raw id showing as before.
 */
function useApprovalTargetLabels(input: unknown): ApprovalTargetNames {
  // Kept with the ids they describe: a lookup for new ids that is refused or
  // fails must not leave the previous ids' names beside them.
  const [resolved, setResolved] = useState<{
    key: string;
    names: ApprovalTargetNames;
  } | null>(null);
  const record =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  // Top-level ids and ids inside a change set are looked up separately: the
  // same field name can point at a different record in each.
  const idKey = JSON.stringify({
    changes: Object.assign(
      {},
      ...Object.values(record)
        .filter(
          (value): value is Record<string, unknown> =>
            value !== null
            && typeof value === "object"
            && !Array.isArray(value),
        )
        .map(scalarIds),
    ),
    top: scalarIds(record),
  });

  useEffect(() => {
    const targets = JSON.parse(idKey) as {
      changes: Record<string, unknown>;
      top: Record<string, unknown>;
    };
    if (
      Object.keys(targets.top).length === 0
      && Object.keys(targets.changes).length === 0
    )
      return;
    const controller = new AbortController();
    const lookup = (ids: Record<string, unknown>) =>
      Object.keys(ids).length === 0
        ? Promise.resolve(NO_LABELS)
        : fetch("/api/agent/approval-targets", {
            body: JSON.stringify({ input: ids }),
            headers: { "content-type": "application/json" },
            method: "POST",
            signal: controller.signal,
          })
            .then((response) => (response.ok ? response.json() : null))
            .then(
              (payload: { labels?: Record<string, string> } | null) =>
                payload?.labels ?? NO_LABELS,
            );
    void Promise.all([lookup(targets.top), lookup(targets.changes)])
      .then(([labels, changeLabels]) =>
        setResolved({ key: idKey, names: { changeLabels, labels } }),
      )
      .catch(() => undefined);
    return () => controller.abort();
  }, [idKey]);

  return resolved?.key === idKey ? resolved.names : NO_NAMES;
}

type ApprovalTargetNames = {
  readonly labels: Readonly<Record<string, string>>;
  readonly changeLabels: Readonly<Record<string, string>>;
};

/** The `…Id` fields of an object whose value is one id. */
function scalarIds(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, item]) =>
        /Id$/.test(key)
        && (typeof item === "string" || typeof item === "number"),
    ),
  );
}

const NO_LABELS: Readonly<Record<string, string>> = {};
const NO_NAMES: ApprovalTargetNames = {
  changeLabels: NO_LABELS,
  labels: NO_LABELS,
};
