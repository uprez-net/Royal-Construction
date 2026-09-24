"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import {
  Archive,
  ArrowLeft,
  CalendarCheck,
  CalendarDays,
  FileSearch,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  Phone,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  budgetBracket,
  dialablePhone,
  isLostStage,
  isWonStage,
  type BudgetBracket,
} from "@/lib/leads/lead-helpers";
import {
  leadActions,
  offerWorkspaceHref,
  type LeadActionState,
} from "@/lib/leads/lead-actions";
import { bookConsultationUrlForLead } from "@/lib/actions/leads";
import {
  formatE164ForDisplay,
  normaliseLeadPhone,
} from "@/lib/domain/leads/whatsapp/phone";
import type { Lead, LeadStage } from "@/lib/leads/types";
import { compactCurrency, dateFormat } from "@/utils/formatters";
import { StageBadgeSelect } from "./select-stage-badge";
import { leadsListHref } from "@/components/leads/leads-list-url";
import { updateLead } from "@/lib/leads/leads-service";
import { toast } from "sonner";

/** Mono is for facts. A missing value is prose, not a fact. */
const NOT_SET = "Not set";

type DealValue = {
  amount: number;
  /** Where the headline number came from — shown as the caption. */
  caption: string;
  bracket: BudgetBracket | null;
};

/**
 * Resolves the number to headline, in the order the data deserves:
 *
 * 1. `estimatedValue` — the source of truth for money (see Lead in
 *    lib/leads/types.ts), already kept in step with the quoted contract price
 *    by the offer workspace.
 * 2. the midpoint of the budget bracket, when the lead has never been priced.
 * 3. nothing — returns null so the caller drops the block rather than
 *    rendering a $0 that reads like a real valuation.
 */
function resolveDealValue(lead: Lead): DealValue | null {
  const bracket = budgetBracket(lead.budget);
  const recorded = Number(lead.estimatedValue);
  const hasRecorded =
    lead.estimatedValue != null
    && lead.estimatedValue !== ""
    && Number.isFinite(recorded)
    && recorded > 0;

  if (hasRecorded) {
    return {
      amount: recorded,
      caption:
        lead.estimatedValueSource === "OFFER" ? "from offer" : "recorded value",
      bracket,
    };
  }

  if (bracket) {
    return {
      // On the open-ended top bracket this midpoint is derived from the display
      // cap rather than a real ceiling, so it is a weaker number than the ones
      // above it — which is exactly what the caption says it is.
      amount: (bracket.min + bracket.max) / 2,
      caption: "mid-range estimate",
      bracket,
    };
  }

  return null;
}

