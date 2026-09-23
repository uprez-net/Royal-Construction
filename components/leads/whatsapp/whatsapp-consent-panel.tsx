"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, ShieldOff, ShieldQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { WHATSAPP_CONSENT_SOURCE_LABELS } from "@/lib/domain/leads/whatsapp/consent-labels";
import { recordWhatsAppConsent } from "@/lib/leads/whatsapp-service";
import { formatSydneyStamp } from "@/lib/leads/whatsapp-format";
import type { WhatsAppThreadDto } from "@/lib/leads/whatsapp-types";

type Source = keyof typeof WHATSAPP_CONSENT_SOURCE_LABELS;
const SOURCES = Object.keys(WHATSAPP_CONSENT_SOURCE_LABELS) as Source[];

/**
 * Whether this lead agreed to WhatsApp contact, and a way to record or
 * correct it. A valid number is not consent; this record is what allows a
 * template outside the customer-service window.
 */
export function WhatsAppConsentPanel({
  thread,
  onChanged,
}: {
  thread: WhatsAppThreadDto;
  onChanged: () => void;
}) {
  const { consent, optedOut } = thread.eligibility;
  const [editing, setEditing] = useState<"grant" | "opt_out" | null>(null);
  const [source, setSource] = useState<Source>("VERBAL");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(action: "grant" | "opt_out") {
    setSaving(true);
    try {
      await recordWhatsAppConsent(
        thread.lead.id,
        action === "grant"
          ? { action, note: note.trim() || null, source }
          : { action, note: note.trim() || null },
      );
      toast.success(
        action === "grant"
          ? "WhatsApp consent recorded."
          : "Opt-out recorded. No WhatsApp messages will be sent to this lead.",
      );
      setEditing(null);
      setNote("");
      onChanged();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not record consent.",
      );
    } finally {
      setSaving(false);
    }
  }

  const Icon = optedOut ? ShieldOff : consent.recorded ? ShieldCheck : ShieldQuestion;
  const summary = optedOut
    ? `Opted out${thread.lead.optedOutAt ? ` ${formatSydneyStamp(thread.lead.optedOutAt)}` : ""}.`
    : consent.recorded && consent.source
      ? `${WHATSAPP_CONSENT_SOURCE_LABELS[consent.source]} · ${formatSydneyStamp(consent.at)}`
      : "No WhatsApp consent recorded.";

  return (
    <section
      aria-label="WhatsApp consent"
      className="rounded-lg border border-border bg-muted/30 px-3.5 py-3 text-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="flex items-start gap-2">
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            <span className="font-medium">Consent: </span>
            {summary}
            {thread.lead.consentNote ? (
              <span className="block text-xs text-muted-foreground">
                {thread.lead.consentNote}
              </span>
            ) : null}
          </span>
        </p>
        {editing === null ? (
          <div className="flex gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditing("grant")}
            >
              {consent.recorded ? "Update consent" : "Record consent"}
            </Button>
            {!optedOut ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setEditing("opt_out")}
              >
                Record opt-out
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {editing ? (
        <form
          className="mt-3 space-y-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            void save(editing);
          }}
        >
          {editing === "grant" ? (
            <div className="space-y-1">
              <Label htmlFor="whatsapp-consent-source" className="text-xs">
                How did they agree?
              </Label>
              <select
                id="whatsapp-consent-source"
                value={source}
                onChange={(event) => setSource(event.target.value as Source)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {SOURCES.map((value) => (
                  <option key={value} value={value}>
                    {WHATSAPP_CONSENT_SOURCE_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Recording an opt-out blocks every WhatsApp message to this lead,
              including replies, until fresh consent is recorded.
            </p>
          )}
          <div className="space-y-1">
            <Label htmlFor="whatsapp-consent-note" className="text-xs">
              Note (optional)
            </Label>
            <Textarea
              id="whatsapp-consent-note"
              rows={2}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={
                editing === "grant"
                  ? "e.g. Agreed on the call with Sam, 22 Sept"
                  : "e.g. Asked us to email instead"
              }
            />
          </div>
          <div className="flex justify-end gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(null)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              variant={editing === "opt_out" ? "destructive" : "default"}
              disabled={saving}
            >
              {editing === "grant" ? "Save consent" : "Record opt-out"}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
