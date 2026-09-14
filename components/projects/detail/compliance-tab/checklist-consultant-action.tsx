"use client";

import { ComplianceOutreachStatus, CompliancePartyType } from "@prisma/client";
import { Loader2 } from "lucide-react";

import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import {
  PARTY_LABEL,
  PARTY_RESPONSE_BUSINESS_DAYS,
  WASTE_MANAGEMENT_BUSINESS_DAYS,
} from "@/constants/complianceDocuments";
import { businessDaysSince } from "@/lib/dates/business-days";
import type { ComplianceOutreachDetail } from "@/types/compliance";

import { PARTY_ICON } from "./party-document-section";

/**
 * The consultant control on one checklist line.
 *
 * A certifier's checklist routinely asks for things nobody on the job can
 * produce: a BASIX certificate, a bushfire assessment, structural and hydraulic
 * drawings, a geotechnical report, water servicing approvals, a traffic control
 * plan, a waste management plan. Before this they all appeared as ordinary rows
 * with an Upload button, which is technically true and practically useless —
 * somebody had to know that the row meant "ring a consultant", find one, email
 * them the plans by hand, and then remember to chase them, with none of it on
 * the file.
 *
 * So a line the extraction labelled as asking for one of those gets the same
 * treatment the surveyor and the architect already had: a connect control, a
 * thread, and a clock. The Upload button stays beside it, because a client who
 * already commissioned a BASIX certificate last month should not have to
 * pretend otherwise.
 *
 * Which consultant a line needs comes from `detail.mapsToType`, set by the
 * extraction. A line it could not label offers nothing here, which is the right
 * failure: an unlabelled row is an ordinary row, not a wrong one.
 */

type ChecklistConsultantActionProps = {
  party: CompliancePartyType;
  /** This party's outreach on the file, if anybody has engaged them. */
  outreach: ComplianceOutreachDetail | undefined;
  /** Whether this line already has a document on it. */
  isSupplied: boolean;
  isBusy: boolean;
  /**
   * Whether this row waits on its own request rather than on the engagement.
   *
   * The waste management plan, and only it. The architect has been engaged
   * since the plans were commissioned, so their `sentAt` is months old and a
   * pill read off it would say "day 47" on a plan requested this morning — and
   * the alert behind it measures from the request too.
   *
   * A flag of its own rather than the presence of `requestedAt`, which is the
   * correction. `null` is what that prop holds until somebody asks, and it is
   * also what it holds on every other row, so a value test could not tell
   * "nobody has asked yet" from "this row is not about a request". It read the
   * architect's outreach instead, found it SENT, and decided the plan had been
   * asked for — so the row rendered "Architect asked, day 47" and the button
   * that actually sends the request never appeared on any job.
   */
  tracksOwnRequest?: boolean;
  /** When it was asked for, where `tracksOwnRequest` is set. */
  requestedAt?: Date | string | null;
  /**
   * What the button says, where "Connect with…" is wrong.
   *
   * Again the waste management plan: the architect is on the file already, and
   * offering to connect with them is offering to do something that has
   * happened.
   */
  actionLabel?: string;
  onConnect: () => void;
};

export function ChecklistConsultantAction({
  party,
  outreach,
  isSupplied,
  isBusy,
  tracksOwnRequest = false,
  requestedAt,
  actionLabel,
  onConnect,
}: ChecklistConsultantActionProps) {
  const label = PARTY_LABEL[party];
  const Icon = PARTY_ICON[party];

  // Nothing to say once the document is in. The row shows the file, the thread
  // is on the Show threads button, and a pill saying somebody was engaged is
  // noise beside a line that is finished.
  if (isSupplied) {
    return null;
  }

  /**
   * Whether the thing on this row has actually been asked for.
   *
   * Two readings, because two things can be waited on. Ordinarily it is the
   * engagement: a bushfire assessor either has been written to or has not. For
   * the waste management plan the architect was engaged long ago and the
   * question is whether anybody has asked them for this — so where a request
   * date is passed, that is what decides it, and the button stays on offer
   * until somebody presses it.
   */
  const askedAt = tracksOwnRequest
    ? requestedAt
      ? new Date(requestedAt)
      : null
    : outreach && outreach.status !== ComplianceOutreachStatus.NOT_SENT
      ? (outreach.sentAt ?? null)
      : null;
  const isAsked = tracksOwnRequest
    ? requestedAt !== null && requestedAt !== undefined
    : outreach !== undefined &&
      outreach.status !== ComplianceOutreachStatus.NOT_SENT;

  if (!isAsked) {
    return (
      <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={onConnect}>
        {isBusy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Icon className="size-4" aria-hidden="true" />
        )}
        {actionLabel ?? `Connect with ${label}`}
        <span className="sr-only"> for this checklist item</span>
      </Button>
    );
  }

  // Asked and waiting. The pill says how long, because that is the whole
  // question somebody has about a line they commissioned a fortnight ago — and
  // the alert panel only speaks up once it is genuinely late.
  const elapsed = askedAt ? businessDaysSince(new Date(askedAt)) : null;
  // The waste management plan has a threshold of its own, and it is read here
  // rather than folded into the party table so the pill and the nightly sweep
  // measure the same wait against the same number.
  const threshold = tracksOwnRequest
    ? WASTE_MANAGEMENT_BUSINESS_DAYS
    : PARTY_RESPONSE_BUSINESS_DAYS[party];
  const isOverdue = elapsed !== null && elapsed > threshold;

  return (
    <StatusPill tone={isOverdue ? "warning" : "neutral"}>
      {elapsed === null
        ? `${label} asked`
        : isOverdue
          ? `${label} — ${elapsed} working days`
          : `${label} asked, day ${elapsed}`}
    </StatusPill>
  );
}
