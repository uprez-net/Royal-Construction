"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CallTranscript } from "@/components/leads/comms/call-transcript";
import { formatE164ForDisplay } from "@/lib/domain/leads/whatsapp/phone";
import {
  fetchCommsStatus,
  fetchUnmatchedComms,
  fileUnmatchedSms,
  recordingUrl,
} from "@/lib/leads/comms-service";
import type {
  CallDto,
  CommsStatusDto,
  SmsMessageDto,
} from "@/lib/leads/comms-types";
import { formatSydneyStamp } from "@/lib/leads/whatsapp-format";

import { TeamPhonesCard } from "./team-phones-card";

// Phone & SMS, for the office: what is set up, where each carrier must send
// its webhooks, and the texts and calls from numbers no lead has. Secrets are
// never shown; the server answers configuration without them.

const PROVIDER_LABEL = { telnyx: "Telnyx", twilio: "Twilio" } as const;

function webhooks(status: CommsStatusDto): { label: string; url: string }[] {
  if (!status.webhookOrigin || !status.activeProvider) return [];
  const base = `${status.webhookOrigin}/api/comms/${status.activeProvider}`;
  return status.activeProvider === "twilio"
    ? [
        { label: "Number → Messaging webhook", url: `${base}/sms-inbound` },
        {
          label: "Number → Voice webhook (A call comes in)",
          url: `${base}/voice-inbound`,
        },
        {
          label: "Number → Voice status callback",
          url: `${base}/voice-status`,
        },
      ]
    : [
        { label: "Messaging profile → inbound webhook", url: `${base}/sms` },
        { label: "Call Control application → webhook", url: `${base}/voice` },
      ];
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      {on ? (
        <CheckCircle2 className="size-4 text-success-ink" aria-hidden="true" />
      ) : (
        <XCircle className="size-4 text-muted-foreground" aria-hidden="true" />
      )}
      {label}
      {/* The icons are hidden from screen readers, so say the state too. */}
      <span className="sr-only">{on ? ": on" : ": off"}</span>
    </span>
  );
}

function UnmatchedSmsRow({
  message,
  onFiled,
}: {
  message: SmsMessageDto;
  onFiled: () => void;
}) {
  const [leadId, setLeadId] = useState(
    message.candidateLeadIds[0] ? String(message.candidateLeadIds[0]) : "",
  );
  const [busy, setBusy] = useState(false);
  async function file(
    body: { action: "attach"; leadId: number } | { action: "dismiss" },
  ) {
    setBusy(true);
    try {
      await fileUnmatchedSms(message.id, body);
      toast.success(
        body.action === "attach" ? "Filed onto the lead." : "Dismissed.",
      );
      onFiled();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not file the text.",
      );
    } finally {
      setBusy(false);
    }
  }
  const parsedLeadId = Number(leadId);
  return (
    <li className="flex flex-col gap-2 border-b border-border/60 py-3 last:border-0">
      <div className="flex flex-wrap items-baseline gap-2 text-sm">
        <span className="font-mono tabular-nums">
          {formatE164ForDisplay(message.customerNumber)}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatSydneyStamp(message.occurredAt)}
        </span>
        <span className="text-xs text-muted-foreground">
          {message.unmatchedReason === "AMBIGUOUS"
            ? `matches leads ${message.candidateLeadIds.join(", ")}`
            : message.unmatchedReason === "UNKNOWN_BUSINESS_NUMBER"
              ? "sent to a number not in COMMS_PHONE_NUMBERS"
              : "no lead has this number"}
        </span>
      </div>
      <p className="text-sm whitespace-pre-wrap">{message.body}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={leadId}
          onChange={(event) => setLeadId(event.target.value.replace(/\D/g, ""))}
          placeholder="Lead #"
          inputMode="numeric"
          className="h-8 w-28"
          aria-label="Lead number to file onto"
        />
        <Button
          type="button"
          size="sm"
          disabled={
            busy || !Number.isSafeInteger(parsedLeadId) || parsedLeadId <= 0
          }
          onClick={() => void file({ action: "attach", leadId: parsedLeadId })}
        >
          File onto lead
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void file({ action: "dismiss" })}
        >
          Dismiss
        </Button>
      </div>
    </li>
  );
}

