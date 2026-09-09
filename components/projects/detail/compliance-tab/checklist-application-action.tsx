"use client";

import { ComplianceExternalApplicationKind } from "@prisma/client";
import { ExternalLink, Landmark } from "lucide-react";

import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { EXTERNAL_APPLICATION_COPY } from "@/constants/complianceDocuments";
import { businessDaysSince } from "@/lib/dates/business-days";
import {
  externalApplicationStep,
  type ComplianceExternalApplicationRecord,
} from "@/types/compliance";

/**
 * The control on a checklist line asking for something bought, not asked for.
 *
 * Three of the documents a certifier's checklist routinely names have nobody to
 * commission them from: a road opening and vehicle crossing approval, a long
 * service levy receipt, and a mine subsidence approval. Before this they were
 * ordinary rows with an Upload button, which is technically true and practically
 * useless — somebody had to already know that the row meant "go to the Long
 * Service Corporation and pay 0.25% of the construction cost", find the site,
 * and then remember to come back.
 *
 * So the row gets what the council certificate has had since the pipeline work:
 * a link to the right page, a recorded lodgement date, and a clock the nightly
 * sweep can raise an alert against. The difference is only the shape — the
 * council block has a card to itself, and this is one line of a twenty-line
 * list, so the state machine lives behind a button.
 */

type ChecklistApplicationActionProps = {
  kind: ComplianceExternalApplicationKind;
  /** This application on the file, if anybody has started it. */
  application: ComplianceExternalApplicationRecord | null;
  /** Whether this line already has a document on it. */
  isSupplied: boolean;
  /** The portal link, where it depends on the project's council. */
  portalUrl?: string | null;
  onRecord: () => void;
};

export function ChecklistApplicationAction({
  kind,
  application,
  isSupplied,
  portalUrl,
  onRecord,
}: ChecklistApplicationActionProps) {
  const copy = EXTERNAL_APPLICATION_COPY[kind];
  const url = portalUrl ?? copy.url;

  // Nothing to say once the document is in. The row shows the file, and a pill
  // about an application that has landed is noise beside a finished line.
  if (isSupplied) {
    return null;
  }

  const step = externalApplicationStep(application);

  // Lodged and waiting. The pill says how long, because that is the whole
  // question somebody has about an application they paid for a fortnight ago —
  // and the alert panel only speaks up once it is genuinely late.
  if (step === "lodged" && application?.appliedAt) {
    const elapsed = businessDaysSince(new Date(application.appliedAt));
    const isOverdue = elapsed > copy.businessDays;

    return (
      <div className="flex items-center gap-2">
        <StatusPill tone={isOverdue ? "warning" : "neutral"}>
          {elapsed === 0
            ? "Lodged today"
            : isOverdue
              ? `Lodged — ${elapsed} working days`
              : `Lodged, day ${elapsed}`}
        </StatusPill>
        <Button type="button" variant="ghost" size="sm" onClick={onRecord}>
          Update
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {/* The link first. Somebody who has never done this one before needs the
          page more than they need the form, and the form is meaningless until
          they have been. */}
      {url ? (
        <Button asChild type="button" variant="ghost" size="sm">
          <a href={url} target="_blank" rel="noopener noreferrer">
            {copy.portal}
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </Button>
      ) : null}
      <Button type="button" variant="outline" size="sm" onClick={onRecord}>
        <Landmark className="size-4" aria-hidden="true" />
        Record application
        <span className="sr-only"> for this checklist item</span>
      </Button>
    </div>
  );
}
