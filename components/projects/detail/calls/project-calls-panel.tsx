"use client";

import { useEffect, useRef } from "react";
import { Loader2, Phone, PhoneCall, RefreshCw, Sparkles } from "lucide-react";

import {
  CALL_STATUS_LABEL,
  CallIcon,
  callDuration,
  LIVE_CALL_STATUSES,
  recordingNote,
} from "@/components/leads/comms/call-display";
import { CallRecordings } from "@/components/leads/comms/call-recordings";
import { Button } from "@/components/ui/button";
import { formatE164ForDisplay } from "@/lib/domain/leads/whatsapp/phone";
import { markProjectCallsRead } from "@/lib/leads/comms-service";
import type {
  CallDto,
  ProjectCallContactKindDto,
} from "@/lib/leads/comms-types";
import { formatSydneyStamp } from "@/lib/leads/whatsapp-format";
import { cn } from "@/lib/utils";

import { requestProjectDialer } from "./project-calls-events";
import {
  useProjectCalls,
  useRefreshProjectCalls,
} from "./project-calls-queries";

// Every call on a project (ADMIN only): the ones placed from its dialer, and
// the inbound ones Mili or the voicemail took that the matcher filed here.
// Each shows who it was with and their number, its recordings and their
// transcripts, and for a filed call why it was filed here. Opening the log
// reads the new inbound ones, which clears the badge on the Comms tab.

const POLL_MS = 60_000;
const LIVE_POLL_MS = 2_000;

const KIND_LABEL: Record<ProjectCallContactKindDto, string> = {
  OTHER: "Other number",
  OWNER: "Owner",
  SITE_MANAGER: "Site manager",
  TRADIE: "Tradie",
};

function displayNumber(raw: string): string {
  if (raw === "withheld") return "a withheld number";
  return raw.startsWith("+") ? formatE164ForDisplay(raw) : raw;
}

function ProjectCallRow({
  call,
  onRetried,
}: {
  call: CallDto;
  onRetried: () => void;
}) {
  const inbound = call.direction === "INBOUND";
  const who = call.contactName ?? displayNumber(call.customerNumber);
  return (
    <li
      className={cn(
        "flex flex-col gap-1.5 border-b border-border/60 px-3 py-3 last:border-0",
        call.projectUnread && "bg-info-light/40",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <CallIcon call={call} />
        <span className="font-medium text-foreground">{who}</span>
        {call.contactKind ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {KIND_LABEL[call.contactKind]}
          </span>
        ) : null}
        {call.projectUnread ? (
          <span className="rounded-full bg-info px-2 py-0.5 text-[11px] font-semibold text-white">
            New
          </span>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">
          {formatSydneyStamp(call.startedAt)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {inbound ? "Incoming" : "Outgoing"} · {CALL_STATUS_LABEL[call.status]}
        {callDuration(call.durationSeconds) ? (
          <span className="font-mono tabular-nums">
            {" "}
            · {callDuration(call.durationSeconds)}
          </span>
        ) : null}
        {" · "}
        <span className="font-mono tabular-nums">
          {inbound
            ? `from ${displayNumber(call.customerNumber)}`
            : displayNumber(call.customerNumber)}
        </span>
        {!inbound
          ? ` · by ${call.staffName ?? "staff"}${
              call.staffTarget === "MOBILE"
                ? ` via ${call.staffPhoneLabel ?? "office mobile"}`
                : ""
            }`
          : null}
        {call.answeredBy === "AGENT" ? " · answered by Mili" : null}
        {call.answeredBy === "VOICEMAIL" ? " · left a voicemail" : null}
        {recordingNote(call)}
      </p>
      {inbound && call.projectMatchReason ? (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-medium text-foreground">
              Filed on this project:
            </span>{" "}
            {call.projectMatchReason}
          </span>
        </p>
      ) : null}
      {call.problem ? (
        <p
          className={
            call.needsReconciliation
              ? "text-xs text-warning-ink"
              : "text-xs text-destructive"
          }
        >
          {call.problem}
        </p>
      ) : null}
      <CallRecordings call={call} onRetried={onRetried} />
    </li>
  );
}

export function ProjectCallsPanel({ projectId }: { projectId: string }) {
  const refresh = useRefreshProjectCalls(projectId);
  // Polled fast while a call is live, slowly otherwise. React Query owns the
  // requests, so an older response never overwrites a newer list.
  const query = useProjectCalls(projectId, {
    refetchInterval: (calls) =>
      calls?.calls.some((call) => LIVE_CALL_STATUSES.has(call.status))
        ? LIVE_POLL_MS
        : POLL_MS,
  });
  const data = query.data ?? null;
  const error = query.error
    ? query.error instanceof Error
      ? query.error.message
      : "Could not load the calls."
    : null;
  const reload = () => void query.refetch();

  // Reading the new inbound calls waits until they are on screen: a load
  // that fails or never arrives must not clear the badge. Once per project.
  // The rows loaded first still say "New", so the person sees which they were.
  const markedFor = useRef<string | null>(null);
  const loaded = query.isSuccess;
  useEffect(() => {
    if (!loaded || markedFor.current === projectId) return;
    markedFor.current = projectId;
    void markProjectCallsRead(projectId)
      .then(({ marked }) => {
        if (marked > 0) refresh();
      })
      .catch(() => {
        // Not marked: the badge stays, and the next open tries again.
        markedFor.current = null;
      });
  }, [loaded, projectId, refresh]);

  return (
    <div className="flex flex-col gap-3">
      <section className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card p-3 shadow-sm ring-1 ring-foreground/4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Calls</p>
          <p className="text-xs text-muted-foreground">
            Calls placed from this project, and calls Mili took from its owners,
            tradies and site manager.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={reload}
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Refresh
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => requestProjectDialer(projectId)}
          >
            <PhoneCall className="size-4" aria-hidden="true" />
            Open dialer
          </Button>
        </div>
      </section>

      {error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!data && !error ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading calls…
        </div>
      ) : null}
      {data && data.calls.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Phone className="size-4" aria-hidden="true" />
          </span>
          <p className="text-sm font-medium text-foreground">No calls yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Calls you place from this project&apos;s dialer show here with their
            recordings and transcripts, and so do calls Mili takes from the
            people on it.
          </p>
        </div>
      ) : null}
      {data && data.calls.length > 0 ? (
        <ul className="overflow-hidden rounded-xl border border-border bg-background">
          {data.calls.map((call) => (
            <ProjectCallRow key={call.id} call={call} onRetried={reload} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
