"use client";

import { useState } from "react";
import { Loader2, SendHorizontal } from "lucide-react";

import { WA } from "@/components/whatsapp/whatsapp-chat";
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
  // Only a number the operator picked. Otherwise the sender follows the
  // server's current choice, which a poll can change (a reply to another
  // number opens that number's window).
  const [senderOverride, setSenderOverride] = useState<string | null>(null);
  const senderId =
    senderOverride
    ?? eligibility.sender?.phoneNumberId
    ?? senders[0]?.phoneNumberId
    ?? "";

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
            value.trim()
              ? value
              : `[${option.parameters[index]?.label ?? index + 1}]`,
          ),
        )
      : "";

  if (!textAllowed && !templateAllowed) {
    return (
      <div
        role="status"
        className="shrink-0 px-4 py-3 text-center text-[13px]"
        style={{ backgroundColor: WA.panel, color: WA.textMuted }}
      >
        <p className="font-medium text-[#111b21]">
          You can&apos;t send a WhatsApp message to this lead right now.
        </p>
        <p className="mt-0.5">
          {eligibility.template.reason ?? eligibility.text.reason}
        </p>
      </div>
    );
  }

  const senderChoice =
    senders.length > 1
    && senderOverride !== null
    && senderOverride !== eligibility.sender?.phoneNumberId
      ? senderOverride
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
      className="shrink-0 space-y-2 px-3 py-2.5"
      style={{ backgroundColor: WA.panel }}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {textAllowed && templateAllowed ? (
          <div
            className="inline-flex rounded-full bg-white p-0.5 text-xs shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]"
            role="tablist"
            aria-label="Message type"
          >
            {(["text", "template"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => setChosenMode(value)}
                className={cn(
                  "rounded-full px-3 py-1 font-medium transition-colors",
                  mode === value
                    ? "bg-[#d9fdd3] text-[#005c4b]"
                    : "text-[#54656f] hover:text-[#111b21]",
                )}
              >
                {value === "text" ? "Message" : "Template"}
              </button>
            ))}
          </div>
        ) : null}

        {senders.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Label htmlFor="whatsapp-sender" className="text-xs text-[#667781]">
              From
            </Label>
            <select
              id="whatsapp-sender"
              value={senderId}
              onChange={(event) => setSenderOverride(event.target.value)}
              className="h-7 rounded-full border-0 bg-white px-2.5 text-xs shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]"
            >
              {senders.map((sender) => (
                <option key={sender.phoneNumberId} value={sender.phoneNumberId}>
                  {sender.label} ({sender.displayNumber})
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {!textAllowed ? (
          <p className="text-[12px] text-[#667781]">
            {eligibility.text.reason}
          </p>
        ) : null}
      </div>

      {senderChoice ? (
        <p className="text-[12px] text-[#667781]">
          The reply window shown is for {eligibility.sender?.label}; WhatsApp
          checks this number&apos;s own window when you send.
        </p>
      ) : null}

      {mode === "text" ? (
        <div className="flex items-end gap-2">
          <Label htmlFor="whatsapp-body" className="sr-only">
            Message
          </Label>
          <Textarea
            id="whatsapp-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter"
                && !event.shiftKey
                && !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                if (canSubmit) void submit();
              }
            }}
            placeholder="Type a message"
            rows={1}
            maxLength={MAX_WHATSAPP_TEXT_LENGTH + 200}
            disabled={sending}
            className="max-h-36 min-h-[42px] flex-1 resize-none rounded-lg border-0 bg-white px-3.5 py-2.5 text-[15px] leading-5 shadow-none placeholder:text-[#8696a0] focus-visible:ring-2 focus-visible:ring-[#00a884]/40"
          />
          <button
            type="submit"
            disabled={!canSubmit}
            aria-label="Send WhatsApp"
            className="inline-flex size-[42px] shrink-0 items-center justify-center rounded-full text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: WA.accent }}
          >
            {sending ? (
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            ) : (
              <SendHorizontal className="size-5" aria-hidden="true" />
            )}
          </button>
        </div>
      ) : option ? (
        <div className="space-y-3 rounded-lg bg-white p-3 shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
          <div className="space-y-1.5">
            <Label
              htmlFor="whatsapp-template"
              className="text-xs text-[#54656f]"
            >
              Approved template
            </Label>
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
            <p className="text-xs text-muted-foreground">
              {option.description}
            </p>
          </div>
          {option.parameters.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {option.parameters.map((parameter, index) => (
                <div key={`${option.name}:${index}`} className="space-y-1">
                  <Label
                    htmlFor={`whatsapp-param-${index}`}
                    className="text-xs"
                  >
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
            </div>
          ) : null}
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[#667781]">
              What the customer will read
            </p>
            <p
              className="whitespace-pre-wrap rounded-lg rounded-tr-none px-2.5 py-2 text-[14px] leading-[19px] text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]"
              style={{ backgroundColor: WA.bubbleOut }}
            >
              {preview}
            </p>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: WA.accent }}
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <SendHorizontal className="size-4" aria-hidden="true" />
              )}
              {sending ? "Sending…" : "Send template"}
            </button>
          </div>
        </div>
      ) : null}

      {mode === "text" && body.length > MAX_WHATSAPP_TEXT_LENGTH * 0.8 ? (
        <p
          className={cn(
            "text-right text-[11px]",
            textTooLong ? "text-destructive-ink" : "text-[#667781]",
          )}
        >
          {body.length} / {MAX_WHATSAPP_TEXT_LENGTH}
        </p>
      ) : null}
    </form>
  );
}
