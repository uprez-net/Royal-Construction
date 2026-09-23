"use client";

import type {
  EveAuthorizationPart,
  EveMessage,
  EveMessagePart,
} from "eve/react";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  KeyRound,
  Pencil,
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
import { Button } from "@/components/ui/button";
import type { AgentInputResponse } from "@/components/agent/agent-approval";
import {
  formatDisplayMarkdown,
  formatTime,
} from "@/components/agent/agent-format";
import { AgentReasoning } from "@/components/agent/agent-reasoning";
import type { AgentSubagentRun } from "@/components/agent/agent-reducer";
import type { AgentResultAction } from "@/components/agent/agent-result";
import { AgentSubagentPanel } from "@/components/agent/agent-subagent-panel";
import { AgentToolCall } from "@/components/agent/agent-tool-call";
import type { AgentAnnotation } from "@/components/agent/agent-mentions";

export type { AgentInputResponse };

export function AgentMessage({
  annotations,
  canRespond,
  isStreaming,
  labels,
  message,
  onAction,
  onEditMessage,
  onInputResponses,
  subagents,
  timestamp,
  toolTimes,
}: {
  annotations?: readonly Pick<AgentAnnotation, "id" | "label" | "type">[];
  canRespond: boolean;
  isStreaming: boolean;
  labels: Readonly<Record<string, string>>;
  message: EveMessage;
  onAction: (action: AgentResultAction) => Promise<void>;
  onEditMessage: (messageId: string, text: string) => void;
  onInputResponses: (responses: readonly AgentInputResponse[]) => Promise<void>;
  subagents: readonly AgentSubagentRun[];
  timestamp: string | null;
  toolTimes: Readonly<
    Record<number, { startedAt: string | null; endedAt: string | null }>
  >;
}) {
  const lastTextIndex = message.parts.reduce(
    (last, part, index) => (part.type === "text" ? index : last),
    -1,
  );
  const text = getMessageText(message);
  const [copied, setCopied] = useState(false);
  const time = formatTime(timestamp);

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
            labels={labels}
            onAction={onAction}
            onInputResponses={onInputResponses}
            part={part}
            role={message.role}
            showCaret={
              isStreaming
              && message.role === "assistant"
              && index === lastTextIndex
            }
            times={
              part.type === "dynamic-tool"
                ? (toolTimes[part.stepIndex ?? 0] ?? emptyTimes)
                : emptyTimes
            }
          />
        ))}
        {subagents.length > 0 ? (
          <section
            aria-label="Delegated specialist work"
            className="flex flex-col gap-2"
          >
            {subagents.map((run) => (
              <AgentSubagentPanel key={run.callId} run={run} />
            ))}
          </section>
        ) : null}
      </MessageContent>
      {text || time ? (
        <MessageActions className="self-end opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {time ? (
            <span className="mr-1 text-[11px] text-muted-foreground">
              {time}
            </span>
          ) : null}
          {text ? (
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
          ) : null}
          {text && message.role === "user" ? (
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

const emptyTimes = { endedAt: null, startedAt: null };

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
  labels,
  onAction,
  onInputResponses,
  part,
  role,
  showCaret,
  times,
}: {
  canRespond: boolean;
  labels: Readonly<Record<string, string>>;
  onAction: (action: AgentResultAction) => Promise<void>;
  onInputResponses: (responses: readonly AgentInputResponse[]) => Promise<void>;
  part: EveMessagePart;
  role: EveMessage["role"];
  showCaret: boolean;
  times: { startedAt: string | null; endedAt: string | null };
}) {
  switch (part.type) {
    case "step-start":
      return null;
    case "reasoning":
      return <AgentReasoning state={part.state} text={part.text} />;
    case "text":
      return (
        <MessageResponse caret="block" isAnimating={showCaret}>
          {/* What the operator typed is shown as typed. */}
          {role === "assistant" ? formatDisplayMarkdown(part.text) : part.text}
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
        <AgentToolCall
          canRespond={canRespond}
          endedAt={times.endedAt}
          label={labels[part.toolCallId]}
          onAction={onAction}
          onRespond={onInputResponses}
          part={part}
          startedAt={times.startedAt}
        />
      );
  }
}

function AuthorizationPrompt({ part }: { part: EveAuthorizationPart }) {
  const complete = part.state === "completed";
  const refused = complete && part.outcome !== "authorized";
  return (
    <Alert variant={refused ? "destructive" : "default"}>
      {refused ? (
        <XCircle aria-hidden="true" />
      ) : complete ? (
        <CheckCircle2 aria-hidden="true" />
      ) : (
        <KeyRound aria-hidden="true" />
      )}
      <AlertTitle>
        {complete
          ? part.outcome === "authorized"
            ? `${part.displayName} connected`
            : `${part.displayName} authorization ${part.outcome}`
          : `Connect ${part.displayName}`}
      </AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>
          {complete ? (part.reason ?? part.description) : part.description}
        </span>
        {part.state === "required" && part.authorization?.instructions ? (
          <span className="text-xs text-muted-foreground">
            {part.authorization.instructions}
          </span>
        ) : null}
        {part.state === "required" && part.authorization?.userCode ? (
          <code className="rounded-md border border-border/70 bg-muted px-2 py-1 font-mono text-sm tracking-widest">
            {part.authorization.userCode}
          </code>
        ) : null}
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

function partKey(part: EveMessagePart, index: number) {
  if (part.type === "authorization") {
    return `authorization:${part.turnId}:${part.stepIndex}:${part.name}`;
  }
  if (part.type === "dynamic-tool") return part.toolCallId;
  return `${part.type}:${index}`;
}
