"use client";

import type {
  EveAuthorizationPart,
  EveDynamicToolPart,
  EveMessage,
  EveMessageInputRequest,
  EveMessagePart,
} from "eve/react";
import { useState } from "react";
import {
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  FileText,
  KeyRound,
  Wrench,
  XCircle,
} from "lucide-react";
import {
  Message,
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

export type AgentInputResponse = {
  optionId?: string;
  requestId: string;
  text?: string;
};

export function AgentMessage({
  canRespond,
  isStreaming,
  message,
  onInputResponses,
}: {
  canRespond: boolean;
  isStreaming: boolean;
  message: EveMessage;
  onInputResponses: (responses: readonly AgentInputResponse[]) => Promise<void>;
}) {
  const lastTextIndex = message.parts.reduce(
    (last, part, index) => (part.type === "text" ? index : last),
    -1,
  );

  return (
    <Message from={message.role}>
      <MessageContent>
        {message.parts.map((part, index) => (
          <AgentMessagePart
            canRespond={canRespond}
            key={partKey(part, index)}
            onInputResponses={onInputResponses}
            part={part}
            showCaret={
              isStreaming &&
              message.role === "assistant" &&
              index === lastTextIndex
            }
          />
        ))}
      </MessageContent>
    </Message>
  );
}

function AgentMessagePart({
  canRespond,
  onInputResponses,
  part,
  showCaret,
}: {
  canRespond: boolean;
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
          <FileText aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="truncate text-sm">{part.filename ?? "Attachment"}</span>
        </div>
      );
    case "authorization":
      return <AuthorizationPrompt part={part} />;
    case "dynamic-tool":
      return (
        <ToolActivity
          canRespond={canRespond}
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
        {complete ? `${part.displayName} connection updated` : `Connect ${part.displayName}`}
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
  onInputResponses,
  part,
}: {
  canRespond: boolean;
  onInputResponses: (responses: readonly AgentInputResponse[]) => Promise<void>;
  part: EveDynamicToolPart;
}) {
  const request = part.toolMetadata?.eve?.inputRequest;
  const result = part.state === "output-available" ? resultEnvelope(part.output) : null;
  const failed = part.state === "output-error" || part.state === "output-denied";
  const complete = part.state === "output-available";
  const Icon = failed ? XCircle : complete ? CheckCircle2 : CircleDashed;

  return (
    <Card className="gap-3 bg-muted/30 py-3 shadow-none" size="sm">
      <CardHeader className="grid-cols-[1fr_auto] items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-background text-muted-foreground">
            <Icon aria-hidden="true" className={failed ? "text-destructive" : undefined} />
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
        <Badge variant={failed ? "destructive" : complete ? "secondary" : "outline"}>
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
          <p className="font-medium text-foreground">{result.title}</p>
          <p className="text-sm text-muted-foreground">{result.summary}</p>
          {result.links.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {result.links.map((link) => (
                <Button asChild key={`${link.href}:${link.label}`} size="sm" variant="outline">
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
                  variant={option.style === "danger" ? "destructive" : "default"}
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
              <Button disabled={!canRespond || !answer.trim()} size="sm" type="submit">
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
  links: { href: string; label: string }[];
  summary: string;
  title: string;
};

function resultEnvelope(value: unknown): ResultEnvelope | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.title !== "string" || typeof candidate.summary !== "string") {
    return null;
  }
  const links = Array.isArray(candidate.links)
    ? candidate.links.filter(
        (link): link is { href: string; label: string } =>
          Boolean(
            link &&
              typeof link === "object" &&
              typeof (link as Record<string, unknown>).href === "string" &&
              (link as Record<string, unknown>).href?.toString().startsWith("/") &&
              typeof (link as Record<string, unknown>).label === "string",
          ),
      )
    : [];
  return { links, summary: candidate.summary, title: candidate.title };
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
