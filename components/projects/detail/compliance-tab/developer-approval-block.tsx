"use client";

import {
  ComplianceApprovalChannel,
  ComplianceApprovalDecision,
  CompliancePartyType,
} from "@prisma/client";
import { Check, Loader2, Send, Stamp, Undo2 } from "lucide-react";

import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import {
  complianceDocumentLabel,
  PARTY_LABEL,
  type DeveloperApprovalDocument,
} from "@/constants/complianceDocuments";
import { developerByKey } from "@/constants/complianceDevelopers";
import { dateFormat } from "@/utils/formatters";
import type {
  ComplianceDeveloperApprovalRecord,
  ComplianceDocumentWithFiles,
  ComplianceOutreachDetail,
} from "@/types/compliance";

/**
 * The estate developer's sign-off, on each document under covenant.
 *
 * A block on the development application rather than a card of its own among
 * the party sections, because that is where it actually bites. A developer
 * approval is not a document being collected — it is one of the things holding
 * the lodgement shut, and a reader working out why the Submit button is grey
 * needs to find it in the same place as the others.
 *
 * Two documents now rather than one, and that is the change. The block was built
 * for the bushfire report alone, on the reading that an estate covenant is about
 * bushfire construction standards; what a covenant actually protects is the house
 * as it will be built, so the full architectural design goes to the developer too.
 * A builder who had the report signed off and lodged against unapproved plans had
 * satisfied half a condition and did not know it.
 *
 * The structure follows from the two being genuinely independent. They are
 * produced by different people and go over weeks or months apart, so each has its
 * own row, its own verdict, its own clock and its own send — and the block is an
 * outer shell that asks the one question common to both ("does this estate need an
 * approval at all") with a panel per document under it. Folding them into one
 * status was what the single verdict column did, and it showed one answer for
 * whichever document had most recently been sent.
 */

/** One document under covenant, as the caller resolves it. */
export type DeveloperApprovalItem = {
  documentType: DeveloperApprovalDocument;
  /** The row being approved. Undefined before it exists at all. */
  document: ComplianceDocumentWithFiles | undefined;
  /** What was asked and what came back, or null before it was put to them. */
  approval: ComplianceDeveloperApprovalRecord | null;
  /**
   * Whether a replacement has landed since a refusal.
   *
   * Resolved by the caller because it needs the revision rounds on a third
   * party's outreach — the bushfire consultant's for the report, the architect's
   * for the plans — which a block about the developer has no business reading.
   */
  hasRevised: boolean;
};

type DeveloperApprovalBlockProps = {
  /** The DEVELOPER outreach, or undefined if nobody has been engaged. */
  outreach: ComplianceOutreachDetail | undefined;
  /** Null while nobody has been asked whether this estate needs one. */
  required: boolean | null;
  /** Who the developer is, where the banner captured them off the list or by hand. */
  developerName: string | null;
  /** The documents under covenant, in the order they are asked for. */
  items: readonly DeveloperApprovalItem[];
  isBusy: boolean;
  pendingDocumentType: DeveloperApprovalDocument | null;
  onSetRequired: (required: boolean) => void;
  onEngage: () => void;
  onDecide: (
    documentType: DeveloperApprovalDocument,
    decision: ComplianceApprovalDecision,
  ) => void;
  onResend: (documentType: DeveloperApprovalDocument) => void;
};

