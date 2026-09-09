"use client";

import {
  ComplianceApprovalChannel,
  ComplianceApprovalDecision,
  CompliancePartyType,
} from "@prisma/client";
import { Check, Loader2, Send, Stamp, Undo2 } from "lucide-react";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { PARTY_LABEL } from "@/constants/complianceDocuments";
import { developerByKey } from "@/constants/complianceDevelopers";
import { dateFormat } from "@/utils/formatters";
import type {
  ComplianceDocumentWithFiles,
  ComplianceOutreachDetail,
} from "@/types/compliance";

/**
 * The estate developer's sign-off on the bushfire report.
 *
 * A block on the development application rather than a card of its own among
 * the party sections, because that is where it actually bites. A developer
 * approval is not a document being collected — it is one of the three things
 * holding the DA lodgement shut, and a reader working out why the Submit button
 * is grey needs to find it in the same place as the other two.
 *
 * Four states, and the block renders whichever the row is on:
 *
 *  - Unanswered. Nobody has said whether this estate needs an approval at all,
 *    which is a question only a person can answer. This is the state that
 *    holds the gate, and it is deliberately first: a job that never asks it
 *    sits with a grey Submit button and no explanation.
 *  - Not required. Answered, and nothing else to do.
 *  - Waiting. The report has gone and there is no verdict yet. The two buttons
 *    here are the manual path — an inbound reply records the same answer on its
 *    own, and this is for the developer who rings up, or replies on a thread
 *    the correlation missed.
 *  - Rejected, or approved. Both terminal-looking and only one of them is: a
 *    rejection is a wait on the consultant, and it turns back into a send once
 *    a revised report is on the file.
 */

type DeveloperApprovalBlockProps = {
  /** The DEVELOPER outreach, or undefined if nobody has been engaged. */
  outreach: ComplianceOutreachDetail | undefined;
  /** Null while nobody has been asked whether this estate needs one. */
  required: boolean | null;
  /** The bushfire row, which is what is being approved. */
  report: ComplianceDocumentWithFiles | undefined;
  /** Whether a revised report has landed since the rejection. */
  hasRevisedReport: boolean;
  isBusy: boolean;
  onSetRequired: (required: boolean) => void;
  onEngage: () => void;
  onDecide: (decision: ComplianceApprovalDecision) => void;
  onResend: () => void;
};

