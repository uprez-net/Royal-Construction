"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { OfferPaymentScheduleRow } from "@/lib/offer/workspace-payment-schedule";
import {
  collectOfferSigners,
  collectOfferSignerLabels,
  formatOwnerNamesLine,
  offerSignerLabel,
  type OfferDocumentDraft,
  type OfferWorkspaceJob,
  type OfferWorkspaceStatus,
} from "@/lib/offer/workspace-model";
import type { OfferCustomerPrice } from "@/lib/offer/workspace-pricing";
import {
  CONTRACT_PARTICULAR_FIELDS,
  missingRecommendedParticulars,
  type ContractParticularGroup,
  type ContractParticulars,
} from "@/lib/offer/contract-particulars";
import {
  AlertTriangle,
  Info,
  RotateCcw,
  ScrollText,
  Send,
  ShieldCheck,
} from "lucide-react";
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
  readonly contractParticulars: ContractParticulars;
  readonly onContractParticularsChange: (
    patch: Partial<ContractParticulars>,
  ) => void;
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
  contractParticulars,
  onContractParticularsChange,
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
  // The customer declined this contract; it is read-only until the operator
  // forks a new revision (the particulars form is frozen in this state too).
  const isDeclined = status === "contract_declined";
  const hasContract = isDraft || isSent || isSigned || isDeclined;

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="Generate the building Contract from the signed Tender, capture the BC4 particulars, then send it for signature via DocuSign (customer, then builder)."
          icon={<ScrollText className="size-4" aria-hidden="true" />}
          singleLineDescription
          title="Contract"
        />
      </CardHeader>
      <CardContent className="grid gap-4 pt-4">
        <ContractStatusBanner
          isDeclined={isDeclined}
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

        {hasContract ? (
          <ContractParticularsForm
            editable={isDraft}
            particulars={contractParticulars}
            onChange={onContractParticularsChange}
          />
        ) : null}

        <ContractActions
          isDeclined={isDeclined}
          isDraft={isDraft}
          isSent={isSent}
          isSigned={isSigned}
          isTenderSigned={isTenderSigned}
          customerName={formatOwnerNamesLine(job.owners ?? []) || job.clientNames}
          signerLabels={collectOfferSignerLabels(job.owners ?? [])}
          contractValueIncGst={customerPrice.selectedContractValueIncGst}
          offerReference={formatOfferReference(job.reference, job.revision)}
          particulars={contractParticulars}
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
  isDeclined,
  isDraft,
  isSent,
  isSigned,
}: {
  readonly isTenderSigned: boolean;
  readonly isDeclined: boolean;
  readonly isDraft: boolean;
  readonly isSent: boolean;
  readonly isSigned: boolean;
}) {
  if (isDeclined) {
    return (
      <Banner tone="warning">
        The customer declined this Contract. Create a new version to revise and
        re-send.
      </Banner>
    );
  }
  if (isSigned) {
    return (
      <Banner tone="success">
        Signed by the customer and builder. The executed Contract is on file —
        the Offer is ready to hand off to Project.
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
        Draft generated from the signed Tender. Fill the BC4 particulars below,
        then send for signature.
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

// Copy for each particulars group heading, in render order.
const PARTICULAR_GROUPS: readonly {
  readonly group: ContractParticularGroup;
  readonly title: string;
}[] = [
  { group: "owner", title: "Owner contact details" },
  { group: "timing", title: "Commencement & timing" },
  { group: "financial", title: "Financial terms (entered per job)" },
  { group: "funding", title: "Funding" },
  { group: "terms", title: "Site & special conditions" },
];

// BC4 particulars the builder used to complete mid-signing. Captured here first
// so the contract can route to the customer with those fields already filled.
// Editable while the contract is a draft; read-only (showing what was sent) once
// the envelope is out for signature.
function ContractParticularsForm({
  particulars,
  editable,
  onChange,
}: {
  readonly particulars: ContractParticulars;
  readonly editable: boolean;
  readonly onChange: (patch: Partial<ContractParticulars>) => void;
}) {
  if (!editable) {
    const filled = CONTRACT_PARTICULAR_FIELDS.filter(
      (field) => (particulars[field.key] ?? "").trim().length > 0,
    );
    return (
      <section className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Contract particulars
        </h4>
        {filled.length === 0 ? (
          <p className="text-sm text-muted-foreground/80">
            No particulars were captured — these fields appear blank on the
            signed contract.
          </p>
        ) : (
          <dl className="grid gap-2 sm:grid-cols-2">
            {filled.map((field) => (
              <div key={field.key}>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {field.label}
                </dt>
                <dd className="whitespace-pre-wrap text-sm font-medium">
                  {particulars[field.key]}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    );
  }

  return (
    <section className="grid gap-4 rounded-lg border border-border/70 bg-background p-4">
      <div>
        <h4 className="font-heading text-sm font-semibold">
          Contract particulars
        </h4>
        <p className="mt-1 flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          These fill the BC4 fields the builder used to complete while signing.
          The customer signs first now, so enter them here — anything left blank
          shows blank on the contract the customer receives.
        </p>
      </div>

      {PARTICULAR_GROUPS.map(({ group, title }) => {
        const fields = CONTRACT_PARTICULAR_FIELDS.filter(
          (field) => field.group === group,
        );
        if (fields.length === 0) {
          return null;
        }
        return (
          <div key={group} className="grid gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {title}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((field) => (
                <label
                  key={field.key}
                  className={field.multiline ? "sm:col-span-2" : undefined}
                >
                  <span className="mb-1 block text-xs font-medium text-foreground">
                    {field.label}
                    {field.recommendedBeforeSend ? (
                      <span className="ml-1 text-royal-gold-dark">
                        · recommended
                      </span>
                    ) : null}
                  </span>
                  {field.multiline ? (
                    <Textarea
                      rows={3}
                      placeholder={field.hint}
                      value={particulars[field.key]}
                      onChange={(event) =>
                        onChange({ [field.key]: event.target.value })
                      }
                    />
                  ) : (
                    <Input
                      placeholder={field.hint}
                      value={particulars[field.key]}
                      onChange={(event) =>
                        onChange({ [field.key]: event.target.value })
                      }
                    />
                  )}
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function ContractActions({
  isTenderSigned,
  isDeclined,
  isDraft,
  isSent,
  isSigned,
  customerName,
  signerLabels,
  contractValueIncGst,
  offerReference,
  particulars,
  sending,
  sendError,
  onGenerateContract,
  onSendContract,
  onRecallContract,
  onMarkContractSigned,
}: {
  readonly isTenderSigned: boolean;
  readonly isDeclined: boolean;
  readonly isDraft: boolean;
  readonly isSent: boolean;
  readonly isSigned: boolean;
  readonly customerName: string;
  // Every customer signer (individual owners + company directors) — the exact
  // DocuSign recipient set, replacing the single hardcoded customer row.
  readonly signerLabels: readonly string[];
  readonly contractValueIncGst: number;
  readonly offerReference: string;
  readonly particulars: ContractParticulars;
  readonly sending: boolean;
  readonly sendError: string | null;
  readonly onGenerateContract: () => void;
  readonly onSendContract: () => void;
  readonly onRecallContract: () => void;
  readonly onMarkContractSigned: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  // Signed and declined contracts are terminal in this panel — a declined
  // contract is revised via "New version" at the workspace level, not here.
  if (isSigned || isDeclined) {
    return null;
  }

  const missingRecommended = missingRecommendedParticulars(particulars);

  return (
    <div className="grid gap-3">
      {isSent ? (
        <SigningTracker
          recipients={[
            // One row per customer signer (individual owners + company directors);
            // the builder counter-signs — mirroring the real envelope.
            ...(signerLabels.length > 0
              ? signerLabels
              : [customerName || "signs first"]
            ).map((label) => ({
              role: "Customer" as const,
              detail: label,
              state: "awaiting" as const,
            })),
            {
              role: "Builder",
              detail: "Royal Constructions",
              state: "waiting_for_prior" as const,
              waitingLabel: "Signs after the customer",
            },
          ]}
        />
      ) : (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Sending creates a DocuSign envelope from the MBA BC4 contract
          template, pre-filled from the signed Tender and the particulars above
          (sent as locked fields). The customer signs first, then the builder
          counter-signs. The Connect webhook records signatures and files the
          executed contract.
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
            {/* Local-development testing aid only: the real signed state comes
                from the DocuSign completion webhook. Hidden in staging/prod so
                it can't manufacture a CONTRACT_SIGNED offer with no executed
                PDF (issue #90); the server action also rejects it there. */}
            {process.env.NODE_ENV === "development" ? (
              <Button
                className="bg-royal-gold text-primary-foreground hover:bg-royal-gold-dark"
                size="sm"
                type="button"
                onClick={onMarkContractSigned}
              >
                <ShieldCheck className="size-4" aria-hidden="true" />
                Mark signed (simulate completion)
              </Button>
            ) : null}
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

      {isDraft && missingRecommended.length > 0 ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-light px-3 py-2 text-xs text-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Recommended particulars still blank:{" "}
            <span className="font-medium">
              {missingRecommended.map((field) => field.label).join(", ")}
            </span>
            . You can still send, but these will show blank on the contract the
            customer signs.
          </span>
        </p>
      ) : null}

      {isDraft && confirming ? (
        <EnvelopeSendConfirm
          customerFirst
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
        <PartyBlock
          label={(job.owners?.length ?? 0) > 1 ? "Owners" : "Customer"}
          value={formatOwnerNamesLine(job.owners ?? []) || job.clientNames}
        />
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
        {/* An offer with no owners yet still has a customer party — show a single
            generic line rather than a builder-only signature list. */}
        {collectOfferSigners(job.owners ?? []).length > 0 ? (
          collectOfferSigners(job.owners ?? []).map((signer) => (
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
