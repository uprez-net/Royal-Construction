"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { OfferPaymentScheduleRow } from "@/lib/offer/workspace-payment-schedule";
import type {
  OfferDocumentDraft,
  OfferWorkspaceJob,
  OfferWorkspaceStatus,
} from "@/lib/offer/workspace-model";
import type { OfferCustomerPrice } from "@/lib/offer/workspace-pricing";
import { Info, RotateCcw, ScrollText, Send, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import {
  formatCurrency,
  formatOfferReference,
  formatPercent,
} from "./offer-workspace-format";
import { EnvelopeSendConfirm, SigningTracker } from "./offer-workspace-signing";

type ContractPanelProps = {
  readonly status: OfferWorkspaceStatus;
  readonly job: OfferWorkspaceJob;
  readonly customerPrice: OfferCustomerPrice;
  readonly draft: OfferDocumentDraft;
  readonly paymentSchedule: readonly OfferPaymentScheduleRow[];
  readonly onGenerateContract: () => void;
  readonly onSendContract: () => void;
  readonly contractSending?: boolean;
  readonly contractSendError?: string | null;
  readonly onRecallContract: () => void;
  readonly onMarkContractSigned: () => void;
};

export function ContractPanel({
  status,
  job,
  customerPrice,
  draft,
  paymentSchedule,
  onGenerateContract,
  onSendContract,
  contractSending = false,
  contractSendError = null,
  onRecallContract,
  onMarkContractSigned,
}: ContractPanelProps) {
  // The Contract phase begins once the Tender is signed.
  const isTenderSigned = status === "tender_signed";
  const isDraft = status === "contract_draft";
  const isSent = status === "contract_sent";
  const isSigned = status === "contract_signed" || status === "project";
  const hasContract = isDraft || isSent || isSigned;

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="Generate the building Contract from the signed Tender, then send it for signature via DocuSign (builder, then customer)."
          icon={<ScrollText className="size-4" aria-hidden="true" />}
          singleLineDescription
          title="Contract"
        />
      </CardHeader>
      <CardContent className="grid gap-4 pt-4">
        <ContractStatusBanner
          isDraft={isDraft}
          isSent={isSent}
          isSigned={isSigned}
          isTenderSigned={isTenderSigned}
        />

        {hasContract ? (
          <ContractPreview
            customerPrice={customerPrice}
            draft={draft}
            job={job}
            paymentSchedule={paymentSchedule}
            state={isSigned ? "signed" : isSent ? "sent" : "draft"}
          />
        ) : null}

        <ContractActions
          isDraft={isDraft}
          isSent={isSent}
          isSigned={isSigned}
          isTenderSigned={isTenderSigned}
          customerName={job.clientNames}
          contractValueIncGst={customerPrice.selectedContractValueIncGst}
          offerReference={formatOfferReference(job.reference, job.revision)}
          sending={contractSending}
          sendError={contractSendError}
          onGenerateContract={onGenerateContract}
          onMarkContractSigned={onMarkContractSigned}
          onRecallContract={onRecallContract}
          onSendContract={onSendContract}
        />
      </CardContent>
    </Card>
  );
}

function ContractStatusBanner({
  isTenderSigned,
  isDraft,
  isSent,
  isSigned,
}: {
  readonly isTenderSigned: boolean;
  readonly isDraft: boolean;
  readonly isSent: boolean;
  readonly isSigned: boolean;
}) {
  if (isSigned) {
    return (
      <Banner tone="success">
        Signed by builder and customer. The executed Contract is on file — the
        Offer is ready to hand off to Project.
      </Banner>
    );
  }
  if (isSent) {
    return (
      <Banner tone="active">
        Sent for signature via DocuSign — awaiting the builder and customer.
      </Banner>
    );
  }
  if (isDraft) {
    return (
      <Banner tone="active">
        Draft generated from the signed Tender. Review it, then send for
        signature.
      </Banner>
    );
  }
  if (isTenderSigned) {
    return (
      <Banner tone="muted">
        The Tender is signed. Generate the Contract from its data to continue.
      </Banner>
    );
  }
  return null;
}

