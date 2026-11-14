"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bot,
  Loader2,
  MonitorSmartphone,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  RefreshCw,
  Smartphone,
  Voicemail,
} from "lucide-react";

import { checkMicrophone } from "@/components/comms/microphone";
import { useOptionalPhone } from "@/components/comms/phone-provider";
import { Button } from "@/components/ui/button";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { formatE164ForDisplay } from "@/lib/domain/leads/whatsapp/phone";
import {
  fetchLeadCalls,
  placeLeadCall,
  recordingUrl,
  retryRecording,
} from "@/lib/leads/comms-service";
import type { CallDto, LeadCallsDto } from "@/lib/leads/comms-types";
import { formatSydneyStamp } from "@/lib/leads/whatsapp-format";

import { CallTranscript } from "./call-transcript";

// Ringing a lead, and every call with them. The server places the call and
// rings the lead first; when they pick up it puts them through to this
// browser (answered automatically) or to the office mobile. Calls the lead
// makes to the business number are answered by Mili, the voice agent, and
// show her transcript.

const POLL_MS = 5_000;

const STATUS_LABEL: Record<CallDto["status"], string> = {
  BUSY: "Busy",
  CANCELED: "Cancelled",
  COMPLETED: "Completed",
  FAILED: "Failed",
  INITIATED: "Dialling",
  IN_PROGRESS: "In progress",
  NO_ANSWER: "No answer",
  QUEUED: "Queued",
  RINGING: "Ringing",
};

const LIVE = new Set<CallDto["status"]>([
  "QUEUED",
  "INITIATED",
  "RINGING",
  "IN_PROGRESS",
]);

