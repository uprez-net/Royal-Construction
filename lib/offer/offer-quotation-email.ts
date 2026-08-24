import type { OfferPrintTemplateInput } from "@/lib/offer/workspace-print-template";
import { formatDateDisplay } from "@/lib/offer/workspace-print-template";
import { collectOfferSigners } from "@/lib/offer/workspace-model";
import type { QuotationEmailProps } from "@/lib/graph/Email/quotation-email";

const MS_PER_DAY = 86_400_000;

function money(value: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(value);
}

// The addressee's own name. Every signatory gets their own copy of the offer
// email (see sendOfferDocument), so the greeting is resolved from the signer
// whose address this copy is going to, falling back to the primary owner's
// display name for a legacy offer whose signatories carry no email.
function resolveClientName(
  input: OfferPrintTemplateInput,
  recipientEmail?: string,
): string | undefined {
  const target = (recipientEmail ?? "").trim().toLowerCase();
  if (target.length > 0) {
    for (const signer of collectOfferSigners(input.job.owners)) {
      if (signer.signatory.email.trim().toLowerCase() === target) {
        const name = signer.signatory.name.trim();
        if (name.length > 0) {
          return name;
        }
      }
    }
  }
  const owner = (input.job.owners ?? [])[0];
  const fallback = (owner?.displayName ?? input.job.clientNames).trim();
  return fallback.length > 0 ? fallback : undefined;
}

// job.validUntil is a DATE, but the template's sentence reads "valid for
// {validityPeriod} from the date of issue" — so render a duration and carry the
// hard date in brackets, rather than dropping a bare date into a "valid for …"
// clause. Undefined when validUntil is unset or already past, which leaves the
// template's own wording in place instead of promising a negative period.
function resolveValidityPeriod(validUntil: string): string | undefined {
  const trimmed = validUntil.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const until = new Date(`${trimmed}T00:00:00`);
  if (!Number.isFinite(until.getTime())) {
    return undefined;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((until.getTime() - today.getTime()) / MS_PER_DAY);
  const dateLabel = formatDateDisplay(trimmed);
  if (days <= 0) {
    return undefined;
  }
  return `${days} ${days === 1 ? "day" : "days"} (until ${dateLabel})`;
}

// The money rows shown to the client. Deliberately NOT the workspace cost lines:
// those are the builder's internal ex-GST costs, so emailing them would disclose
// the cost base and they would not add up to the contract price the same table
// totals. Instead this mirrors the proposal PDF's investment summary — standard
// price less the stated adjustment, or the single fixed-price line — so the rows
// always reconcile with totalAmount.
function resolveItems(
  input: OfferPrintTemplateInput,
): QuotationEmailProps["items"] {
  const total = input.customerPrice.selectedContractValueIncGst;
  const standard = input.standardPriceIncGst;
  const saving = standard !== null ? standard - total : 0;
  if (standard !== null && saving > 0) {
    return [
      { label: "Standard price (including GST)", amount: money(standard) },
      {
        label: input.priceAdjustmentLabel.trim() || "Saving",
        amount: `-${money(saving)}`,
      },
    ];
  }
  const buildType = input.job.buildType.trim();
  return [
    {
      label: buildType.length > 0
        ? `${buildType} — fixed price building works (including GST)`
        : "Fixed price building works (including GST)",
      amount: money(total),
    },
  ];
}

// Map the send-time offer data onto the branded QuotationEmail template. Used by
// sendOfferDocument in place of the old inline HTML body.
export function buildOfferQuotationEmailProps(input: {
  readonly template: OfferPrintTemplateInput;
  readonly reference: string;
  readonly recipientEmail?: string;
}): QuotationEmailProps {
  const { job } = input.template;
  const location =
    job.siteAddress.trim() ||
    [job.siteCouncil, job.siteState, job.sitePostcode]
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join(", ");

  return {
    clientName: resolveClientName(input.template, input.recipientEmail),
    projectName: job.buildType.trim() || undefined,
    location: location.length > 0 ? location : undefined,
    quoteNumber: input.reference,
    items: resolveItems(input.template),
    totalAmount: money(input.template.customerPrice.selectedContractValueIncGst),
    validityPeriod: resolveValidityPeriod(job.validUntil),
    // No quotationUrl / CTA: the full quotation travels as the attached PDF, so
    // the template has no call-to-action button to point anywhere.
    //
    // leadContext is the internal lead summary (source, stage, budget, assignee)
    // — never shown to a customer.
  };
}