export function DeveloperApprovalBlock({
  outreach,
  required,
  report,
  hasRevisedReport,
  isBusy,
  onSetRequired,
  onEngage,
  onDecide,
  onResend,
}: DeveloperApprovalBlockProps) {
  const estate = developerByKey(outreach?.developerKey)?.estate ?? null;
  // The snapshot on the row rather than the list, for the name: an estate that
  // has since been removed from AREA_DEVELOPERS must still read correctly.
  const who = outreach?.contactName ?? estate ?? PARTY_LABEL[CompliancePartyType.DEVELOPER];

  const hasReport = Boolean(report && report.files.length > 0);
  const decision = outreach?.approvalDecision ?? null;

  return (
    <div className="mt-4 rounded-lg border border-border/70 bg-background p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Stamp className="size-4 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium text-foreground">Developer approval</p>
        <DeveloperStatusPill required={required} outreach={outreach} />
      </div>

      {/* ---------------------------------------------------------------
          Does this estate need one at all.

          Asked before anything else and re-offered afterwards as a quiet
          correction, because it is the one answer here that somebody can give
          wrongly from memory and only find out about when a pack comes back.
      --------------------------------------------------------------- */}
      {required === null ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Land released in a master-planned estate often carries a covenant
            that the developer approves the bushfire report before it is lodged.
            It is on the contract of sale — a title search will not say.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={isBusy}
              onClick={() => onSetRequired(true)}
            >
              {isBusy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              This estate needs it
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isBusy}
              onClick={() => onSetRequired(false)}
            >
              No developer approval needed
            </Button>
          </div>
        </>
      ) : required === false ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Recorded as not needed on this lot. The application is not waiting on
            anybody for it.
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mt-2 text-muted-foreground"
            disabled={isBusy}
            onClick={() => onSetRequired(true)}
          >
            It does need one after all
          </Button>
        </>
      ) : !outreach ? (
        // ---------------------------------------------------------------
        // Needed, and nobody has been asked yet.
        // ---------------------------------------------------------------
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            {hasReport
              ? "The report is on the file. Send it to the estate developer for approval."
              : "Nothing to send yet — the bushfire report has to be on the file before anybody can approve it."}
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-3"
            disabled={isBusy || !hasReport}
            onClick={onEngage}
          >
            <Send className="size-4" aria-hidden="true" />
            Send for developer approval
          </Button>
        </>
      ) : decision === ComplianceApprovalDecision.APPROVED ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {who} approved the report
          {outreach.approvalDecidedAt
            ? ` on ${dateFormat.format(new Date(outreach.approvalDecidedAt))}`
            : ""}
          {outreach.approvalChannel === ComplianceApprovalChannel.INBOUND_EMAIL
            ? // Said out loud, because it is the one fact on this block that
              // nobody in the office witnessed. If it is wrong, the thread is
              // one click away on the same tab.
              " — read off their reply on the thread."
            : "."}
        </p>
      ) : decision === ComplianceApprovalDecision.REJECTED ? (
        <>
          <p className="mt-2 text-sm text-destructive-ink">
            {who} rejected the report
            {outreach.approvalDecidedAt
              ? ` on ${dateFormat.format(new Date(outreach.approvalDecidedAt))}`
              : ""}
            .
          </p>
          {outreach.approvalReason ? (
            <blockquote className="mt-2 border-l-2 border-destructive/40 pl-3 text-sm text-muted-foreground">
              {outreach.approvalReason}
            </blockquote>
          ) : null}
          <p className="mt-2 text-sm text-muted-foreground">
            {hasRevisedReport
              ? "A revised report has come back from the consultant. Check it answers the objection, then send it back for approval."
              : "The bushfire consultant has been sent this and asked to re-issue the report. It goes back to the developer once it arrives."}
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-3"
            disabled={isBusy || !hasReport}
            onClick={onResend}
          >
            <Send className="size-4" aria-hidden="true" />
            Send back for approval
          </Button>
        </>
      ) : (
        // ---------------------------------------------------------------
        // Sent, and waiting.
        // ---------------------------------------------------------------
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            The report is with {who}
            {outreach.sentAt
              ? `, sent ${dateFormat.format(new Date(outreach.sentAt))}`
              : ""}
            . Their reply is read off the thread on its own — record it here if
            they answer any other way.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={isBusy}
              onClick={() => onDecide(ComplianceApprovalDecision.APPROVED)}
            >
              {isBusy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="size-4" aria-hidden="true" />
              )}
              They approved it
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isBusy}
              className="border-destructive/40 text-destructive-ink hover:bg-destructive-light"
              onClick={() => onDecide(ComplianceApprovalDecision.REJECTED)}
            >
              <Undo2 className="size-4" aria-hidden="true" />
              They rejected it
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Where this block is up to, in one word.
 *
 * Its own function because the mapping is not one-to-one with the branches
 * above: "waiting" covers both a row that has just been sent and one whose
 * rejection has been passed to the consultant, and both of those genuinely are
 * waits — on different people, which the body says and a pill cannot.
 */
function DeveloperStatusPill({
  required,
  outreach,
}: {
  required: boolean | null;
  outreach: ComplianceOutreachDetail | undefined;
}) {
  if (required === null) {
    return <StatusPill tone="warning">Needs an answer</StatusPill>;
  }
  if (required === false) {
    return <StatusPill tone="neutral">Not required</StatusPill>;
  }
  if (!outreach) {
    return <StatusPill tone="warning">Not sent</StatusPill>;
  }
  if (outreach.approvalDecision === ComplianceApprovalDecision.APPROVED) {
    return <StatusPill tone="success">Approved</StatusPill>;
  }
  if (outreach.approvalDecision === ComplianceApprovalDecision.REJECTED) {
    return <StatusPill tone="danger">Rejected</StatusPill>;
  }
  return <StatusPill tone="neutral">With the developer</StatusPill>;
}

/**
 * Whether the developer question is settled, for the lodgement gate.
 *
 * Exported and read by the DA section rather than inferred there, because the
 * three ways of being settled do not look alike and getting any of them wrong
 * holds a job shut or lets one through early: the estate does not need an
 * approval, or it does and one has been granted. A rejection is emphatically
 * not settled, and neither is a report sitting on somebody's desk.
 */
export function isDeveloperApprovalSettled(params: {
  required: boolean | null;
  outreach: ComplianceOutreachDetail | undefined;
}): boolean {
  if (params.required === false) return true;
  if (params.required === null) return false;
  return (
    params.outreach?.approvalDecision === ComplianceApprovalDecision.APPROVED
  );
}