function duration(seconds: number | null): string | null {
  if (seconds === null) return null;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function CallIcon({ call }: { call: CallDto }) {
  if (call.answeredBy === "VOICEMAIL")
    return <Voicemail className="size-4 text-amber-600" aria-hidden="true" />;
  if (call.answeredBy === "AGENT")
    return <Bot className="size-4 text-emerald-600" aria-hidden="true" />;
  if (call.direction === "INBOUND") {
    return call.connectedAt ? (
      <PhoneIncoming className="size-4 text-emerald-600" aria-hidden="true" />
    ) : (
      <PhoneMissed className="size-4 text-destructive" aria-hidden="true" />
    );
  }
  return <PhoneOutgoing className="size-4 text-primary" aria-hidden="true" />;
}

function CallRow({
  call,
  onRetried,
}: {
  call: CallDto;
  onRetried: () => void;
}) {
  return (
    <li className="flex flex-col gap-1.5 border-b border-border/60 px-3 py-3 last:border-0">
      <div className="flex items-center gap-2 text-sm">
        <CallIcon call={call} />
        <span className="font-medium text-foreground">
          {call.direction === "INBOUND" ? "Incoming" : "Outgoing"}
        </span>
        <span className="text-muted-foreground">
          · {STATUS_LABEL[call.status]}
        </span>
        {duration(call.durationSeconds) ? (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {duration(call.durationSeconds)}
          </span>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">
          {formatSydneyStamp(call.startedAt)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {call.direction === "OUTBOUND"
          ? `${call.staffName ?? "Staff"} → ${formatE164ForDisplay(call.customerNumber)}${
              call.staffTarget === "MOBILE" ? " (office mobile)" : ""
            }`
          : `From ${call.customerNumber === "withheld" ? "a withheld number" : formatE164ForDisplay(call.customerNumber)}`}
        {call.answeredBy === "AGENT" ? " · answered by Mili" : null}
        {call.recordingConsent === "GRANTED" ? " · recording allowed" : null}
        {call.recordingConsent === "DECLARED"
          ? " · told it was recorded"
          : null}
        {call.recordingConsent === "DECLINED" ? " · not recorded" : null}
      </p>
      <CallTranscript transcript={call.agentTranscript} />
      {call.problem ? (
        <p
          className={
            call.needsReconciliation
              ? "text-xs text-amber-700"
              : "text-xs text-destructive"
          }
        >
          {call.problem}
        </p>
      ) : null}
      {call.recordings.map((recording) => (
        <div key={recording.id} className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            {recording.kind === "VOICEMAIL" ? "Voicemail" : "Recording"}
          </span>
          {recording.available ? (
            <audio
              controls
              preload="none"
              src={recordingUrl(recording.id)}
              className="h-8 max-w-full flex-1"
            />
          ) : recording.status === "FAILED" ? (
            <>
              <span className="text-destructive">
                {recording.failureReason ?? "Couldn't be saved."}
              </span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() =>
                  void retryRecording(recording.id).then(
                    () => {
                      toast.success("Trying the recording again.");
                      onRetried();
                    },
                    (error: unknown) =>
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "Couldn't retry.",
                      ),
                  )
                }
              >
                Retry
              </Button>
            </>
          ) : (
            <span className="text-muted-foreground">Saving…</span>
          )}
        </div>
      ))}
    </li>
  );
}

export function LeadCallsPanel({
  lead,
}: {
  lead: { id: number; name: string };
}) {
  const phone = useOptionalPhone();
  const callKey = useIdempotencyKey();
  const [data, setData] = useState<LeadCallsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState<"browser" | "mobile" | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setData(await fetchLeadCalls(lead.id, signal));
        setError(null);
      } catch (loadError) {
        if (signal?.aborted) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load the calls.",
        );
      }
    },
    [lead.id],
  );

  const hasLiveCall =
    data?.calls.some((call) => LIVE.has(call.status)) ?? false;
  useEffect(() => {
    const controller = new AbortController();
    // Deferred a tick, like the WhatsApp thread: never setState in the effect body.
    const first = window.setTimeout(() => void load(controller.signal), 0);
    const timer = window.setInterval(
      () => void load(),
      hasLiveCall ? 2_000 : POLL_MS * 6,
    );
    return () => {
      window.clearTimeout(first);
      controller.abort();
      window.clearInterval(timer);
    };
  }, [load, hasLiveCall]);

  async function place(target: "browser" | "mobile") {
    if (placing) return;
    if (target === "browser" && phone?.status !== "ready") {
      toast.error(
        phone?.message
          ?? "The browser phone isn't connected yet. Try the office mobile, or wait a moment.",
      );
      return;
    }
    setPlacing(target);
    try {
      if (target === "browser") {
        // Before the customer's phone rings: a blocked microphone found now
        // costs nothing; found after they pick up, they hear silence.
        const micProblem = await checkMicrophone();
        if (micProblem) {
          toast.error(micProblem);
          return;
        }
      }
      const result = await placeLeadCall(lead.id, target, callKey.current());
      callKey.rotate();
      if (target === "browser") {
        // The phone card takes it from here: calling, ringing, connected.
        phone?.expectOutboundCall({
          callId: result.call.id,
          leadName: result.call.leadName ?? lead.name,
        });
      }
      if (result.alreadyPlaced) {
        toast.info("That call was already placed — it wasn't placed again.");
      } else if (target === "mobile") {
        toast.success(
          `Calling ${lead.name}. The office mobile rings when they answer.`,
        );
      }
      void load();
    } catch (placeError) {
      toast.error(
        placeError instanceof Error
          ? placeError.message
          : "The call couldn't be placed.",
      );
      void load();
    } finally {
      setPlacing(null);
    }
  }

  const options = data?.options;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <section className="rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-sm text-muted-foreground">
            {options?.to ? (
              <>
                Call{" "}
                <span className="font-mono font-medium tabular-nums text-foreground">
                  {formatE164ForDisplay(options.to)}
                </span>
              </>
            ) : (
              "Call this lead"
            )}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            onClick={() => void load()}
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Refresh
          </Button>
        </div>
        {options?.browser || options?.mobile ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {options.browser ? (
              <Button
                type="button"
                disabled={!options.allowed || placing !== null}
                onClick={() => void place("browser")}
              >
                {placing === "browser" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <MonitorSmartphone className="size-4" aria-hidden="true" />
                )}
                Call from this browser
              </Button>
            ) : null}
            {options.mobile ? (
              <Button
                type="button"
                variant="outline"
                disabled={!options.allowed || placing !== null}
                onClick={() => void place("mobile")}
              >
                {placing === "mobile" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Smartphone className="size-4" aria-hidden="true" />
                )}
                Call via office mobile
              </Button>
            ) : null}
          </div>
        ) : null}
        {options && !options.allowed ? (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-2.5 py-2 text-sm text-amber-800">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            {options.reason}
          </p>
        ) : null}
        {options?.browser
        && phone
        && phone.status !== "ready"
        && options.allowed ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Browser phone:{" "}
            {phone.status === "connecting"
              ? "connecting…"
              : (phone.message ?? phone.status)}
          </p>
        ) : null}
      </section>

      {error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!data && !error ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading calls…
        </div>
      ) : null}
      {data && data.calls.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-8 text-center">
          <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Phone className="size-4" aria-hidden="true" />
          </span>
          <p className="text-sm font-medium text-foreground">No calls yet</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Calls you place to {lead.name}, and calls they make to the office
            number, show here with recordings and Mili&apos;s transcripts.
          </p>
        </div>
      ) : null}
      {data && data.calls.length > 0 ? (
        <ul className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-background">
          {data.calls.map((call) => (
            <CallRow key={call.id} call={call} onRetried={() => void load()} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