export function CommsAdminPanel() {
  const [status, setStatus] = useState<CommsStatusDto | null>(null);
  const [unmatched, setUnmatched] = useState<{
    sms: SmsMessageDto[];
    calls: CallDto[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextStatus, nextUnmatched] = await Promise.all([
        fetchCommsStatus(),
        fetchUnmatchedComms(),
      ]);
      setStatus(nextStatus);
      setUnmatched(nextUnmatched);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load the phone settings.",
      );
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [load]);

  // Same header as the other admin pages, outside the cards, so it reads the
  // same while loading or failing.
  const header = (
    <PageHeader
      headingLevel="h1"
      title="Phone & SMS"
      description="Which phone provider is active, the team's phones for lead calls, and texts and calls from numbers no lead has."
    />
  );

  if (error) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }
  if (!status) {
    return (
      <div className="space-y-6">
        {header}
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />{" "}
          Loading…
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold">Provider</h2>
            <p className="text-sm text-muted-foreground">
              Active provider:{" "}
              <span className="font-medium text-foreground">
                {status.activeProvider
                  ? PROVIDER_LABEL[status.activeProvider]
                  : "none (misconfigured)"}
              </span>
              . Switch with <code>COMMUNICATIONS_PROVIDER</code>; calls already
              in progress finish on the provider that started them.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Flag
              on={status.smsAvailable}
              label={status.smsEnabled ? "SMS" : "SMS (off)"}
            />
            <Flag
              on={status.callsAvailable}
              label={status.callsEnabled ? "Calls" : "Calls (off)"}
            />
            <Flag on={status.browserCalling} label="Browser phone (outbound)" />
            <Flag on={status.voiceAgent} label="Mili answers inbound calls" />
            <Flag
              on={status.voiceAgentDisclosure}
              label="Mili answers known callers from records"
            />
            <Flag
              on={status.recordingMode === "consented"}
              label="Outbound recording (announced)"
            />
            <Flag
              on={Boolean(status.staffForwardNumber)}
              label="Office mobile fallback"
            />
          </div>
          {status.problems.length > 0 ? (
            <ul className="space-y-1 rounded-md bg-warning-light p-3 text-sm text-warning-ink">
              {status.problems.map((problem) => (
                <li key={problem} className="flex gap-2">
                  <AlertTriangle
                    className="mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  {problem}
                </li>
              ))}
            </ul>
          ) : null}
          <div>
            <h2 className="mb-1 text-sm font-semibold">Numbers</h2>
            {status.numbers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                None configured (COMMS_PHONE_NUMBERS).
              </p>
            ) : (
              <ul className="text-sm">
                {status.numbers.map((number) => (
                  <li key={number.e164}>
                    <span className="font-mono tabular-nums">
                      {formatE164ForDisplay(number.e164)}
                    </span>{" "}
                    · {number.label} · {PROVIDER_LABEL[number.provider]}
                    {number.provider === status.activeProvider
                      ? " (sends)"
                      : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {webhooks(status).length > 0 ? (
            <div>
              <h2 className="mb-1 text-sm font-semibold">
                Webhooks to set at{" "}
                {status.activeProvider
                  ? PROVIDER_LABEL[status.activeProvider]
                  : ""}
              </h2>
              <ul className="space-y-1 text-sm">
                {webhooks(status).map((hook) => (
                  <li key={hook.url}>
                    <span className="text-muted-foreground">{hook.label}:</span>{" "}
                    <code className="break-all">{hook.url}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <TeamPhonesCard officeMobile={status.staffForwardNumber} />

      <Card>
        <CardContent className="p-5">
          <h2 className="text-base font-semibold">
            Texts from unknown numbers
          </h2>
          {unmatched?.sms.length ? (
            <ul>
              {unmatched.sms.map((message) => (
                <UnmatchedSmsRow
                  key={message.id}
                  message={message}
                  onFiled={() => void load()}
                />
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              Nothing waiting.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <h2 className="text-base font-semibold">
            Recent calls from unknown numbers
          </h2>
          {unmatched?.calls.length ? (
            <ul className="mt-2 space-y-1 text-sm">
              {unmatched.calls.map((call) => (
                <li key={call.id}>
                  <span className="font-mono tabular-nums">
                    {call.customerNumber === "withheld"
                      ? "Withheld"
                      : formatE164ForDisplay(call.customerNumber)}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    · {formatSydneyStamp(call.startedAt)} ·{" "}
                    {call.answeredBy === "VOICEMAIL"
                      ? "voicemail"
                      : call.answeredBy === "AGENT"
                        ? "answered by Mili"
                        : call.connectedAt
                          ? "answered"
                          : "missed"}
                  </span>
                  <CallTranscript transcript={call.agentTranscript} />
                  {call.recordings
                    .filter((recording) => recording.available)
                    .map((recording) => (
                      <audio
                        key={recording.id}
                        controls
                        preload="none"
                        src={recordingUrl(recording.id)}
                        className="mt-1 h-8 w-full max-w-sm"
                      />
                    ))}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">None.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
