"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bot,
  Building2,
  Clock,
  Hash,
  HardHat,
  Inbox,
  Link2,
  MessageSquareText,
  PhoneIncoming,
  PhoneMissed,
  ShieldCheck,
  Smartphone,
  Timer,
  UserRoundX,
  Users,
  Voicemail,
  X,
} from "lucide-react";

import { CallRecordings } from "@/components/leads/comms/call-recordings";
import { callDuration } from "@/components/leads/comms/call-display";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatE164ForDisplay } from "@/lib/domain/leads/whatsapp/phone";
import { fileUnmatchedSms } from "@/lib/leads/comms-service";
import type {
  CallDto,
  SmsMessageDto,
  TeamCallerDto,
} from "@/lib/leads/comms-types";
import { formatSydneyStamp } from "@/lib/leads/whatsapp-format";
import { cn } from "@/lib/utils";

// The admin Phone & SMS page's inbound lists, as cards: texts from numbers no
// lead has (to file or dismiss), calls from numbers no lead has, and calls
// from the team's own numbers under the team member's name.

type Tone = "info" | "success" | "warning" | "danger" | "muted";

const TONE: Record<Tone, { chip: string; disc: string }> = {
  danger: {
    chip: "bg-destructive-light text-destructive-ink",
    disc: "bg-destructive-light text-destructive-ink",
  },
  info: {
    chip: "bg-info-light text-info-ink",
    disc: "bg-info-light text-info-ink",
  },
  muted: {
    chip: "bg-muted text-muted-foreground",
    disc: "bg-muted text-muted-foreground",
  },
  success: {
    chip: "bg-success-light text-success-ink",
    disc: "bg-success-light text-success-ink",
  },
  warning: {
    chip: "bg-warning-light text-warning-ink",
    disc: "bg-warning-light text-warning-ink",
  },
};

function Chip({
  icon: Icon,
  tone = "muted",
  children,
}: {
  icon: React.ElementType;
  tone?: Tone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        TONE[tone].chip,
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {children}
    </span>
  );
}

function Stamp({ at }: { at: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Clock className="size-3" aria-hidden="true" />
      {formatSydneyStamp(at)}
    </span>
  );
}

function displayNumber(raw: string): string {
  if (raw === "withheld") return "Withheld number";
  return raw.startsWith("+") ? formatE164ForDisplay(raw) : raw;
}

/** One section: a tinted icon, a title with its count, and the cards. */
function Section({
  icon: Icon,
  tone,
  title,
  description,
  count,
  empty,
  children,
}: {
  icon: React.ElementType;
  tone: Tone;
  title: string;
  description: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "inline-flex size-10 shrink-0 items-center justify-center rounded-xl",
              TONE[tone].disc,
            )}
          >
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              {title}
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground tabular-nums">
                {count}
              </span>
            </h2>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        {count === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-8 text-center">
            <Inbox
              className="size-5 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-sm text-muted-foreground">{empty}</p>
          </div>
        ) : (
          <ul className="grid gap-3">{children}</ul>
        )}
      </CardContent>
    </Card>
  );
}

