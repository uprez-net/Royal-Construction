"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatDisplayText,
  resultFacts,
} from "@/components/agent/agent-format";
import {
  AgentOutreach,
  type AgentOutreachDetails,
} from "@/components/agent/agent-outreach";
import {
  AgentWhatsAppDraftView,
  AgentWhatsAppMessageView,
  AgentWhatsAppThreadView,
} from "@/components/agent/agent-whatsapp";
import {
  readWhatsAppDraft,
  readWhatsAppMessage,
  readWhatsAppThread,
  type AgentWhatsAppDraft,
  type AgentWhatsAppMessage,
  type AgentWhatsAppThread,
} from "@/components/agent/agent-whatsapp-format";
import { isInternalHref } from "@/utils/safe-links";

export type AgentResultAction = {
  destructive?: boolean;
  id: string;
  label: string;
  operation: string;
};

export type AgentResultEnvelope = {
  kind: string;
  actions: AgentResultAction[];
  links: { href: string; label: string }[];
  outreach: AgentOutreachDetails | null;
  /** A lead's WhatsApp conversation (`get_lead_whatsapp`). */
  whatsapp: AgentWhatsAppThread | null;
  /** A WhatsApp message previewed but not sent. */
  whatsappDraft: AgentWhatsAppDraft | null;
  /** The message a WhatsApp send stored, sent or replayed. */
  whatsappMessage: AgentWhatsAppMessage | null;
  summary: string;
  title: string;
  warnings: string[];
  requiresApproval: boolean;
  entityRef: {
    type: string;
    id: string;
    display: { label: string; href?: string };
  } | null;
  data: Record<string, unknown>;
};

/**
 * Narrows a tool result to the shared agent result envelope.
 *
 * Links and actions are filtered here rather than at render time: a tool result
 * is model-influenced content, so an `href` that is not an internal route never
 * reaches the DOM.
 */
export function resultEnvelope(value: unknown): AgentResultEnvelope | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.title !== "string"
    || typeof candidate.summary !== "string"
  ) {
    return null;
  }
  const links = Array.isArray(candidate.links)
    ? candidate.links.filter((link): link is { href: string; label: string } =>
        Boolean(
          link
          && typeof link === "object"
          && typeof (link as Record<string, unknown>).href === "string"
          && isInternalHref((link as Record<string, unknown>).href as string)
          && typeof (link as Record<string, unknown>).label === "string",
        ),
      )
    : [];
  const actions = Array.isArray(candidate.actions)
    ? candidate.actions.filter((action): action is AgentResultAction =>
        Boolean(
          action
          && typeof action === "object"
          && typeof (action as Record<string, unknown>).id === "string"
          && typeof (action as Record<string, unknown>).label === "string"
          && typeof (action as Record<string, unknown>).operation === "string",
        ),
      )
    : [];
  const data =
    candidate.data
    && typeof candidate.data === "object"
    && !Array.isArray(candidate.data)
      ? (candidate.data as Record<string, unknown>)
      : {};
  const entityValue =
    candidate.entityRef && typeof candidate.entityRef === "object"
      ? (candidate.entityRef as Record<string, unknown>)
      : null;
  const entityDisplay =
    entityValue?.display && typeof entityValue.display === "object"
      ? (entityValue.display as Record<string, unknown>)
      : null;
  const entityHref =
    typeof entityDisplay?.href === "string"
    && isInternalHref(entityDisplay.href)
      ? entityDisplay.href
      : undefined;
  return {
    actions,
    data,
    entityRef:
      entityValue
      && typeof entityValue.type === "string"
      && typeof entityValue.id === "string"
      && entityDisplay
      && typeof entityDisplay.label === "string"
        ? {
            display: { href: entityHref, label: entityDisplay.label },
            id: entityValue.id,
            type: entityValue.type,
          }
        : null,
    kind:
      typeof candidate.kind === "string" ? candidate.kind : "entity-summary",
    links,
    outreach: readOutreach(data.outreach),
    whatsapp: readWhatsAppThread(data.whatsapp),
    whatsappDraft: readWhatsAppDraft(data.whatsappDraft),
    whatsappMessage: readWhatsAppMessage(data.message),
    requiresApproval: candidate.requiresApproval === true,
    summary: candidate.summary,
    title: candidate.title,
    warnings: Array.isArray(candidate.warnings)
      ? candidate.warnings.filter(
          (warning): warning is string => typeof warning === "string",
        )
      : [],
  };
}

