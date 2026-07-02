import type {
  OfferDocumentDraft,
  OfferWorkspaceCostLine,
  OfferWorkspaceJob,
  OfferWorkspaceScopeItem,
} from "@/lib/offer/workspace-model";
import type { OfferPaymentScheduleRow } from "@/lib/offer/workspace-payment-schedule";
import {
  buildOfferPrintTemplateData,
  getPrintFooterText,
  PROPOSAL_TAGLINE,
} from "@/lib/offer/workspace-print-template";
import type { OfferCustomerPrice } from "@/lib/offer/workspace-pricing";
import Image from "next/image";
import { formatCurrency, formatPercent } from "./offer-workspace-format";
import {
  CoverRow,
  PrintBulletList,
  PrintPage,
  PrintSection,
  ProposalMasthead,
  SignatureBlock,
} from "./offer-workspace-print-layout";

type OfferWorkspacePrintTemplateProps = {
  readonly allowances: readonly OfferWorkspaceScopeItem[];
  readonly customerPrice: OfferCustomerPrice;
  readonly draft: OfferDocumentDraft;
  readonly exclusions: readonly OfferWorkspaceScopeItem[];
  readonly job: OfferWorkspaceJob;
  readonly lines: readonly OfferWorkspaceCostLine[];
  readonly paymentSchedule: readonly OfferPaymentScheduleRow[];
  readonly priceAdjustmentLabel: string;
  readonly standardPriceIncGst: number | null;
};

export function OfferWorkspacePrintTemplate(
  props: OfferWorkspacePrintTemplateProps,
) {
  const data = buildOfferPrintTemplateData(props);

  return (
    <div
      className="hidden bg-white text-foreground print:block"
      data-offer-print-template="true"
    >
      <PrintCoverPage data={data} job={props.job} />
      <PrintInvestmentPage data={data} draft={props.draft} props={props} />
      <PrintScopePage data={data} />
      <PrintTermsPage data={data} job={props.job} />
    </div>
  );
}

function PrintCoverPage({
  data,
  job,
}: {
  readonly data: ReturnType<typeof buildOfferPrintTemplateData>;
  readonly job: OfferWorkspaceJob;
}) {
  return (
    <PrintPage footerText={getPrintFooterText(data.footerBase, 1)}>
      <ProposalMasthead />
      <div className="mt-8 overflow-hidden border border-border">
        <div className="flex h-[92mm] items-center justify-center bg-royal-gold-light/70 p-10">
          <Image
            alt="Royal Constructions"
            className="max-h-full max-w-[78%] object-contain"
            height={713}
            src="/logo-1024x713.png"
            width={1024}
          />
        </div>
      </div>
      <div className="mt-5 text-center">
        <h1 className="font-sans text-4xl font-bold uppercase tracking-wide text-sidebar">
          Building Proposal
        </h1>
        <p className="mt-2 text-xl font-semibold text-royal-gold-dark">
          {job.buildType}
        </p>
      </div>
      <div className="mt-8 border-t border-royal-gold pt-6">
        <dl className="grid grid-cols-[50mm_minmax(0,1fr)] text-sm">
          <CoverRow label="Client" value={job.clientNames} />
          <CoverRow label="Site Address" value={job.siteAddress} />
          <CoverRow label="Build Type" value={job.buildType} />
          <CoverRow label="Total Build Area" value={data.areaLabel} />
          <CoverRow emphasis label="Contract Price" value={data.priceLine} />
          <CoverRow
            label="Quote Reference"
            value={`${job.reference}-${job.revision} | Valid: ${data.validUntilLabel}`}
          />
          <CoverRow label="Prepared By" value={job.preparedBy} />
          <CoverRow label="Date" value={data.preparedDateLabel} />
        </dl>
      </div>
      <p className="mt-auto text-center text-lg font-semibold italic text-muted-foreground">
        {PROPOSAL_TAGLINE}
      </p>
    </PrintPage>
  );
}

