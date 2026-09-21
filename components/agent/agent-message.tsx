"use client";

import type {
  EveAuthorizationPart,
  EveDynamicToolPart,
  EveMessage,
  EveMessageInputRequest,
  EveMessagePart,
} from "eve/react";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  CircleDashed,
  Copy,
  ExternalLink,
  FileText,
  KeyRound,
  Pencil,
  Wrench,
  XCircle,
} from "lucide-react";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { isInternalHref } from "@/utils/safe-links";
import type { AgentAnnotation } from "./agent-annotations";

export type AgentInputResponse = {
  optionId?: string;
  requestId: string;
  text?: string;
};

export function AgentMessage({
  canRespond,
  isStreaming,
  message,
  annotations,
  onAction,
  onEditMessage,
  onInputResponses,
}: {
  canRespond: boolean;
  isStreaming: boolean;
  message: EveMessage;
  annotations?: readonly Pick<AgentAnnotation, "id" | "label" | "type">[];
  onAction: (action: {
    id: string;
    label: string;
    operation: string;
  }) => Promise<void>;
  onEditMessage: (messageId: string, text: string) => void;
  onInputResponses: (responses: readonly AgentInputResponse[]) => Promise<void>;
}) {
  const lastTextIndex = message.parts.reduce(
    (last, part, index) => (part.type === "text" ? index : last),
    -1,
  );
  const text = getMessageText(message);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyMessage() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      toast.error("Could not copy this message.");
    }
  }

  return (
    <Message from={message.role}>
      <MessageContent>
        {message.role === "user" && annotations?.length ? (
          <div
            aria-label="Message annotations"
            className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-blue-600 dark:text-blue-400"
          >
            {annotations.map((annotation) => (
              <span key={`${annotation.type}:${annotation.id}`}>
                <span aria-hidden="true">@</span>
                {annotation.label}
              </span>
            ))}
          </div>
        ) : null}
        {message.parts.map((part, index) => (
          <AgentMessagePart
            canRespond={canRespond}
            key={partKey(part, index)}
            onInputResponses={onInputResponses}
            onAction={onAction}
            part={part}
            showCaret={
              isStreaming &&
              message.role === "assistant" &&
              index === lastTextIndex
            }
          />
        ))}
      </MessageContent>
      {text ? (
        <MessageActions className="self-end opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <MessageAction
            label={copied ? "Copied" : "Copy message"}
            onClick={() => void copyMessage()}
            tooltip={copied ? "Copied" : "Copy message"}
          >
            {copied ? (
              <Check aria-hidden="true" />
            ) : (
              <Copy aria-hidden="true" />
            )}
          </MessageAction>
          {message.role === "user" ? (
            <MessageAction
              label="Edit message"
              onClick={() => onEditMessage(message.id, text)}
              tooltip="Edit message"
            >
              <Pencil aria-hidden="true" />
            </MessageAction>
          ) : null}
        </MessageActions>
      ) : null}
    </Message>
  );
}

