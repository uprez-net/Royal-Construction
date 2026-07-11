"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { OfferPaymentScheduleRow } from "@/lib/offer/workspace-payment-schedule";
import type {
  OfferDocumentDraft,
  OfferWorkspaceJob,
  OfferWorkspaceScopeItem,
  OfferWorkspaceStatus,
} from "@/lib/offer/workspace-model";
import type { OfferCustomerPrice } from "@/lib/offer/workspace-pricing";
import {
  FileSignature,
  FileText,
  Info,
  RotateCcw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import { formatCurrency, formatPercent } from "./offer-workspace-format";
import { PaymentSchedulePanel } from "./offer-workspace-payment-schedule";

type TenderPanelProps = {
  readonly status: OfferWorkspaceStatus;
  readonly job: OfferWorkspaceJob;
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
};

export function TenderPanel({
  status,
  job,
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
}: TenderPanelProps) {
  const isAgreed = status === "agreed";
  const isDraft = status === "tender_draft";
  const isSent = status === "tender_sent";
  // tender_signed and every later status means the Tender is executed.
  const isSigned =
    status === "tender_signed" ||
    status === "contract_draft" ||
    status === "contract_sent" ||
    status === "contract_signed" ||
    status === "project";
  const hasTender = isDraft || isSent || isSigned;

  return (
    <>
      <PaymentSchedulePanel
        customerPrice={customerPrice}
        rows={paymentSchedule}
        onRowsChange={onPaymentScheduleChange}
      />

      <Card className="border-border/70 bg-white/95 shadow-sm">
        <CardHeader className="border-b border-border/70">
          <OfferCardHeading
            description="Generate the fixed-price Tender from the agreed offer, then send it for signature via DocuSign (builder, then customer)."
            icon={<FileText className="size-4" aria-hidden="true" />}
            singleLineDescription
            title="Tender document"
          />
        </CardHeader>
        <CardContent className="grid gap-4 pt-4">
          <TenderStatusBanner
            isAgreed={isAgreed}
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
            isDraft={isDraft}
            isSent={isSent}
            isSigned={isSigned}
            sending={tenderSending}
            sendError={tenderSendError}
            onGenerateTender={onGenerateTender}
            onMarkTenderSigned={onMarkTenderSigned}
            onRecallTender={onRecallTender}
            onSendTender={onSendTender}
          />
        </CardContent>
      </Card>
    </>
  );
}

function TenderStatusBanner({
  isAgreed,
  isDraft,
  isSent,
  isSigned,
}: {
  readonly isAgreed: boolean;
  readonly isDraft: boolean;
  readonly isSent: boolean;
  readonly isSigned: boolean;
}) {
  if (isSigned) {
    return (
      <Banner tone="success">
        Signed by builder and customer. The executed Tender is on file and the
        Contract phase is unlocked below.
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
  isDraft,
  isSent,
  isSigned,
  sending,
  sendError,
  onGenerateTender,
  onSendTender,
  onRecallTender,
  onMarkTenderSigned,
}: {
  readonly isAgreed: boolean;
  readonly isDraft: boolean;
  readonly isSent: boolean;
  readonly isSigned: boolean;
  readonly sending: boolean;
  readonly sendError: string | null;
  readonly onGenerateTender: () => void;
  readonly onSendTender: () => void;
  readonly onRecallTender: () => void;
  readonly onMarkTenderSigned: () => void;
}) {
  if (isSigned) {
    return null;
  }

  return (
    <div className="grid gap-3">
      {isSent ? (
        <SigningTracker />
      ) : (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Sending creates a DocuSign envelope from the generated Tender PDF —
          signature tabs auto-place onto the document&apos;s anchor strings,
          the builder signs first, then the customer. The Connect webhook
          records each signature and files the executed PDF.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {isAgreed ? (
          <Button
            className="bg-royal-gold text-primary-foreground hover:bg-royal-gold-dark"
            size="sm"
            type="button"
            onClick={onGenerateTender}
          >
            <FileText className="size-4" aria-hidden="true" />
            Generate Tender
          </Button>
        ) : null}

        {isDraft ? (
          <Button
            className="bg-royal-gold text-primary-foreground hover:bg-royal-gold-dark"
            disabled={sending}
            size="sm"
            type="button"
            onClick={onSendTender}
          >
            <Send className="size-4" aria-hidden="true" />
            {sending
              ? "Sending envelope…"
              : "Send for signature via DocuSign"}
          </Button>
        ) : null}

        {isSent ? (
          <>
            <Button
              className="bg-royal-gold text-primary-foreground hover:bg-royal-gold-dark"
              size="sm"
              type="button"
              onClick={onMarkTenderSigned}
            >
              <ShieldCheck className="size-4" aria-hidden="true" />
              Mark signed (simulate completion)
            </Button>
            <Button
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

      {sendError ? (
        <p className="text-xs font-medium text-destructive">{sendError}</p>
      ) : null}
    </div>
  );
}

function SigningTracker() {
  return (
    <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/30 p-3 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        DocuSign envelope
      </p>
      {[
        { role: "Builder", detail: "Royal Constructions" },
        { role: "Customer", detail: "signs after the builder" },
      ].map((recipient) => (
        <div
          key={recipient.role}
          className="flex items-center justify-between gap-3"
        >
          <span className="flex items-center gap-2">
            <FileSignature
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="font-medium">{recipient.role}</span>
            <span className="text-muted-foreground">— {recipient.detail}</span>
          </span>
          <span className="rounded-full bg-warning-light px-2 py-0.5 text-xs font-medium text-warning">
            Awaiting signature
          </span>
        </div>
      ))}
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
  const shownExclusions = exclusions
    .filter((item) => item.includedInOfferDocument)
    .map((item) => item.label);
  const exclusionLines =
    draft.exclusionBullets.length > 0
      ? draft.exclusionBullets
      : shownExclusions;
  const stateLabel =
    state === "signed" ? "Executed" : state === "sent" ? "Out for signature" : "Draft";

  return (
    <article className="grid gap-4 rounded-lg border border-border bg-background p-4">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border/70 pb-3">
        <div>
          <p className="font-mono text-xs text-muted-foreground">
            {job.reference}-{job.revision}
          </p>
          <h3 className="font-heading text-lg font-semibold">
            Tender — fixed price building works
          </h3>
          <p className="text-sm text-muted-foreground">
            {job.clientNames} · {job.siteAddress}
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

      <TenderList
        emptyLabel="No inclusions captured yet."
        items={draft.inclusionBullets}
        numbered
        title="Inclusions"
      />
      <TenderList
        emptyLabel="No exclusions listed."
        items={exclusionLines}
        title="Exclusions"
      />

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Payment schedule
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
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground/80">{emptyLabel}</p>
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
