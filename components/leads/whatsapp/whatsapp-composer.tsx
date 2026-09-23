"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  findWhatsAppTemplate,
  renderWhatsAppTemplate,
} from "@/lib/domain/leads/whatsapp/templates";
import { MAX_WHATSAPP_TEXT_LENGTH } from "@/lib/domain/leads/whatsapp/policy";
import type {
  WhatsAppSendBody,
  WhatsAppThreadDto,
} from "@/lib/leads/whatsapp-types";

type Mode = "text" | "template";

/**
 * Free-form text when the service window allows it, an approved template when
 * it does not — never a Send button that can only end in a provider error.
 *
 * The composer follows the eligibility the server computed. The server
 * re-checks everything on send, so this is advice about what will work, not
 * the rule itself.
 */
export function WhatsAppComposer({
  thread,
  sending,
  onSend,
}: {
  thread: WhatsAppThreadDto;
  sending: boolean;
  /** Resolves true when the message went out (or was already sent). */
  onSend: (body: WhatsAppSendBody) => Promise<boolean>;
}) {
  const { eligibility, templates, senders } = thread;
  const textAllowed = eligibility.text.allowed;
  const templateAllowed = eligibility.template.allowed && templates.length > 0;

  const [chosenMode, setChosenMode] = useState<Mode>("text");
  const mode: Mode = !textAllowed
    ? "template"
    : !templateAllowed
      ? "text"
      : chosenMode;

  const [body, setBody] = useState("");
  const [templateName, setTemplateName] = useState<string>(
    templates[0]?.name ?? "",
  );
  // Edited values per template; a template not yet touched uses its defaults.
  const [edited, setEdited] = useState<Record<string, string[]>>({});
  const [senderId, setSenderId] = useState<string>(
    eligibility.sender?.phoneNumberId ?? senders[0]?.phoneNumberId ?? "",
  );

  const option = templates.find((t) => t.name === templateName) ?? templates[0];
  const parameters = option
    ? (edited[option.name] ?? [...option.defaults])
    : [];
  const definition = option ? findWhatsAppTemplate(option.name) : null;
  const preview =
    definition && option
      ? renderWhatsAppTemplate(
          definition,
          parameters.map((value, index) =>
            value.trim() ? value : `[${option.parameters[index]?.label ?? index + 1}]`,
          ),
        )
      : "";

  if (!textAllowed && !templateAllowed) {
    return (
      <div
        role="status"
        className="rounded-lg border border-amber-200 bg-warning-light px-3.5 py-3 text-sm text-warning-ink"
      >
        <p className="font-medium">You can&apos;t send a WhatsApp message to this lead right now.</p>
        <p className="mt-1">
          {eligibility.template.reason ?? eligibility.text.reason}
        </p>
      </div>
    );
  }

  const senderChoice =
    senders.length > 1 && senderId !== eligibility.sender?.phoneNumberId
      ? senderId
      : null;

  async function submit() {
    if (sending) return;
    const sent =
      mode === "text"
        ? await onSend({
            body,
            businessPhoneNumberId: senderChoice,
            kind: "text",
          })
        : option
          ? await onSend({
              businessPhoneNumberId: senderChoice,
              kind: "template",
              parameters,
              templateName: option.name,
            })
          : false;
    if (!sent) return;
    if (mode === "text") setBody("");
    else if (option) {
      setEdited((prev) => {
        const next = { ...prev };
        delete next[option.name];
        return next;
      });
    }
  }

  const textTooLong = body.length > MAX_WHATSAPP_TEXT_LENGTH;
  const canSubmit =
    !sending
    && (mode === "text"
      ? body.trim().length > 0 && !textTooLong
      : Boolean(option) && parameters.every((value) => value.trim()));

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {!textAllowed ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {eligibility.text.reason}
        </p>
      ) : null}

      {textAllowed && templateAllowed ? (
        <div className="inline-flex rounded-lg border border-border p-0.5 text-xs" role="tablist">
          {(["text", "template"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setChosenMode(value)}
              className={cn(
                "rounded-md px-3 py-1 font-medium transition-colors",
                mode === value
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value === "text" ? "Message" : "Template"}
            </button>
          ))}
        </div>
      ) : null}

      {senders.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Label htmlFor="whatsapp-sender" className="text-xs text-muted-foreground">
            Send from
          </Label>
          <select
            id="whatsapp-sender"
            value={senderId}
            onChange={(event) => setSenderId(event.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            {senders.map((sender) => (
              <option key={sender.phoneNumberId} value={sender.phoneNumberId}>
                {sender.label} ({sender.displayNumber})
              </option>
            ))}
          </select>
          {senderChoice ? (
            <span className="text-muted-foreground">
              The service window shown above is for {eligibility.sender?.label};
              WhatsApp checks this number&apos;s own window when you send.
            </span>
          ) : null}
        </div>
      ) : null}

      {mode === "text" ? (
        <div className="space-y-1.5">
          <Label htmlFor="whatsapp-body" className="sr-only">
            Message
          </Label>
          <Textarea
            id="whatsapp-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Write a WhatsApp message…"
            rows={3}
            maxLength={MAX_WHATSAPP_TEXT_LENGTH + 200}
            disabled={sending}
          />
          <p
            className={cn(
              "text-right text-[11px]",
              textTooLong ? "text-destructive-ink" : "text-muted-foreground",
            )}
          >
            {body.length} / {MAX_WHATSAPP_TEXT_LENGTH}
          </p>
        </div>
      ) : option ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="whatsapp-template">Approved template</Label>
            <select
              id="whatsapp-template"
              value={option.name}
              onChange={(event) => setTemplateName(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              disabled={sending}
            >
              {templates.map((template) => (
                <option key={template.name} value={template.name}>
                  {template.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">{option.description}</p>
          </div>
          {option.parameters.map((parameter, index) => (
            <div key={`${option.name}:${index}`} className="space-y-1">
              <Label htmlFor={`whatsapp-param-${index}`} className="text-xs">
                {parameter.label}
              </Label>
              <Input
                id={`whatsapp-param-${index}`}
                value={parameters[index] ?? ""}
                placeholder={parameter.example}
                disabled={sending}
                onChange={(event) => {
                  const next = [...parameters];
                  next[index] = event.target.value;
                  setEdited((prev) => ({ ...prev, [option.name]: next }));
                }}
              />
            </div>
          ))}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Preview — what the customer will read
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
              {preview}
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={!canSubmit}>
          {sending ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="mr-1.5 size-4" aria-hidden="true" />
          )}
          {sending
            ? "Sending…"
            : mode === "template"
              ? "Send template"
              : "Send WhatsApp"}
        </Button>
      </div>
    </form>
  );
}