function getMessageText(message: EveMessage) {
  return message.parts
    .filter(
      (part): part is Extract<EveMessage["parts"][number], { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function AgentMessagePart({
  canRespond,
  onAction,
  onInputResponses,
  part,
  showCaret,
}: {
  canRespond: boolean;
  onAction: (action: {
    id: string;
    label: string;
    operation: string;
  }) => Promise<void>;
  onInputResponses: (responses: readonly AgentInputResponse[]) => Promise<void>;
  part: EveMessagePart;
  showCaret: boolean;
}) {
  switch (part.type) {
    case "step-start":
    case "reasoning":
      return null;
    case "text":
      return (
        <MessageResponse caret="block" isAnimating={showCaret}>
          {part.text}
        </MessageResponse>
      );
    case "file":
      return (
        <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2">
          <FileText
            aria-hidden="true"
            className="size-4 text-muted-foreground"
          />
          <span className="truncate text-sm">
            {part.filename ?? "Attachment"}
          </span>
          {part.url ? (
            <a
              className="ml-auto shrink-0 text-xs text-royal-gold-ink underline-offset-2 hover:underline"
              href={part.url}
              rel="noreferrer"
              target="_blank"
            >
              Preview
            </a>
          ) : null}
        </div>
      );
    case "authorization":
      return <AuthorizationPrompt part={part} />;
    case "dynamic-tool":
      return (
        <ToolActivity
          canRespond={canRespond}
          onAction={onAction}
          onInputResponses={onInputResponses}
          part={part}
        />
      );
  }
}

function AuthorizationPrompt({ part }: { part: EveAuthorizationPart }) {
  const complete = part.state === "completed";
  return (
    <Alert>
      {complete ? (
        <CheckCircle2 aria-hidden="true" />
      ) : (
        <KeyRound aria-hidden="true" />
      )}
      <AlertTitle>
        {complete
          ? `${part.displayName} connection updated`
          : `Connect ${part.displayName}`}
      </AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>{part.description}</span>
        {part.state === "required" && part.authorization?.url ? (
          <Button asChild size="sm">
            <a href={part.authorization.url} rel="noreferrer" target="_blank">
              <ExternalLink data-icon="inline-start" />
              Continue securely
            </a>
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function ToolActivity({
  canRespond,
  onAction,
  onInputResponses,
  part,
}: {
  canRespond: boolean;
  onAction: (action: {
    id: string;
    label: string;
    operation: string;
  }) => Promise<void>;
  onInputResponses: (responses: readonly AgentInputResponse[]) => Promise<void>;
  part: EveDynamicToolPart;
}) {
  const request = part.toolMetadata?.eve?.inputRequest;
  const result =
    part.state === "output-available" ? resultEnvelope(part.output) : null;
  const failed =
    part.state === "output-error" || part.state === "output-denied";
  const complete = part.state === "output-available";
  const Icon = failed ? XCircle : complete ? CheckCircle2 : CircleDashed;

  return (
    <Card className="gap-3 bg-muted/30 py-3 shadow-none" size="sm">
      <CardHeader className="grid-cols-[1fr_auto] items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-background text-muted-foreground">
            <Icon
              aria-hidden="true"
              className={failed ? "text-destructive" : undefined}
            />
          </span>
          <div className="min-w-0">
            <CardTitle className="truncate text-sm" as="h3">
              {toolLabel(part.toolName)}
            </CardTitle>
            <CardDescription className="text-xs">
              {toolStateLabel(part.state)}
            </CardDescription>
          </div>
        </div>
        <Badge
          variant={failed ? "destructive" : complete ? "secondary" : "outline"}
        >
          <Wrench data-icon="inline-start" />
          Operation
        </Badge>
      </CardHeader>
      {request ? (
        <CardContent>
          <InputRequest
            canRespond={canRespond}
            onInputResponses={onInputResponses}
            request={request}
            responded={part.toolMetadata?.eve?.inputResponse !== undefined}
          />
        </CardContent>
      ) : null}
      {result ? (
        <CardContent className="flex flex-col gap-2 border-t border-border/70 pt-3">
          <ResultCanvas result={result} />
          {result.outreach ? (
            <ComplianceOutreachCard outreach={result.outreach} />
          ) : null}
          {result.warnings.length > 0 ? (
            <div className="rounded-md border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-950">
              <p className="font-medium">Review notes</p>
              <ul className="mt-1 list-disc pl-4">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
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
        </CardContent>
      ) : null}
      {part.state === "output-error" ? (
        <CardContent className="border-t border-border/70 pt-3 text-sm text-destructive">
          {part.errorText}
        </CardContent>
      ) : null}
    </Card>
  );
}

function InputRequest({
  canRespond,
  onInputResponses,
  request,
  responded,
}: {
  canRespond: boolean;
  onInputResponses: (responses: readonly AgentInputResponse[]) => Promise<void>;
  request: EveMessageInputRequest;
  responded: boolean;
}) {
  const [answer, setAnswer] = useState("");
  const hasOptions = (request.options?.length ?? 0) > 0;
  const acceptsText = request.allowFreeform === true || !hasOptions;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-royal-gold/35 bg-royal-gold-light/45 p-3">
      <p className="text-sm font-medium text-foreground">{request.prompt}</p>
      {responded ? (
        <p className="text-xs text-muted-foreground">Response recorded.</p>
      ) : (
        <>
          {hasOptions ? (
            <div className="flex flex-wrap gap-2">
              {request.options?.map((option) => (
                <Button
                  disabled={!canRespond}
                  key={option.id}
                  onClick={() =>
                    void onInputResponses([
                      { optionId: option.id, requestId: request.requestId },
                    ])
                  }
                  size="sm"
                  type="button"
                  variant={
                    option.style === "danger" ? "destructive" : "default"
                  }
                >
                  {option.label}
                </Button>
              ))}
            </div>
          ) : null}
          {acceptsText ? (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const text = answer.trim();
                if (!text) return;
                void onInputResponses([{ requestId: request.requestId, text }]);
              }}
            >
              <Input
                aria-label="Your response"
                disabled={!canRespond}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="Type your response"
                value={answer}
              />
              <Button
                disabled={!canRespond || !answer.trim()}
                size="sm"
                type="submit"
              >
                Send
              </Button>
            </form>
          ) : null}
        </>
      )}
    </div>
  );
}

type ResultEnvelope = {
  kind: string;
  actions: {
    destructive?: boolean;
    id: string;
    label: string;
    operation: string;
  }[];
  links: { href: string; label: string }[];
  outreach: {
    body: string;
    contactEmail: string | null;
    contactName: string | null;
    daysOpen: number | null;
    lastFollowUpAt: string | null;
    party: string;
    subject: string;
    slaStatus: string;
  } | null;
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

function resultEnvelope(value: unknown): ResultEnvelope | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.title !== "string" ||
    typeof candidate.summary !== "string"
  ) {
    return null;
  }
  const links = Array.isArray(candidate.links)
    ? candidate.links.filter((link): link is { href: string; label: string } =>
        Boolean(
          link &&
          typeof link === "object" &&
          typeof (link as Record<string, unknown>).href === "string" &&
          isInternalHref((link as Record<string, unknown>).href as string) &&
          typeof (link as Record<string, unknown>).label === "string",
        ),
      )
    : [];
  const actions = Array.isArray(candidate.actions)
    ? candidate.actions.filter(
        (action): action is ResultEnvelope["actions"][number] =>
          Boolean(
            action &&
            typeof action === "object" &&
            typeof (action as Record<string, unknown>).id === "string" &&
            typeof (action as Record<string, unknown>).label === "string" &&
            typeof (action as Record<string, unknown>).operation === "string",
          ),
      )
    : [];
  const outreachValue =
    candidate.data &&
    typeof candidate.data === "object" &&
    !Array.isArray(candidate.data)
      ? (candidate.data as Record<string, unknown>).outreach
      : null;
  const outreach =
    outreachValue &&
    typeof outreachValue === "object" &&
    !Array.isArray(outreachValue)
      ? (() => {
          const value = outreachValue as Record<string, unknown>;
          return typeof value.body === "string" &&
            typeof value.party === "string" &&
            typeof value.subject === "string"
            ? {
                body: value.body,
                contactEmail:
                  typeof value.contactEmail === "string"
                    ? value.contactEmail
                    : null,
                contactName:
                  typeof value.contactName === "string"
                    ? value.contactName
                    : null,
                daysOpen:
                  typeof value.daysOpen === "number" ? value.daysOpen : null,
                lastFollowUpAt:
                  typeof value.lastFollowUpAt === "string"
                    ? value.lastFollowUpAt
                    : null,
                party: value.party,
                subject: value.subject,
                slaStatus:
                  typeof value.slaStatus === "string"
                    ? value.slaStatus
                    : "READY",
              }
            : null;
        })()
      : null;
  const data =
    candidate.data &&
    typeof candidate.data === "object" &&
    !Array.isArray(candidate.data)
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
    typeof entityDisplay?.href === "string" &&
    isInternalHref(entityDisplay.href)
      ? entityDisplay.href
      : undefined;
  const entityRef =
    entityValue &&
    typeof entityValue.type === "string" &&
    typeof entityValue.id === "string" &&
    entityDisplay &&
    typeof entityDisplay.label === "string"
      ? {
          type: entityValue.type,
          id: entityValue.id,
          display: { label: entityDisplay.label, href: entityHref },
        }
      : null;
  const warnings = Array.isArray(candidate.warnings)
    ? candidate.warnings.filter(
        (warning): warning is string => typeof warning === "string",
      )
    : [];
  return {
    actions,
    links,
    outreach,
    summary: candidate.summary,
    title: candidate.title,
    kind:
      typeof candidate.kind === "string" ? candidate.kind : "entity-summary",
    warnings,
    requiresApproval: candidate.requiresApproval === true,
    entityRef,
    data,
  };
}

function ResultCanvas({ result }: { result: ResultEnvelope }) {
  const entries = Object.entries(result.data).filter(
    ([key, value]) =>
      key !== "outreach" && value !== null && typeof value !== "object",
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-foreground">{result.title}</p>
          <p className="text-sm text-muted-foreground">{result.summary}</p>
        </div>
        <Badge variant={result.requiresApproval ? "default" : "outline"}>
          {result.requiresApproval
            ? "Approval required"
            : result.kind.replaceAll("-", " ")}
        </Badge>
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
      {entries.length > 0 ? (
        <dl className="grid grid-cols-2 gap-2 rounded-md border border-border/60 bg-background/70 p-2 text-xs sm:grid-cols-3">
          {entries.slice(0, 9).map(([key, value]) => (
            <div className="min-w-0" key={key}>
              <dt className="truncate text-muted-foreground">
                {key.replaceAll(/([A-Z])/g, " $1")}
              </dt>
              <dd className="truncate font-medium text-foreground">
                {String(value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function ComplianceOutreachCard({
  outreach,
}: {
  outreach: NonNullable<ResultEnvelope["outreach"]>;
}) {
  return (
    <div className="rounded-lg border border-royal-gold/35 bg-royal-gold-light/30 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {outreach.party.replaceAll("_", " ")}
        </span>
        <Badge variant="outline">
          {outreach.slaStatus}
          {outreach.daysOpen === null ? "" : ` · ${outreach.daysOpen}d open`}
        </Badge>
      </div>
      <dl className="mt-2 grid gap-1 text-xs text-muted-foreground">
        <div>
          <dt className="inline font-medium text-foreground">To: </dt>
          <dd className="inline">
            {outreach.contactName ? `${outreach.contactName} · ` : ""}
            {outreach.contactEmail ?? "No recipient"}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium text-foreground">Subject: </dt>
          <dd className="inline break-all">{outreach.subject}</dd>
        </div>
      </dl>
      <div className="mt-3 whitespace-pre-wrap rounded-md border border-border/60 bg-white/70 p-2 text-xs text-foreground">
        {stripHtml(outreach.body)}
      </div>
      {outreach.lastFollowUpAt ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Last follow-up: {new Date(outreach.lastFollowUpAt).toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}

function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>(\s*)/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function toolLabel(name: string) {
  return name
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toolStateLabel(state: EveDynamicToolPart["state"]) {
  const labels: Record<EveDynamicToolPart["state"], string> = {
    "approval-requested": "Waiting for your approval",
    "approval-responded": "Approval recorded",
    "input-available": "Preparing operation",
    "input-streaming": "Preparing operation",
    "output-available": "Completed",
    "output-denied": "Declined",
    "output-error": "Could not complete",
  };
  return labels[state];
}

function partKey(part: EveMessagePart, index: number) {
  if (part.type === "authorization") {
    return `authorization:${part.turnId}:${part.stepIndex}:${part.name}`;
  }
  if (part.type === "dynamic-tool") return part.toolCallId;
  return `${part.type}:${index}`;
}