function ContractActions({
  isTenderSigned,
  isDraft,
  isSent,
  isSigned,
  customerName,
  contractValueIncGst,
  offerReference,
  sending,
  sendError,
  onGenerateContract,
  onSendContract,
  onRecallContract,
  onMarkContractSigned,
}: {
  readonly isTenderSigned: boolean;
  readonly isDraft: boolean;
  readonly isSent: boolean;
  readonly isSigned: boolean;
  readonly customerName: string;
  readonly contractValueIncGst: number;
  readonly offerReference: string;
  readonly sending: boolean;
  readonly sendError: string | null;
  readonly onGenerateContract: () => void;
  readonly onSendContract: () => void;
  readonly onRecallContract: () => void;
  readonly onMarkContractSigned: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (isSigned) {
    return null;
  }

  return (
    <div className="grid gap-3">
      {isSent ? (
        <SigningTracker
          recipients={[
            {
              role: "Builder",
              detail: "Royal Constructions",
              state: "awaiting",
            },
            {
              role: "Customer",
              detail: customerName || "signs after the builder",
              state: "waiting_for_prior",
            },
          ]}
        />
      ) : (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Sending creates a DocuSign envelope from the MBA BC4 contract
          template, pre-filled from the signed Tender. The builder signs first
          (completing any open particulars), then the customer. The Connect
          webhook records signatures and files the executed contract.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {isTenderSigned ? (
          <Button
            className="bg-royal-gold text-primary-foreground hover:bg-royal-gold-dark"
            size="sm"
            type="button"
            onClick={onGenerateContract}
          >
            <ScrollText className="size-4" aria-hidden="true" />
            Generate Contract
          </Button>
        ) : null}

        {isDraft ? (
          <Button
            className="bg-royal-gold text-primary-foreground hover:bg-royal-gold-dark"
            disabled={sending || confirming}
            size="sm"
            type="button"
            onClick={() => setConfirming(true)}
          >
            <Send className="size-4" aria-hidden="true" />
            {sending ? "Sending envelope…" : "Send for signature via DocuSign"}
          </Button>
        ) : null}

        {isSent ? (
          <>
            <Button
              className="bg-royal-gold text-primary-foreground hover:bg-royal-gold-dark"
              size="sm"
              type="button"
              onClick={onMarkContractSigned}
            >
              <ShieldCheck className="size-4" aria-hidden="true" />
              Mark signed (simulate completion)
            </Button>
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={onRecallContract}
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              Recall envelope
            </Button>
          </>
        ) : null}
      </div>

      {isDraft && confirming ? (
        <EnvelopeSendConfirm
          documentName="Contract"
          recipientName={customerName}
          valueLabel="Contract sum inc GST"
          value={contractValueIncGst}
          reference={offerReference}
          sending={sending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            onSendContract();
            setConfirming(false);
          }}
        />
      ) : null}

      {sendError ? (
        <p className="text-xs font-medium text-destructive">{sendError}</p>
      ) : null}
    </div>
  );
}

function ContractPreview({
  job,
  customerPrice,
  draft,
  paymentSchedule,
  state,
}: {
  readonly job: OfferWorkspaceJob;
  readonly customerPrice: OfferCustomerPrice;
  readonly draft: OfferDocumentDraft;
  readonly paymentSchedule: readonly OfferPaymentScheduleRow[];
  readonly state: "draft" | "sent" | "signed";
}) {
  const contractSum = customerPrice.selectedContractValueIncGst;
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
          <h3 className="font-heading text-lg font-semibold">
            Building Contract
          </h3>
          <p className="text-sm text-muted-foreground">
            Incorporates the executed Tender for {job.siteAddress}.
          </p>
        </div>
        <span className="rounded-full border border-royal-gold/40 bg-royal-gold-light/40 px-2.5 py-1 text-xs font-medium text-royal-gold-dark">
          {stateLabel}
        </span>
      </header>

      <dl className="grid gap-3 sm:grid-cols-2">
        <PartyBlock label="Builder" value="Royal Constructions Pty Ltd" />
        <PartyBlock label="Customer" value={job.clientNames} />
        <PartyBlock label="Site" value={job.siteAddress} />
        <PartyBlock label="Prepared by" value={job.preparedBy} />
      </dl>

      <div className="rounded-lg bg-royal-gold-light/30 px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Contract sum inc GST
        </p>
        <p className="font-heading text-2xl font-semibold">
          {formatCurrency(contractSum)}
        </p>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Progress payments
        </p>
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
                    {formatCurrency(contractSum * row.percentOfContract)}
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
        {draft.termsSummary} Scope, inclusions and exclusions are as set out in
        the executed Tender.
      </p>

      <div className="grid gap-2 border-t border-border/70 pt-3 sm:grid-cols-2">
        <SignatureLine
          role="Builder"
          state={state === "signed" ? "signed" : "pending"}
        />
        <SignatureLine
          role="Customer"
          state={state === "signed" ? "signed" : "pending"}
        />
      </div>
    </article>
  );
}

function PartyBlock({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm font-medium">{value || "—"}</dd>
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
  readonly tone: "active" | "success" | "muted";
}) {
  const toneClass =
    tone === "success"
      ? "border-success/30 bg-success-light text-foreground"
      : tone === "active"
        ? "border-royal-gold/30 bg-royal-gold-light/40 text-foreground"
        : "border-border bg-muted/40 text-muted-foreground";

  return (
    <p className={`rounded-lg border px-3 py-2.5 text-sm ${toneClass}`}>
      {children}
    </p>
  );
}
