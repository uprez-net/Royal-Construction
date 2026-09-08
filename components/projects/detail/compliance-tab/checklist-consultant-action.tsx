"use client";

import { ComplianceOutreachStatus, CompliancePartyType } from "@prisma/client";
import { Loader2 } from "lucide-react";

import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import {
  PARTY_LABEL,
  PARTY_RESPONSE_BUSINESS_DAYS,
} from "@/constants/complianceDocuments";
import { businessDaysSince } from "@/lib/dates/business-days";
import type { ComplianceOutreachDetail } from "@/types/compliance";

import { PARTY_ICON } from "./party-document-section";

/**
 * The consultant control on one checklist line.
 *
 * A certifier's checklist routinely asks for two things nobody on the job can
 * produce: a BASIX certificate and a bushfire assessment. Before this, both
 * appeared as ordinary rows with an Upload button, which is technically true
 * and practically useless — somebody had to know that the row meant "ring a
 * consultant", find one, email them the plans by hand, and then remember to
 * chase them, with none of it on the file.
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
  onConnect: () => void;
};

export function ChecklistConsultantAction({
  party,
  outreach,
  isSupplied,
  isBusy,
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

  const isEngaged =
    outreach !== undefined &&
    outreach.status !== ComplianceOutreachStatus.NOT_SENT;

  if (!isEngaged) {
    return (
      <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={onConnect}>
        {isBusy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Icon className="size-4" aria-hidden="true" />
        )}
        Connect with {label}
        <span className="sr-only"> for this checklist item</span>
      </Button>
    );
  }

  // Engaged and waiting. The pill says how long, because that is the whole
  // question somebody has about a line they commissioned a fortnight ago — and
  // the alert panel only speaks up once it is genuinely late.
  const sentAt = outreach.sentAt ? new Date(outreach.sentAt) : null;
  const elapsed = sentAt ? businessDaysSince(sentAt) : null;
  const isOverdue =
    elapsed !== null && elapsed > PARTY_RESPONSE_BUSINESS_DAYS[party];

  return (
    <StatusPill tone={isOverdue ? "warning" : "neutral"}>
      {elapsed === null
        ? `${label} engaged`
        : isOverdue
          ? `${label} — ${elapsed} working days`
          : `${label} engaged, day ${elapsed}`}
    </StatusPill>
  );
}