/** A row as a card: a status disc, the facts beside it, the detail below. */
function ItemCard({
  icon: Icon,
  tone,
  children,
}: {
  icon: React.ElementType;
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 rounded-xl border border-border bg-background p-3.5 shadow-xs transition-shadow hover:shadow-sm sm:p-4">
      <span
        className={cn(
          "inline-flex size-9 shrink-0 items-center justify-center rounded-full",
          TONE[tone].disc,
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 space-y-2">{children}</div>
    </li>
  );
}

// ── Texts ───────────────────────────────────────────────────────────────

function reasonChip(message: SmsMessageDto) {
  if (message.unmatchedReason === "AMBIGUOUS") {
    return (
      <Chip icon={Users} tone="warning">
        Matches leads {message.candidateLeadIds.join(", ")}
      </Chip>
    );
  }
  if (message.unmatchedReason === "UNKNOWN_BUSINESS_NUMBER") {
    return (
      <Chip icon={AlertTriangle} tone="danger">
        Sent to a number not in COMMS_PHONE_NUMBERS
      </Chip>
    );
  }
  return (
    <Chip icon={UserRoundX} tone="muted">
      No lead has this number
    </Chip>
  );
}

function UnmatchedSmsCard({
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
  const validLead = Number.isSafeInteger(parsedLeadId) && parsedLeadId > 0;
  return (
    <ItemCard icon={MessageSquareText} tone="info">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-sm font-medium tabular-nums">
          {formatE164ForDisplay(message.customerNumber)}
        </span>
        {reasonChip(message)}
        <span className="ml-auto">
          <Stamp at={message.occurredAt} />
        </span>
      </div>
      <p className="rounded-lg rounded-tl-sm bg-muted/60 px-3 py-2 text-sm whitespace-pre-wrap text-foreground">
        {message.body || (
          <span className="text-muted-foreground italic">
            {message.mediaCount > 0
              ? `${message.mediaCount} attachment${message.mediaCount === 1 ? "" : "s"}, no text`
              : "No text"}
          </span>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Hash
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={leadId}
            onChange={(event) =>
              setLeadId(event.target.value.replace(/\D/g, ""))
            }
            placeholder="Lead number"
            inputMode="numeric"
            className="h-8 w-36 pl-7"
            aria-label="Lead number to file onto"
          />
        </div>
        <Button
          type="button"
          size="sm"
          disabled={busy || !validLead}
          onClick={() => void file({ action: "attach", leadId: parsedLeadId })}
        >
          <Link2 className="size-3.5" aria-hidden="true" />
          File onto lead
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          disabled={busy}
          onClick={() => void file({ action: "dismiss" })}
        >
          <X className="size-3.5" aria-hidden="true" />
          Dismiss
        </Button>
      </div>
    </ItemCard>
  );
}

export function UnmatchedTextsSection({
  messages,
  onFiled,
}: {
  messages: readonly SmsMessageDto[];
  onFiled: () => void;
}) {
  return (
    <Section
      icon={MessageSquareText}
      tone="info"
      title="Texts from unknown numbers"
      description="Texts to the business number that no single lead owns. File each onto its lead, or dismiss it."
      count={messages.length}
      empty="Nothing waiting. Every text has found its lead."
    >
      {messages.map((message) => (
        <UnmatchedSmsCard
          key={message.id}
          message={message}
          onFiled={onFiled}
        />
      ))}
    </Section>
  );
}

// ── Calls ───────────────────────────────────────────────────────────────

/** What happened on an inbound call, as an icon, a tone and a word. */
function callOutcome(call: CallDto): {
  icon: React.ElementType;
  tone: Tone;
  label: string;
} {
  if (call.answeredBy === "VOICEMAIL")
    return { icon: Voicemail, label: "Voicemail", tone: "warning" };
  if (call.answeredBy === "AGENT")
    return { icon: Bot, label: "Answered by Mili", tone: "success" };
  if (call.connectedAt)
    return { icon: PhoneIncoming, label: "Answered", tone: "success" };
  return { icon: PhoneMissed, label: "Missed", tone: "danger" };
}

function CallFacts({ call }: { call: CallDto }) {
  const outcome = callOutcome(call);
  const length = callDuration(call.durationSeconds);
  return (
    <>
      <Chip icon={outcome.icon} tone={outcome.tone}>
        {outcome.label}
      </Chip>
      {length ? (
        <Chip icon={Timer}>
          <span className="font-mono tabular-nums">{length}</span>
        </Chip>
      ) : null}
      {call.projectName ? (
        <Chip icon={Building2} tone="info">
          {call.projectName}
        </Chip>
      ) : null}
    </>
  );
}

export function UnknownCallsSection({
  calls,
  onRetried,
}: {
  calls: readonly CallDto[];
  onRetried: () => void;
}) {
  return (
    <Section
      icon={PhoneIncoming}
      tone="warning"
      title="Recent calls from unknown numbers"
      description="Calls to the business number from numbers no single lead owns. Mili's transcript and any recording are on each."
      count={calls.length}
      empty="No calls from unknown numbers."
    >
      {calls.map((call) => {
        const outcome = callOutcome(call);
        return (
          <ItemCard key={call.id} icon={outcome.icon} tone={outcome.tone}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-sm font-medium tabular-nums">
                {displayNumber(call.customerNumber)}
              </span>
              <CallFacts call={call} />
              <span className="ml-auto">
                <Stamp at={call.startedAt} />
              </span>
            </div>
            <CallRecordings call={call} onRetried={onRetried} />
          </ItemCard>
        );
      })}
    </Section>
  );
}

const ROLE_LABEL: Partial<Record<NonNullable<TeamCallerDto["role"]>, string>> =
  {
    ADMIN: "Office",
    SITE_MANAGER: "Site manager",
  };

function callerBadge(caller: TeamCallerDto) {
  if (caller.kind === "office_mobile")
    return (
      <Chip icon={Smartphone} tone="muted">
        Office mobile
      </Chip>
    );
  if (caller.kind === "team_phone")
    return (
      <Chip icon={Smartphone} tone="muted">
        Team phone
      </Chip>
    );
  return (
    <Chip
      icon={caller.role === "SITE_MANAGER" ? HardHat : ShieldCheck}
      tone="info"
    >
      {(caller.role && ROLE_LABEL[caller.role]) ?? "Staff"}
    </Chip>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? "")
    + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")
  ).toUpperCase();
}

export function TeamCallsSection({
  calls,
  onRetried,
}: {
  calls: readonly { call: CallDto; caller: TeamCallerDto }[];
  onRetried: () => void;
}) {
  return (
    <Section
      icon={Users}
      tone="success"
      title="Calls from the team"
      description="Calls to the business number from the team's own phones: staff by the number on their account, the team phones above, and the office mobile. These never wait on the leads page."
      count={calls.length}
      empty="No calls from the team yet."
    >
      {calls.map(({ call, caller }) => (
        <li
          key={call.id}
          className="flex gap-3 rounded-xl border border-border bg-background p-3.5 shadow-xs transition-shadow hover:shadow-sm sm:p-4"
        >
          <span
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
            aria-hidden="true"
          >
            {initials(caller.name) || "?"}
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-semibold text-foreground">
                {caller.name}
              </span>
              {callerBadge(caller)}
              <span className="ml-auto">
                <Stamp at={call.startedAt} />
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {displayNumber(call.customerNumber)}
              </span>
              <CallFacts call={call} />
            </div>
            <CallRecordings call={call} onRetried={onRetried} />
          </div>
        </li>
      ))}
    </Section>
  );
}