function PrintInvestmentPage({
  data,
  draft,
  props,
}: {
  readonly data: ReturnType<typeof buildOfferPrintTemplateData>;
  readonly draft: OfferDocumentDraft;
  readonly props: OfferWorkspacePrintTemplateProps;
}) {
  return (
    <PrintPage footerText={getPrintFooterText(data.footerBase, 2)}>
      <ProposalMasthead />
      <PrintSection eyebrow="Proposal" title={draft.headline}>
        <p className="max-w-[150mm] text-base leading-7">{draft.introText}</p>
      </PrintSection>
      <div className="mt-8 rounded-lg border border-border bg-royal-gold-light/60 p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Your fixed contract price
        </p>
        <p className="mt-2 font-heading text-5xl font-semibold text-sidebar">
          {formatCurrency(props.customerPrice.selectedContractValueIncGst)}
        </p>
        <p className="mt-2 font-mono text-sm text-muted-foreground">
          Including GST | MBA fixed price contract | Valid until{" "}
          {data.validUntilLabel}
        </p>
        {data.savingAmount !== null && data.savingAmount > 0 ? (
          <p className="mt-4 text-base font-semibold text-royal-gold-dark">
            Standard price {formatCurrency(props.standardPriceIncGst)} -{" "}
            {props.priceAdjustmentLabel || "saving"}{" "}
            {formatCurrency(data.savingAmount)}
          </p>
        ) : null}
      </div>
      <div className="mt-8 grid grid-cols-2 gap-8">
        <PrintBulletList
          items={
            data.offerTenderLineItems.length > 0
              ? data.offerTenderLineItems
              : draft.inclusionBullets
          }
          title="This price includes"
        />
        <PrintBulletList
          items={data.exclusionBullets}
          title="This price excludes"
        />
      </div>
    </PrintPage>
  );
}

function PrintScopePage({
  data,
}: {
  readonly data: ReturnType<typeof buildOfferPrintTemplateData>;
}) {
  return (
    <PrintPage footerText={getPrintFooterText(data.footerBase, 3)}>
      <ProposalMasthead />
      <PrintSection eyebrow="Scope" title="Allowances and customer selections">
        <p className="max-w-[150mm] text-sm leading-6 text-muted-foreground">
          Allowances below are included in the fixed Offer price unless the
          client selects above the stated allowance or requests a written
          variation.
        </p>
      </PrintSection>
      <table className="mt-6 w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-y border-border bg-muted/70 text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-3 pr-4 font-semibold">Allowance</th>
            <th className="px-4 py-3 font-semibold">Amount</th>
            <th className="px-4 py-3 font-semibold">Selection rule</th>
          </tr>
        </thead>
        <tbody>
          {data.scopeRows.map((item) => (
            <tr key={item.id} className="border-b border-border">
              <td className="py-4 pr-4 align-top">
                <p className="font-semibold">{item.label}</p>
                <p className="mt-1 text-muted-foreground">
                  {item.description}
                </p>
              </td>
              <td className="px-4 py-4 align-top font-mono">
                {item.amountLabel}
              </td>
              <td className="px-4 py-4 align-top text-muted-foreground">
                {item.variationRule}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-8 rounded-lg border border-border bg-muted/50 p-5">
        <h2 className="font-sans text-lg font-semibold">Offer boundary</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This proposal is the customer-facing Offer document. A full Tender
          package is issued only after scope and price are agreed by Royal
          Constructions and the client.
        </p>
      </div>
    </PrintPage>
  );
}

function PrintTermsPage({
  data,
  job,
}: {
  readonly data: ReturnType<typeof buildOfferPrintTemplateData>;
  readonly job: OfferWorkspaceJob;
}) {
  return (
    <PrintPage breakAfter={false} footerText={getPrintFooterText(data.footerBase, 4)}>
      <ProposalMasthead />
      <PrintSection eyebrow="Next steps" title="Terms and payment schedule">
        <p className="max-w-[155mm] text-sm leading-6 text-muted-foreground">
          This proposal forms the basis for a Master Builders Association fixed
          price home building contract. Contract documents, HBCF registration,
          signed Tender evidence and initial payment are handled before Project
          creation.
        </p>
      </PrintSection>
      <table className="mt-6 w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-y border-border bg-muted/70 text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-3 pr-4 font-semibold">Stage</th>
            <th className="px-4 py-3 font-semibold">Amount</th>
            <th className="px-4 py-3 font-semibold">Trigger</th>
          </tr>
        </thead>
        <tbody>
          {data.paymentRows.map((row) => (
            <tr key={row.id} className="border-b border-border">
              <td className="py-4 pr-4 font-semibold">{row.stageName}</td>
              <td className="px-4 py-4 font-mono">
                {formatPercent(row.percentOfContract)} -{" "}
                {formatCurrency(row.amount)}
              </td>
              <td className="px-4 py-4 text-muted-foreground">
                {row.trigger}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-8 grid grid-cols-2 gap-8 text-sm">
        <SignatureBlock
          label="For Royal Constructions Pty Ltd"
          name={job.preparedBy}
        />
        <SignatureBlock label="Client acceptance" name={job.clientNames} />
      </div>
    </PrintPage>
  );
}
