"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { formatE164ForDisplay } from "@/lib/domain/leads/whatsapp/phone";
import {
  fetchCommsStatus,
  fetchUnmatchedComms,
} from "@/lib/leads/comms-service";
import type {
  CommsStatusDto,
  UnmatchedCommsDto,
} from "@/lib/leads/comms-types";

import {
  TeamCallsSection,
  UnknownCallsSection,
  UnmatchedTextsSection,
} from "./comms-inbound-sections";
import { TeamPhonesCard } from "./team-phones-card";

// Phone & SMS, for the office: what is set up, where each carrier must send
// its webhooks, the texts and calls from numbers no lead has, and the calls
// from the team's own numbers. Secrets are never shown; the server answers
// configuration without them.

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

export function CommsAdminPanel() {
  const [status, setStatus] = useState<CommsStatusDto | null>(null);
  const [unmatched, setUnmatched] = useState<UnmatchedCommsDto | null>(null);
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
      description="Which phone provider is active, the team's phones for lead calls, texts and calls from numbers no lead has, and calls from the team."
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

      <UnmatchedTextsSection
        messages={unmatched?.sms ?? []}
        onFiled={() => void load()}
      />
      <TeamCallsSection
        calls={unmatched?.teamCalls ?? []}
        onRetried={() => void load()}
      />
      <UnknownCallsSection
        calls={unmatched?.calls ?? []}
        onRetried={() => void load()}
      />
    </div>
  );
}
