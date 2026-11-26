"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Bot,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { StatusPill } from "@/components/common/status-pill";
import { CallRecordings } from "@/components/leads/comms/call-recordings";
import { callDuration } from "@/components/leads/comms/call-display";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  cancelAgentCall,
  fetchAgentCall,
  fetchAgentCalls,
} from "@/lib/leads/comms-service";
import type {
  AgentCallEventDto,
  OwnerCallDetailDto,
  OwnerCallDto,
} from "@/lib/leads/comms-types";
import { formatSydneyStamp } from "@/lib/leads/whatsapp-format";

// Admin → Agent calls: the calls Mili makes to the owner because Hermes asked.
// What is still to ring (soonest first, with Cancel), then the most recent,
// each opening onto its briefing, its transcript and recording, and every
// event: when it was scheduled and placed, each lookup and question Mili
// passed to Hermes with its answer, and how the call ended.

const CATEGORY: Record<string, string> = {
  alert: "Alert",
  calendar_reminder: "Calendar reminder",
  other: "Other",
  project_brief: "Project brief",
  task_update: "Task update",
};

type Tone = "info" | "success" | "warning" | "danger" | "neutral";

function statusOf(call: OwnerCallDto): { label: string; tone: Tone } {
  switch (call.status) {
    case "SCHEDULED":
      return { label: "Scheduled", tone: "info" };
    case "PLACING":
      return { label: "Ringing", tone: "info" };
    case "CANCELED":
      return { label: "Cancelled", tone: "neutral" };
    case "FAILED":
      return { label: "Failed", tone: "danger" };
    case "PLACED": {
      const leg = call.call;
      if (!leg) return { label: "Placed", tone: "info" };
      if (leg.needsReconciliation) {
        return { label: "Check carrier", tone: "warning" };
      }
      if (leg.status === "IN_PROGRESS") {
        return { label: "On the call", tone: "info" };
      }
      if (leg.answered) return { label: "Answered", tone: "success" };
      if (["NO_ANSWER", "BUSY", "CANCELED", "FAILED"].includes(leg.status)) {
        return { label: "Not answered", tone: "warning" };
      }
      return { label: "Ringing", tone: "info" };
    }
  }
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** One event, as a line a person reads. */
function describeEvent(event: AgentCallEventDto): {
  title: string;
  body: string | null;
} {
  const d = event.detail ?? {};
  const text = (key: string) =>
    typeof d[key] === "string" ? (d[key] as string) : null;
  switch (event.kind) {
    case "owner_call.requested":
      return { body: text("subject"), title: "Asked to call now" };
    case "owner_call.scheduled":
      return {
        body: `For ${formatSydneyStamp(text("callAt"))}`,
        title: "Scheduled",
      };
    case "owner_call.placed":
      return { body: text("to"), title: "Rang the owner line" };
    case "owner_call.deferred":
      return { body: text("reason"), title: "Waiting" };
    case "owner_call.failed":
      return { body: text("reason"), title: "Failed" };
    case "owner_call.canceled":
      return { body: `By ${text("by") ?? "someone"}`, title: "Cancelled" };
    case "session.started":
      return {
        body:
          Array.isArray(d.lookups) && d.lookups.length
            ? `Could look up: ${(d.lookups as string[]).join(", ")}`
            : "Briefing only",
        title: "Mili picked up the call",
      };
    case "desk.lookup": {
      const args = (d.args ?? {}) as Record<string, unknown>;
      const asked = Object.values(args).filter((v) => typeof v === "string");
      const name = text("name") ?? "lookup";
      const ms =
        typeof d.ms === "number" ? ` · ${(d.ms / 1000).toFixed(1)} s` : "";
      return {
        body: d.answered
          ? `${asked.length ? `“${asked.join(" ")}” → ` : ""}${text("answer") ?? ""}`
          : `${asked.length ? `“${asked.join(" ")}” · ` : ""}not answered (${text("failure") ?? "failed"})`,
        title: `${name === "ask_hermes" ? "Asked Hermes" : `Looked up ${name}`}${ms}`,
      };
    }
    case "desk.end_call":
      return { body: null, title: "Desk ended the call" };
    case "desk.transfer":
      return { body: text("reason"), title: "Desk asked to transfer" };
    case "desk.failed":
      return { body: text("error"), title: "Call desk didn't answer" };
    case "session.ended": {
      const seconds = typeof d.seconds === "number" ? `${d.seconds} s` : null;
      return {
        body: [
          text("outcome"),
          seconds,
          typeof d.turns === "number" ? `${d.turns} turns` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        title: "Mili's session ended",
      };
    }
    default:
      return { body: null, title: event.kind };
  }
}

function AgentCallDetail({
  ownerCallId,
  onChanged,
  version,
}: {
  ownerCallId: string;
  onChanged: () => void;
  /** Bumped each time the list loads, so an open call reloads with it. */
  version: number;
}) {
  const [detail, setDetail] = useState<OwnerCallDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await fetchAgentCall(ownerCallId));
      setError(null);
    } catch (loadError) {
      setError(message(loadError, "Could not load the agent call."));
    }
  }, [ownerCallId]);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [load, version]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!detail) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading…
      </p>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Briefing
          </h3>
          {detail.agenda.length ? (
            <ol className="list-decimal space-y-0.5 pl-5 text-sm">
              {detail.agenda.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ol>
          ) : null}
          {detail.context ? (
            <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-sm text-muted-foreground">
              {detail.context}
            </p>
          ) : null}
          {detail.eventAt ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Event: {formatSydneyStamp(detail.eventAt)}
            </p>
          ) : null}
        </section>
        {detail.callRecord ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Transcript and recording
            </h3>
            <CallRecordings
              call={detail.callRecord}
              // The list reloading bumps `version`, which reloads this too.
              onRetried={onChanged}
              openTranscripts
            />
          </section>
        ) : null}
      </div>
      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          What happened
        </h3>
        {detail.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ol className="space-y-2 border-l border-border pl-3">
            {detail.events.map((event) => {
              const line = describeEvent(event);
              return (
                <li key={event.id} className="text-sm">
                  <p className="font-medium">
                    {line.title}{" "}
                    <span className="text-xs font-normal text-muted-foreground tabular-nums">
                      {formatSydneyStamp(event.occurredAt)}
                    </span>
                  </p>
                  {line.body ? (
                    <p className="whitespace-pre-wrap break-words text-muted-foreground">
                      {line.body}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}

function AgentCallRow({
  call,
  onChanged,
  version,
}: {
  call: OwnerCallDto;
  onChanged: () => void;
  version: number;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const status = statusOf(call);
  const leg = call.call;

  async function cancel() {
    if (busy) return;
    setBusy(true);
    try {
      await cancelAgentCall(call.id);
      toast.success("Call cancelled.");
      onChanged();
    } catch (cancelError) {
      toast.error(message(cancelError, "Could not cancel the call."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="border-b border-border/60 py-3 last:border-0">
      <div className="flex items-start gap-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? (
            <ChevronDown className="mt-1 size-4 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="mt-1 size-4 shrink-0" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {call.subject}
            </span>
            <span className="block text-xs text-muted-foreground">
              {CATEGORY[call.category] ?? call.category} ·{" "}
              {call.status === "SCHEDULED" ? "rings " : ""}
              <span className="tabular-nums">
                {formatSydneyStamp(call.placedAt ?? call.callAt)}
              </span>
              {leg?.durationSeconds
                ? ` · ${callDuration(leg.durationSeconds)}`
                : ""}
              {call.questionsAsked
                ? ` · ${call.questionsAsked} question${call.questionsAsked === 1 ? "" : "s"} to Hermes`
                : ""}
            </span>
            {call.failureReason ? (
              <span className="block text-xs text-destructive">
                {call.failureReason}
              </span>
            ) : null}
          </span>
        </button>
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
        {call.status === "SCHEDULED" ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={busy}
            onClick={() => void cancel()}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <X className="size-3.5" aria-hidden="true" />
            )}
            Cancel
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="mt-3 pl-7">
          <AgentCallDetail
            ownerCallId={call.id}
            onChanged={onChanged}
            version={version}
          />
        </div>
      ) : null}
    </li>
  );
}

function Section({
  title,
  icon,
  empty,
  calls,
  onChanged,
  version,
}: {
  title: string;
  icon: React.ReactNode;
  empty: string;
  calls: OwnerCallDto[];
  onChanged: () => void;
  version: number;
}) {
  return (
    <Card>
      <CardContent className="space-y-2 p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          {icon}
          {title}
          <span className="text-sm font-normal text-muted-foreground tabular-nums">
            {calls.length}
          </span>
        </h2>
        {calls.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
            {empty}
          </p>
        ) : (
          <ul>
            {calls.map((call) => (
              <AgentCallRow
                key={call.id}
                call={call}
                onChanged={onChanged}
                version={version}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function AgentCallsPanel() {
  const [lists, setLists] = useState<{
    pending: OwnerCallDto[];
    recent: OwnerCallDto[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setLists(await fetchAgentCalls());
      setVersion((value) => value + 1);
      setError(null);
    } catch (loadError) {
      setError(message(loadError, "Could not load the agent calls."));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        headingLevel="h1"
        title="Agent calls"
        description="Calls Mili makes to the owner because Hermes asked: what is scheduled, and each call's transcript, recording and what she looked up."
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={() => void load()}
          >
            <RefreshCw
              className={refreshing ? "size-4 animate-spin" : "size-4"}
              aria-hidden="true"
            />
            Refresh
          </Button>
        }
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!lists && !error ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading…
        </p>
      ) : null}
      {lists ? (
        <>
          <Section
            title="Pending"
            icon={<CalendarClock className="size-4" aria-hidden="true" />}
            empty="Nothing scheduled. Hermes schedules calls through the operations agent."
            calls={lists.pending}
            onChanged={() => void load()}
            version={version}
          />
          <Section
            title="Recent"
            icon={<Bot className="size-4" aria-hidden="true" />}
            empty="No calls yet."
            calls={lists.recent}
            onChanged={() => void load()}
            version={version}
          />
        </>
      ) : null}
    </div>
  );
}