function readOutreach(value: unknown): AgentOutreachDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const outreach = value as Record<string, unknown>;
  if (
    typeof outreach.body !== "string"
    || typeof outreach.party !== "string"
    || typeof outreach.subject !== "string"
  ) {
    return null;
  }
  return {
    alertId: typeof outreach.alertId === "string" ? outreach.alertId : null,
    alertType:
      typeof outreach.alertType === "string" ? outreach.alertType : null,
    attachmentCount:
      typeof outreach.attachmentCount === "number"
        ? outreach.attachmentCount
        : 0,
    attachmentNames: Array.isArray(outreach.attachments)
      ? outreach.attachments.flatMap((file) =>
          file
          && typeof file === "object"
          && typeof (file as { name?: unknown }).name === "string"
            ? [(file as { name: string }).name]
            : [],
        )
      : undefined,
    body: outreach.body,
    contactEmail:
      typeof outreach.contactEmail === "string" ? outreach.contactEmail : null,
    contactName:
      typeof outreach.contactName === "string" ? outreach.contactName : null,
    daysOpen: typeof outreach.daysOpen === "number" ? outreach.daysOpen : null,
    lastFollowUpAt:
      typeof outreach.lastFollowUpAt === "string"
        ? outreach.lastFollowUpAt
        : null,
    party: outreach.party,
    slaStatus:
      typeof outreach.slaStatus === "string" ? outreach.slaStatus : "READY",
    subject: outreach.subject,
  };
}

export function AgentResult({
  canRespond,
  onAction,
  partial,
  result,
}: {
  canRespond: boolean;
  onAction: (action: AgentResultAction) => Promise<void>;
  partial: boolean;
  result: AgentResultEnvelope;
}) {
  // Record ids are for tools, not people: the card shows names and facts.
  const facts = resultFacts(result.data);
  // The chip says something only when it changes how the card is read. A kind
  // ("tradie summary") is a schema word, and "Approval required" on a result is
  // never true: the only approval is the tool's own card, so a specialist that
  // set the flag on a question or a preview made a finished card look like it
  // still needed a click (#432).
  const chip = partial
    ? "Updating…"
    : result.kind === "error"
      ? "Could not complete"
      : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-foreground">
            {formatDisplayText(result.title)}
          </p>
          <p className="text-sm text-muted-foreground">
            {formatDisplayText(result.summary)}
          </p>
        </div>
        {chip ? (
          <Badge variant={partial ? "outline" : "destructive"}>{chip}</Badge>
        ) : null}
      </div>

      {result.entityRef ? (
        <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs">
          <span className="text-muted-foreground">Referenced</span>
          {result.entityRef.display.href ? (
            <a
              className="font-medium text-royal-gold-ink hover:underline"
              href={result.entityRef.display.href}
            >
              {result.entityRef.display.label}
            </a>
          ) : (
            <span className="font-medium">
              {result.entityRef.display.label}
            </span>
          )}
        </div>
      ) : null}

      {facts.length > 0 ? (
        <dl className="grid grid-cols-2 gap-2 rounded-md border border-border/60 bg-background/70 p-2 text-xs sm:grid-cols-3">
          {facts.slice(0, 9).map((fact) => (
            <div className="min-w-0" key={fact.key}>
              <dt className="truncate text-muted-foreground">{fact.label}</dt>
              <dd className="truncate font-medium text-foreground">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {result.outreach ? <AgentOutreach outreach={result.outreach} /> : null}

      {result.whatsappDraft ? (
        <AgentWhatsAppDraftView draft={result.whatsappDraft} />
      ) : result.whatsapp ? (
        <AgentWhatsAppThreadView thread={result.whatsapp} />
      ) : null}

      {result.whatsappMessage ? (
        <AgentWhatsAppMessageView message={result.whatsappMessage} />
      ) : null}

      {result.warnings.length > 0 ? (
        <div className="rounded-md border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          <p className="font-medium">Review notes</p>
          <ul className="mt-1 list-disc pl-4">
            {result.warnings.map((warning) => (
              <li key={warning}>{formatDisplayText(warning)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.actions.length > 0 ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {result.actions.map((action) => (
            <Button
              disabled={!canRespond}
              key={action.id}
              onClick={() => void onAction(action)}
              size="sm"
              type="button"
              variant={action.destructive ? "destructive" : "default"}
            >
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}

      {result.links.length > 0 ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {result.links.map((link) => (
            <Button
              asChild
              key={`${link.href}:${link.label}`}
              size="sm"
              variant="outline"
            >
              <a href={link.href}>{link.label}</a>
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
