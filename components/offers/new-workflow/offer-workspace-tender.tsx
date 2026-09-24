"use client";

import { Button } from "@/components/ui/button";
import type { LifecycleAction } from "@/lib/offer/lifecycle-busy";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  getPaymentScheduleTotalPct,
  type OfferPaymentScheduleRow,
} from "@/lib/offer/workspace-payment-schedule";
import {
  collectOfferSigners,
  formatOwnerNamesLine,
  offerSignerLabel,
  type OfferDocumentDraft,
  type OfferWorkspaceJob,
  type OfferWorkspaceScopeItem,
  type OfferWorkspaceStatus,
} from "@/lib/offer/workspace-model";
import type { OfferCustomerPrice } from "@/lib/offer/workspace-pricing";
import { getVisibleExclusions } from "@/lib/offer/workspace-print-template";
import { FileText, Info, RotateCcw, Send, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import {
  formatCurrency,
  formatOfferReference,
  formatPercent,
} from "./offer-workspace-format";
import { PaymentSchedulePanel } from "./offer-workspace-payment-schedule";
import {
  builderSignerState,
  findSignerStatus,
  signerStateFromStatus,
  type OfferSignerStatus,
} from "@/lib/offer/signing-status";
import { EnvelopeSendConfirm, SigningTracker } from "./offer-workspace-signing";
import { GROUP_HEADING_CLASS } from "./offer-workspace-fields";
import { cn } from "@/lib/utils";

type TenderPanelProps = {
  readonly status: OfferWorkspaceStatus;
  readonly job: OfferWorkspaceJob;
  // Per-recipient DocuSign status from the Connect webhook (#121/#123).
  readonly signerStatuses: readonly OfferSignerStatus[];
  readonly customerPrice: OfferCustomerPrice;
  readonly draft: OfferDocumentDraft;
  readonly exclusions: readonly OfferWorkspaceScopeItem[];
  readonly paymentSchedule: readonly OfferPaymentScheduleRow[];
  readonly onPaymentScheduleChange: (
    rows: readonly OfferPaymentScheduleRow[],
  ) => void;
  readonly onGenerateTender: () => void;
  readonly onSendTender: () => void;
  readonly tenderSending?: boolean;
  readonly tenderSendError?: string | null;
  readonly onRecallTender: () => void;
  readonly onMarkTenderSigned: () => void;
  // The lifecycle action running, or null. Every lifecycle button disables
  // while one runs, since the workspace would drop the click.
  readonly lifecycleBusy: LifecycleAction | null;
};

export function TenderPanel({
  status,
  job,
  signerStatuses,
  customerPrice,
  draft,
  exclusions,
  paymentSchedule,
  onPaymentScheduleChange,
  onGenerateTender,
  onSendTender,
  tenderSending = false,
  tenderSendError = null,
  onRecallTender,
  onMarkTenderSigned,
  lifecycleBusy,
}: TenderPanelProps) {
  const isAgreed = status === "agreed";
  const isDraft = status === "tender_draft";
  const isSent = status === "tender_sent";
  // The customer declined this tender; it is read-only until the operator forks
  // a new revision (autosave is frozen in this state, so edits wouldn't persist).
  const isDeclined = status === "tender_declined";
  // A fixed-price Tender's progress payments must sum to exactly 100% of the
  // contract; block sending (and warn) when the schedule is unbalanced.
  const scheduleTotalPct = getPaymentScheduleTotalPct(paymentSchedule);
  const scheduleBalanced = scheduleTotalPct === 1;
  // tender_signed and every later status means the Tender is executed.
  const isSigned =
    status === "tender_signed"
    || status === "contract_draft"
    || status === "contract_sent"
    || status === "contract_signed"
    || status === "project";
  const hasTender = isDraft || isSent || isSigned;

  return (
    <>
      <PaymentSchedulePanel
        customerPrice={customerPrice}
        rows={paymentSchedule}
        onRowsChange={onPaymentScheduleChange}
        locked={isSent || isSigned || isDeclined}
      />

      <Card className="border-border/70 bg-white/95 shadow-sm">
        <CardHeader className="border-b border-border/70">
          <OfferCardHeading
            description="Generate the fixed-price Tender from the agreed offer, then send it for signature via DocuSign (customer, then builder)."
            icon={<FileText className="size-4" aria-hidden="true" />}
            singleLineDescription
            title="Tender document"
          />
        </CardHeader>
        <CardContent className="grid gap-4">
          <TenderStatusBanner
            isAgreed={isAgreed}
            isDeclined={isDeclined}
            isDraft={isDraft}
            isSent={isSent}
            isSigned={isSigned}
          />

          {hasTender ? (
            <TenderPreview
              customerPrice={customerPrice}
              draft={draft}
              exclusions={exclusions}
              job={job}
              paymentSchedule={paymentSchedule}
              state={isSigned ? "signed" : isSent ? "sent" : "draft"}
            />
          ) : null}

          <TenderActions
            isAgreed={isAgreed}
            isDeclined={isDeclined}
            isDraft={isDraft}
            isSent={isSent}
            isSigned={isSigned}
            customerName={
              formatOwnerNamesLine(job.owners ?? []) || job.clientNames
            }
            signers={collectOfferSigners(job.owners ?? []).map((s) => ({
              label: offerSignerLabel(s),
              email: s.signatory.email,
            }))}
            signerStatuses={signerStatuses}
            contractValueIncGst={customerPrice.selectedContractValueIncGst}
            offerReference={formatOfferReference(job.reference, job.revision)}
            scheduleBalanced={scheduleBalanced}
            scheduleTotalPct={scheduleTotalPct}
            sending={tenderSending}
            sendError={tenderSendError}
            onGenerateTender={onGenerateTender}
            onMarkTenderSigned={onMarkTenderSigned}
            onRecallTender={onRecallTender}
            onSendTender={onSendTender}
            lifecycleBusy={lifecycleBusy}
          />
        </CardContent>
      </Card>
    </>
  );
}

function TenderStatusBanner({
  isAgreed,
  isDeclined,
  isDraft,
  isSent,
  isSigned,
}: {
  readonly isAgreed: boolean;
  readonly isDeclined: boolean;
  readonly isDraft: boolean;
  readonly isSent: boolean;
  readonly isSigned: boolean;
}) {
  if (isDeclined) {
    return (
      <Banner tone="warning">
        The customer declined this Tender. Create a new version to revise and
        re-send.
      </Banner>
    );
  }
  if (isSigned) {
    return (
      <Banner tone="success">
        Signed by the customer and builder. The executed Tender is on file and
        the Contract phase is unlocked below.
      </Banner>
    );
  }
  if (isSent) {
    return (
      <Banner tone="active">
        Sent for signature via DocuSign — awaiting the customer, then the
        builder.
      </Banner>
    );
  }
  if (isDraft) {
    return (
      <Banner tone="active">
        Draft generated. Review the Tender below, then send it for signature.
      </Banner>
    );
  }
  if (isAgreed) {
    return (
      <Banner tone="muted">
        Confirm the payment schedule above, then generate the Tender from the
        agreed offer.
      </Banner>
    );
  }
  return null;
}

function TenderActions({
  isAgreed,
  isDeclined,
  isDraft,
  isSent,
  isSigned,
  customerName,
  signers,
  signerStatuses,
  contractValueIncGst,
  offerReference,
  scheduleBalanced,
  scheduleTotalPct,
  sending,
  sendError,
  onGenerateTender,
  onSendTender,
  onRecallTender,
  onMarkTenderSigned,
  lifecycleBusy,
}: {
  readonly isAgreed: boolean;
  readonly isDeclined: boolean;
  readonly isDraft: boolean;
  readonly isSent: boolean;
  readonly isSigned: boolean;
  readonly customerName: string;
  // Every customer signer (individual owners + company directors), the exact
  // DocuSign recipient set. The email is what joins a row to its persisted
  // EnvelopeSignature — labels are not unique, emails are (enforced by
  // collectOwnerIssues).
  readonly signers: readonly {
    readonly label: string;
    readonly email: string;
  }[];
  // Per-recipient status from the Connect webhook. Empty before the envelope is
  // sent, in which case rows fall back to their routing-derived state.
  readonly signerStatuses: readonly OfferSignerStatus[];
  readonly contractValueIncGst: number;
  readonly offerReference: string;
  readonly scheduleBalanced: boolean;
  readonly scheduleTotalPct: number;
  readonly sending: boolean;
  readonly sendError: string | null;
  readonly onGenerateTender: () => void;
  readonly onSendTender: () => void;
  readonly onRecallTender: () => void;
  readonly onMarkTenderSigned: () => void;
  readonly lifecycleBusy: LifecycleAction | null;
}) {
  const [confirming, setConfirming] = useState(false);

  // Signed and declined tenders are terminal in this panel — a declined tender
  // is revised via "New version" at the workspace level, not from here.
  if (isSigned || isDeclined) {
    return null;
  }

  return (
    <div className="grid gap-3">
      {isSent ? (
        <SigningTracker
          recipients={[
            // One row per customer signer (all sign in parallel), then the
            // builder counter-signs — mirroring the real envelope. Each row's
            // state is the RECIPIENT'S actual DocuSign status; it was previously
            // hard-coded to "awaiting", so the tracker still said "Awaiting
            // signature" after everyone had signed (#121/#123).
            ...(signers.length > 0
              ? signers
              : [{ label: customerName || "signs first", email: "" }]
            ).map((signer) => {
              const persisted = findSignerStatus(
                signerStatuses,
                "TENDER",
                signer.email,
              );
              return {
                role: "Customer" as const,
                detail: signer.label,
                // No persisted row means the envelope predates this signer (or
                // has not been sent); the honest state is still "awaiting".
                state: persisted
                  ? signerStateFromStatus(persisted.status)
                  : ("awaiting" as const),
              };
            }),
            {
              role: "Builder",
              detail: "Royal Constructions",
              // The tender routes customer-first, so the builder is queued
              // behind them until every customer has signed.
              state: builderSignerState(signerStatuses, "TENDER"),
              waitingLabel: "Signs after the customer",
            },
          ]}
        />
      ) : (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Sending creates a DocuSign envelope from the generated Tender PDF —
          signature tabs auto-place onto the document&apos;s anchor strings, the
          customer signs first, then the builder counter-signs. The Connect
          webhook records each signature and files the executed PDF.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {isAgreed ? (
          <Button
            aria-busy={lifecycleBusy === "tender_draft" || undefined}
            disabled={lifecycleBusy !== null}
            size="sm"
            type="button"
            variant="royal"
            onClick={onGenerateTender}
          >
            <FileText className="size-4" aria-hidden="true" />
            Generate Tender
          </Button>
        ) : null}

        {isDraft ? (
          <Button
            disabled={sending || confirming || !scheduleBalanced}
            size="sm"
            type="button"
            variant="royal"
            onClick={() => setConfirming(true)}
          >
            <Send className="size-4" aria-hidden="true" />
            {sending ? "Sending envelope…" : "Send for signature via DocuSign"}
          </Button>
        ) : null}

        {isSent ? (
          <>
            {/* Local-development testing aid only: the real signed state comes
                from the DocuSign completion webhook. Hidden in staging/prod so
                it can't manufacture a CONTRACT_SIGNED offer with no executed
                PDF (issue #90); the server action also rejects it there. */}
            {process.env.NODE_ENV === "development" ? (
              <Button
                aria-busy={lifecycleBusy === "tender_signed" || undefined}
                disabled={lifecycleBusy !== null}
                size="sm"
                type="button"
                variant="royal"
                onClick={onMarkTenderSigned}
              >
                <ShieldCheck className="size-4" aria-hidden="true" />
                Mark signed (simulate completion)
              </Button>
            ) : null}
            <Button
              aria-busy={lifecycleBusy === "recall-tender" || undefined}
              disabled={lifecycleBusy !== null}
              size="sm"
              type="button"
              variant="outline"
              onClick={onRecallTender}
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              Recall envelope
            </Button>
          </>
        ) : null}
      </div>

      {isDraft && confirming ? (
        <EnvelopeSendConfirm
          customerFirst
          documentName="Tender"
          recipientName={customerName}
          valueLabel="Contract value inc GST"
          value={contractValueIncGst}
          reference={offerReference}
          sending={sending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            onSendTender();
            setConfirming(false);
          }}
        />
      ) : null}

      {isDraft && !scheduleBalanced ? (
        <p className="text-xs font-medium text-destructive">
          Payment schedule totals {Math.round(scheduleTotalPct * 100)}% — adjust
          the stages above to total 100% before sending the Tender.
        </p>
      ) : null}

      {sendError ? (
        <p className="text-xs font-medium text-destructive">{sendError}</p>
      ) : null}
    </div>
  );
}

function TenderPreview({
  job,
  customerPrice,
  draft,
  exclusions,
  paymentSchedule,
  state,
}: {
  readonly job: OfferWorkspaceJob;
  readonly customerPrice: OfferCustomerPrice;
  readonly draft: OfferDocumentDraft;
  readonly exclusions: readonly OfferWorkspaceScopeItem[];
  readonly paymentSchedule: readonly OfferPaymentScheduleRow[];
  readonly state: "draft" | "sent" | "signed";
}) {
  const contractValue = customerPrice.selectedContractValueIncGst;
  // Render every signer from owners[] (the exact DocuSign recipient set) — not
  // the legacy primary/secondary projection, which showed a company owner as one
  // "Customer — <company>" line and dropped its directors.
  const ownerNamesLine =
    formatOwnerNamesLine(job.owners ?? []) || job.clientNames;
  const signers = collectOfferSigners(job.owners ?? []);
  // Same resolver the tender PDF uses. This previously treated the draft
  // bullets as an OVERRIDE that suppressed the Scope items, so the on-screen
  // tender showed a shorter exclusion list than the document it represents.
  const exclusionLines = getVisibleExclusions(draft, exclusions);
  const stateLabel =
    state === "signed"
      ? "Executed"
      : state === "sent"
        ? "Out for signature"
        : "Draft";

  return (
    <article className="grid gap-4 rounded-lg border border-border bg-background p-4">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border/70 pb-3">
        <div>
          <p className="font-mono text-xs text-muted-foreground">
            {formatOfferReference(job.reference, job.revision)}
          </p>
          <h4 className="font-heading text-lg font-semibold">
            Tender — fixed price building works
          </h4>
          <p className="text-sm text-muted-foreground">
            {ownerNamesLine} · {job.siteAddress}
          </p>
        </div>
        <span className="rounded-full border border-royal-gold/40 bg-royal-gold-light/40 px-2.5 py-1 text-xs font-medium text-royal-gold-dark">
          {stateLabel}
        </span>
      </header>

      <div className="rounded-lg bg-royal-gold-light/30 px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Contract value inc GST
        </p>
        <p className="font-heading text-2xl font-semibold">
          {formatCurrency(contractValue)}
        </p>
      </div>

      {/* The tender PDF prints the Inclusions Schedule, not the Investment
          Summary bullets — this showed the bullets and so misrepresented the
          document. */}
      <TenderList
        emptyLabel="No inclusions captured yet. Add them in the inclusion schedule on the Offer document step."
        items={draft.inclusionSchedule.map((entry) => entry.spec)}
        numbered
        title="Inclusions"
      />
      <TenderList
        emptyLabel="No exclusions listed."
        items={exclusionLines}
        title="Exclusions"
      />

      <div>
        <p className={cn("mb-2", GROUP_HEADING_CLASS)}>Payment schedule</p>
        <div className="overflow-hidden rounded-lg border border-border/70">
          <table className="w-full text-[13px]">
            <tbody>
              {paymentSchedule.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border/60 last:border-b-0"
                >
                  <td className="px-3 py-1.5 font-medium">{row.stageName}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                    {formatPercent(row.percentOfContract)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    {formatCurrency(contractValue * row.percentOfContract)}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {row.trigger}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Valid until {job.validUntil || "—"}. {draft.termsSummary}
      </p>

      <div className="grid gap-2 border-t border-border/70 pt-3 sm:grid-cols-2">
        {/* Customer first, then builder — matches the Tender PDF / DocuSign order. */}
        {signers.length > 0 ? (
          signers.map((signer) => (
            <SignatureLine
              key={`${signer.ownerIndex}-${signer.signerIndex}`}
              role={`Customer — ${offerSignerLabel(signer)}`}
              state={state === "signed" ? "signed" : "pending"}
            />
          ))
        ) : (
          <SignatureLine
            role="Customer"
            state={state === "signed" ? "signed" : "pending"}
          />
        )}
        <SignatureLine
          role="Builder"
          state={state === "signed" ? "signed" : "pending"}
        />
      </div>
    </article>
  );
}

function TenderList({
  items,
  title,
  emptyLabel,
  numbered = false,
}: {
  readonly items: readonly string[];
  readonly title: string;
  readonly emptyLabel: string;
  readonly numbered?: boolean;
}) {
  return (
    <div>
      <p className={cn("mb-2", GROUP_HEADING_CLASS)}>{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ol className="grid gap-1.5 text-[13px]">
          {items.map((item, index) => (
            <li key={item} className="flex gap-2">
              <span className="shrink-0 font-mono text-muted-foreground">
                {numbered ? `${index + 1}.` : "•"}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function SignatureLine({
  role,
  state,
}: {
  readonly role: string;
  readonly state: "pending" | "signed";
}) {
  return (
    <div className="text-sm">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {role}
      </p>
      {state === "signed" ? (
        <p className="flex items-center gap-1.5 font-medium text-success">
          <ShieldCheck className="size-4" aria-hidden="true" />
          Signed via DocuSign
        </p>
      ) : (
        <p className="text-muted-foreground/80">
          Signature: ____________________
        </p>
      )}
    </div>
  );
}

function Banner({
  children,
  tone,
}: {
  readonly children: React.ReactNode;
  readonly tone: "active" | "success" | "muted" | "warning";
}) {
  const toneClass =
    tone === "success"
      ? "border-success/30 bg-success-light text-foreground"
      : tone === "active"
        ? "border-royal-gold/30 bg-royal-gold-light/40 text-foreground"
        : tone === "warning"
          ? "border-warning/40 bg-warning-light text-foreground"
          : "border-border bg-muted/40 text-muted-foreground";

  return (
    <p className={`rounded-lg border px-3 py-2.5 text-sm ${toneClass}`}>
      {children}
    </p>
  );
}
