"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import {
  Archive,
  ArrowLeft,
  CalendarCheck,
  CalendarDays,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  STAGE_STYLES,
  dialablePhone,
  isLostStage,
} from "@/lib/leads/lead-helpers";
import { bookConsultationHref, leadActions } from "@/lib/leads/lead-actions";
import type { Lead } from "@/lib/leads/types";
import { dateFormat } from "@/utils/formatters";

/** Mono is for facts. A missing value is prose, not a fact. */
const NOT_SET = "Not set";

function formatCreated(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateFormat.format(parsed);
}

export function LeadHeader({
  lead,
  onArchiveClick,
  onSendTextClick,
}: {
  lead: Lead;
  onArchiveClick: () => void;
  onSendTextClick: () => void;
}) {
  const router = useRouter();
  const { user } = useUser();
  const actions = leadActions(lead);
  const created = formatCreated(lead.created);
  const dialable = dialablePhone(lead.phone ?? "");

  return (
    <section className="rounded-xl border border-border/70 bg-card p-6 px-7 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Link
            href="/leads"
            className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to all leads
          </Link>

          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-2xl leading-tight font-semibold tracking-tight text-foreground">
              {lead.name}
            </h1>
            <span className={`stage-badge ${STAGE_STYLES[lead.stage]}`}>
              {lead.stage}
            </span>
            {lead.urgent ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive-light px-3 py-1 text-xs font-medium text-destructive-ink">
                <span
                  aria-hidden="true"
                  className="inline-block size-2 animate-pulse rounded-full bg-rose-600"
                />
                Urgent
              </span>
            ) : null}
            {lead.isArchived ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                <Archive className="size-3.5" aria-hidden="true" />
                Archived
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" aria-hidden="true" />
              {lead.location || NOT_SET}
            </span>
            <span aria-hidden="true">|</span>
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              Created{" "}
              {created ? (
                <span className="font-mono tabular-nums">{created}</span>
              ) : (
                NOT_SET
              )}
            </span>
            <span aria-hidden="true">|</span>
            <span className="inline-flex items-center gap-1">
              <UserRound className="size-3.5" aria-hidden="true" />
              {lead.assignedUser?.name ?? "Unassigned"}
            </span>
          </div>

          <p className="flex flex-wrap items-center gap-2 pt-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Phone className="size-3.5" aria-hidden="true" />
              {dialable ? (
                <a
                  href={`tel:${dialable}`}
                  className="rounded-md font-mono tabular-nums text-primary transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {lead.phone}
                </a>
              ) : (
                NOT_SET
              )}
            </span>
            <span aria-hidden="true">|</span>
            <span className="inline-flex items-center gap-1">
              <Mail className="size-3.5" aria-hidden="true" />
              {lead.email ? (
                <a
                  href={`mailto:${lead.email}`}
                  className="rounded-md text-primary transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {lead.email}
                </a>
              ) : (
                NOT_SET
              )}
            </span>
            <span aria-hidden="true">|</span>
            <span>Source {lead.sourceDetail || lead.source || NOT_SET}</span>
          </p>

          {lead.secondaryName ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground/80">
              <UserRound className="size-3.5" aria-hidden="true" />+{" "}
              {lead.secondaryName}
              {lead.secondaryEmail ? ` · ${lead.secondaryEmail}` : ""}
              {lead.secondaryPhone ? ` · ${lead.secondaryPhone}` : ""}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {actions.sendText.visible ? (
            <Button
              type="button"
              variant="outline"
              onClick={onSendTextClick}
              disabled={actions.sendText.disabled}
              title={actions.sendText.disabledReason ?? undefined}
              className="h-9 rounded-lg px-3.5 text-sm font-medium"
            >
              <MessageSquare className="mr-1.5 size-4" aria-hidden="true" />
              Send Text
            </Button>
          ) : null}

          {actions.bookMeeting.visible ? (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                router.push(bookConsultationHref(lead, user?.fullName))
              }
              disabled={actions.bookMeeting.disabled}
              title={actions.bookMeeting.disabledReason ?? undefined}
              className="h-9 rounded-lg px-3.5 text-sm font-medium"
            >
              <CalendarCheck className="mr-1.5 size-4" aria-hidden="true" />
              Book Meeting
            </Button>
          ) : null}

          {actions.archive.visible ? (
            <Button
              type="button"
              variant="destructive"
              onClick={onArchiveClick}
              disabled={actions.archive.disabled}
              title={actions.archive.disabledReason ?? undefined}
              className="h-9 rounded-lg px-3.5 text-sm font-medium"
            >
              <Archive className="mr-1.5 size-4" aria-hidden="true" />
              Delete Lead
            </Button>
          ) : null}
        </div>
      </div>

      {/* Status banners, carried over from the modal. */}
      {lead.stage === "Won" ? (
        <div className="status-banner status-banner-success mt-5">
          <span className="status-banner-title">Status: Won</span>
          <span className="status-banner-text">This lead is marked as won.</span>
        </div>
      ) : null}
      {isLostStage(lead.stage) ? (
        <div className="status-banner status-banner-danger mt-5">
          <span className="status-banner-title">Status: {lead.stage}</span>
          <span className="status-banner-text">
            {lead.lostReason
              ? `Reason: ${lead.lostReason}`
              : "Add a lost reason in the Overview tab."}
          </span>
        </div>
      ) : null}
    </section>
  );
}