export function DeveloperApprovalBlock({
  outreach,
  required,
  developerName,
  items,
  isBusy,
  pendingDocumentType,
  onSetRequired,
  onEngage,
  onDecide,
  onResend,
}: DeveloperApprovalBlockProps) {
  const estate = developerByKey(outreach?.developerKey)?.estate ?? null;
  /**
   * Who the approval is with, in one name.
   *
   * Read in order of how specifically it names this job: the snapshot on the
   * outreach first — an estate since removed from AREA_DEVELOPERS must still read
   * correctly — then what the banner captured, then the estate, then the generic
   * party label.
   */
  const who =
    outreach?.contactName ??
    developerName ??
    estate ??
    PARTY_LABEL[CompliancePartyType.DEVELOPER];

  return (
    <div className="mt-4 rounded-lg border border-border/70 bg-background p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Stamp className="size-4 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium text-foreground">Developer approval</p>
        <DeveloperStatusPill
          required={required}
          outreach={outreach}
          items={items}
        />
      </div>

      {/* ---------------------------------------------------------------
          Does this estate need one at all.

          Asked before anything else and re-offered afterwards as a quiet
          correction, because it is the one answer here that somebody can give
          wrongly from memory and only find out about when a pack comes back.

          The banner at the top of the tab asks the same question and captures who
          the developer is with it. This stays because the question is reachable
          from both places and the answer is one column — somebody who dismissed
          the banner, or who is correcting it months later from the block that is
          actually blocked, gets the same control where they are standing.
      --------------------------------------------------------------- */}
      {required === null ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Land released in a master-planned estate often carries a covenant
            that the developer approves the plans and the bushfire report before
            anything is lodged. It is on the contract of sale — a title search
            will not say.
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
            Recorded as not needed on this lot. Nothing is waiting on anybody for
            it.
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
      ) : (
        <>
          {/* ---------------------------------------------------------------
              One panel per document.

              Rendered even for a document that does not exist yet, which is
              deliberate: "the architect has not finished the drawings" is the
              answer to why this is not done, and a panel that appears only once
              there is something to send leaves the reader with a gate and no
              account of it.
          --------------------------------------------------------------- */}
          <div className="mt-3 space-y-3">
            {items.map((item) => (
              <DocumentApprovalPanel
                key={item.documentType}
                item={item}
                who={who}
                outreach={outreach}
                isBusy={isBusy}
                isPending={pendingDocumentType === item.documentType}
                onEngage={onEngage}
                onDecide={onDecide}
                onResend={onResend}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One document put to the developer, and wherever it has got to.
 *
 * Four states, and which one shows is read off the approval row rather than off
 * the outreach — which is the whole point of there being a row per document. A
 * developer who has approved the report and said nothing about the plans renders
 * as approved here and as waiting below it, which the single verdict column could
 * not express.
 */
function DocumentApprovalPanel({
  item,
  who,
  outreach,
  isBusy,
  isPending,
  onEngage,
  onDecide,
  onResend,
}: {
  item: DeveloperApprovalItem;
  who: string;
  outreach: ComplianceOutreachDetail | undefined;
  isPending: boolean;
  isBusy: boolean;
  onEngage: () => void;
  onDecide: (
    documentType: DeveloperApprovalDocument,
    decision: ComplianceApprovalDecision,
  ) => void;
  onResend: (documentType: DeveloperApprovalDocument) => void;
}) {
  const { documentType, document, approval, hasRevised } = item;
  const label = complianceDocumentLabel(documentType);
  const lower = label.toLowerCase();
  const hasDocument = Boolean(document && document.files.length > 0);
  const decision = approval?.decision ?? null;

  return (
    <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <DocumentStatusPill item={item} />
        {/* How many times round. Shown only past the first, because "round 1" on
            every panel is noise — what a reader wants to know is that this one has
            been refused before. */}
        {approval && approval.round > 1 ? (
          <StatusPill tone="neutral">Round {approval.round}</StatusPill>
        ) : null}
      </div>

      {!outreach || !approval ? (
        // ---------------------------------------------------------------
        // Needed, and it has not gone to them yet.
        //
        // One branch for "nobody engaged" and "engaged but this document not
        // sent", because from the reader's side they are the same thing: this
        // document is not with the developer, and the button sends it. What
        // differs is only which dispatch the caller makes.
        // ---------------------------------------------------------------
        <>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {hasDocument
              ? `On the file and not yet sent. The developer has to approve the ${lower} before anything is lodged.`
              : `Nothing to send yet — the ${lower} has to be on the file before anybody can approve it.`}
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-2.5"
            disabled={isBusy || !hasDocument}
            onClick={() => (outreach ? onResend(documentType) : onEngage())}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            Send for approval
          </Button>
        </>
      ) : decision === ComplianceApprovalDecision.APPROVED ? (
        <p className="mt-1.5 text-sm text-muted-foreground">
          {who} approved the {lower}
          {approval.decidedAt
            ? ` on ${dateFormat.format(new Date(approval.decidedAt))}`
            : ""}
          {approval.channel === ComplianceApprovalChannel.INBOUND_EMAIL
            ? // Said out loud, because it is the one fact on this block that
              // nobody in the office witnessed. If it is wrong, the thread is
              // one click away on the same tab.
              " — read off their reply on the thread."
            : "."}
        </p>
      ) : decision === ComplianceApprovalDecision.REJECTED ? (
        <>
          <p className="mt-1.5 text-sm text-destructive-ink">
            {who} rejected the {lower}
            {approval.decidedAt
              ? ` on ${dateFormat.format(new Date(approval.decidedAt))}`
              : ""}
            .
          </p>
          {approval.reason ? (
            <blockquote className="mt-2 border-l-2 border-destructive/40 pl-3 text-sm text-muted-foreground">
              {approval.reason}
            </blockquote>
          ) : null}
          <p className="mt-2 text-sm text-muted-foreground">
            {hasRevised
              ? "A revised version has come back. Check it answers the objection, then send it back for approval."
              : `Whoever produced the ${lower} has been sent this and asked to re-issue it. It goes back to the developer once it arrives.`}
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-2.5"
            disabled={isBusy || !hasDocument}
            onClick={() => onResend(documentType)}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            Send back for approval
          </Button>
        </>
      ) : (
        // ---------------------------------------------------------------
        // Sent, and waiting.
        //
        // The clock is `approval.requestedAt` rather than `outreach.sentAt`,
        // which is the correction: the outreach date is when this party joined
        // the job, and the two documents go over months apart.
        // ---------------------------------------------------------------
        <>
          <p className="mt-1.5 text-sm text-muted-foreground">
            With {who}
            {approval.requestedAt
              ? `, sent ${dateFormat.format(new Date(approval.requestedAt))}`
              : ""}
            . Their reply is read off the thread on its own — record it here if
            they answer any other way.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={isBusy}
              onClick={() =>
                onDecide(documentType, ComplianceApprovalDecision.APPROVED)
              }
            >
              {isPending ? (
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
              onClick={() =>
                onDecide(documentType, ComplianceApprovalDecision.REJECTED)
              }
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

/** Where one document is up to, in one word. */
function DocumentStatusPill({ item }: { item: DeveloperApprovalItem }) {
  if (!item.approval) {
    return <StatusPill tone="warning">Not sent</StatusPill>;
  }
  if (item.approval.decision === ComplianceApprovalDecision.APPROVED) {
    return <StatusPill tone="success">Approved</StatusPill>;
  }
  if (item.approval.decision === ComplianceApprovalDecision.REJECTED) {
    return <StatusPill tone="danger">Rejected</StatusPill>;
  }
  return <StatusPill tone="neutral">With the developer</StatusPill>;
}

/**
 * Where the whole block is up to, in one word.
 *
 * Its own function because the mapping is not one-to-one with the panels below
 * it: the pill has to summarise two documents that can be in different states,
 * and the honest summary is the worst of them. A job whose report is approved and
 * whose plans have been refused is a blocked job, and a pill reading "Approved"
 * over that would be the one thing on the card a reader trusted and the one thing
 * that was wrong.
 *
 * Read worst-first for exactly that reason: rejected, then not sent, then waiting,
 * then approved.
 */
function DeveloperStatusPill({
  required,
  outreach,
  items,
}: {
  required: boolean | null;
  outreach: ComplianceOutreachDetail | undefined;
  items: readonly DeveloperApprovalItem[];
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

  const decisions = items.map((item) => item.approval?.decision ?? null);

  if (decisions.includes(ComplianceApprovalDecision.REJECTED)) {
    return <StatusPill tone="danger">Rejected</StatusPill>;
  }
  if (items.some((item) => !item.approval)) {
    return <StatusPill tone="warning">Not sent</StatusPill>;
  }
  if (decisions.includes(null)) {
    return <StatusPill tone="neutral">With the developer</StatusPill>;
  }
  return <StatusPill tone="success">Approved</StatusPill>;
}

/**
 * There is deliberately no `isDeveloperApprovalSettled` here any more.
 *
 * There was one, and the gates read it: a boolean saying whether the covenant was
 * satisfied. It has been replaced by `developerPlansBlockedReason` in
 * types/compliance.ts and `bushfireDeveloperBlockedReason` on the tab, which
 * answer the same question and return the sentence instead.
 *
 * The sentence is the point. A boolean can only grey a button out, and the reader
 * of a grey button with no explanation beside it files a bug report — especially
 * here, where "not settled" covers three quite different situations: nobody has
 * said whether this estate has a covenant, the document is sitting on the
 * developer's desk, or they have refused it and said why. Those want three
 * different next actions, and only the sentence can say which.
 */