function LeadDealValuePanel({
  lead,
  action,
}: {
  lead: Lead;
  action: LeadActionState;
}) {
  const router = useRouter();
  const headingId = useId();
  const deal = resolveDealValue(lead);

  // Neither a recorded value nor a readable budget bracket: there is nothing
  // honest to show, so the block is not rendered at all.
  if (!deal) return null;

  const { bracket } = deal;
  const fillPercent = bracket
    ? Math.max(
        0,
        Math.min(
          100,
          ((deal.amount - bracket.min) / (bracket.max - bracket.min)) * 100,
        ),
      )
    : null;
  const rangeLabel = bracket
    ? bracket.isOpenEnded
      ? `${compactCurrency.format(bracket.min)}+`
      : `${compactCurrency.format(bracket.min)} — ${compactCurrency.format(bracket.max)}`
    : null;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border border-border/70 bg-card p-4 shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id={headingId}
          className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase"
        >
          Estimated deal value
        </h2>
      </div>

      <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
        <span className="font-heading text-3xl font-semibold tracking-tight text-foreground tabular-nums">
          {compactCurrency.format(deal.amount)}
        </span>
        <span className="text-xs text-muted-foreground">{deal.caption}</span>
      </p>

      {bracket && fillPercent !== null ? (
        <div className="mt-3 flex items-center gap-3">
          {/* Decorative: the sr-only sentence below states the same position in
              words, which survives better than a bar with an ARIA value. */}
          <div
            aria-hidden="true"
            className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-linear-to-r from-amber-400 to-orange-500"
              style={{ width: `${fillPercent}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
            {rangeLabel}
          </span>
          <span className="sr-only">
            {compactCurrency.format(deal.amount)} sits {Math.round(fillPercent)}
            % through the {rangeLabel} budget range recorded for this lead.
          </span>
        </div>
      ) : null}

      <Button
        type="button"
        onClick={() => router.push(offerWorkspaceHref(lead))}
        disabled={action.disabled}
        title={action.disabledReason ?? undefined}
        className="mt-4 rounded-lg"
      >
        <FileSearch className="mr-2 size-4" aria-hidden="true" />
        Check with Offer
      </Button>
    </section>
  );
}

/**
 * Where a WhatsApp from this page would go, or why it cannot go anywhere —
 * beside the action, so "why is the button disabled?" never needs a tooltip.
 */
function WhatsAppDestination({
  lead,
  reason,
}: {
  lead: Lead;
  reason: string | null;
}) {
  const phone = normaliseLeadPhone(lead.phone);
  return (
    <p className="text-xs text-muted-foreground lg:text-right">
      {reason ? (
        <span>{reason}</span>
      ) : phone.usable ? (
        <>
          WhatsApp to{" "}
          <span className="font-mono tabular-nums text-foreground">
            {formatE164ForDisplay(phone.e164)}
          </span>
        </>
      ) : null}
    </p>
  );
}

function formatCreated(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateFormat.format(parsed);
}

export function LeadHeader({
  lead,
  onArchiveClick,
  onSendTextClick,
  onWhatsAppClick,
  onLeadUpdate,
}: {
  lead: Lead;
  onArchiveClick: () => void;
  /** Opens the email thread (LeadCommModal). */
  onSendTextClick: () => void;
  /** Opens the shared WhatsApp conversation (LeadWhatsAppModal). */
  onWhatsAppClick: () => void;
  onLeadUpdate: (lead: Lead) => void;
}) {
  const router = useRouter();
  // Back to the page of the table this lead was opened from (#350).
  const backToListHref = leadsListHref(useSearchParams().get("list"));
  const { user } = useUser();
  const actions = leadActions(lead);
  const created = formatCreated(lead.created);
  const dialable = dialablePhone(lead.phone ?? "");
  const [isUpdatingStage, setIsUpdatingStage] = useState(false);

  const handleStageChange = async (newStage: LeadStage) => {
    if (newStage === lead.stage) return;
    setIsUpdatingStage(true);
    try {
      const updated = await updateLead(lead.id, { stage: newStage });
      if (!updated) return;
      onLeadUpdate(updated);
      toast.success(`Lead updated to "${newStage}"`);
    } catch (error) {
      console.error("Failed to update lead stage:", error);
      // Surface the server's message. Closing a lead needs a recorded reason,
      // and this control sends a stage and nothing else — so a fixed string
      // here left the user with a failure and no way to understand it.
      toast.error(
        error instanceof Error && error.message.trim()
          ? error.message
          : `Failed to update lead to "${newStage}"`,
      );
    } finally {
      setIsUpdatingStage(false);
    }
  };

  return (
    <section className="rounded-xl border border-border/70 bg-card p-6 px-7 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Link
            href={backToListHref}
            className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to all leads
          </Link>

          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-2xl leading-tight font-semibold tracking-tight text-foreground">
              {lead.name}
            </h1>
            <StageBadgeSelect
              value={lead.stage}
              onChange={handleStageChange}
              disabled={isUpdatingStage}
            />
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

        <div className="flex w-full flex-col gap-4 pt-1 lg:w-96">
          <div className="flex flex-wrap gap-2 lg:justify-end">
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
                Email thread
              </Button>
            ) : null}

            {actions.whatsapp.visible ? (
              <Button
                type="button"
                variant="outline"
                onClick={onWhatsAppClick}
                disabled={actions.whatsapp.disabled}
                title={actions.whatsapp.disabledReason ?? undefined}
                className="h-9 rounded-lg px-3.5 text-sm font-medium"
              >
                <MessageCircle
                  className="mr-1.5 size-4 text-emerald-600"
                  aria-hidden="true"
                />
                WhatsApp
              </Button>
            ) : null}

            {actions.bookMeeting.visible ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void bookConsultationUrlForLead(lead, user?.fullName).then(
                    (href) => router.push(href),
                    () => toast.error("Could not open the booking link."),
                  );
                }}
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
          <WhatsAppDestination lead={lead} reason={actions.whatsapp.disabledReason} />
        </div>
      </div>
      <div className="mt-6 ">
        <LeadDealValuePanel lead={lead} action={actions.checkOffer} />
      </div>
      {/* Status banners, carried over from the modal. */}
      {isWonStage(lead.stage) ? (
        <div className="status-banner status-banner-success mt-5">
          <span className="status-banner-title">Status: {lead.stage}</span>
          <span className="status-banner-text">
            This lead is marked as {lead.stage.toLowerCase()}.
          </span>
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
