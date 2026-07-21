import type {
  OfferDocumentDraft,
  OfferWorkspaceCostLine,
  OfferWorkspaceJob,
  OfferWorkspaceScopeItem,
} from "@/lib/offer/workspace-model";
import type { OfferPaymentScheduleRow } from "@/lib/offer/workspace-payment-schedule";
import {
  buildOfferPrintTemplateData,
  formatArea,
  formatSiteParticulars,
  getPrintFooterText,
  PROPOSAL_TAGLINE,
} from "@/lib/offer/workspace-print-template";
import {
  buildWelcomeParagraphs,
  OFFER_SPEC_FACTS,
  STANDARD_INCLUSIONS_SCHEDULE,
  type OfferInclusionRow,
} from "@/lib/offer/workspace-proposal-content";
import type { OfferCustomerPrice } from "@/lib/offer/workspace-pricing";
import {
  getAttachedOfferImageSlots,
  offerImageCaption,
  type AttachedOfferImageSlot,
  type OfferImageMap,
} from "@/lib/offer/workspace-images";
import type { ReactElement } from "react";
import { formatCurrency, formatPercent } from "./offer-workspace-format";
import {
  CoverRow,
  ImageSlot,
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
  readonly images: OfferImageMap;
  // See OfferPrintTemplateInput — the date the offer was drawn up.
  readonly preparedDate?: Date;
  // Render for the screen (inside the revision viewer) instead of for print.
  // Both modes are mutually exclusive by design: globals.css unwraps and shows
  // every [data-offer-print-template="true"] when printing, so a screen copy
  // must NOT carry that attribute or it would print on top of the live offer.
  readonly screen?: boolean;
};

const INCLUSIONS_ROWS_PER_PAGE = 12;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages;
}

export function OfferWorkspacePrintTemplate(
  props: OfferWorkspacePrintTemplateProps,
) {
  const data = buildOfferPrintTemplateData(props);
  const inclusionPages = chunk(
    STANDARD_INCLUSIONS_SCHEDULE,
    INCLUSIONS_ROWS_PER_PAGE,
  );
  const galleryImages = getAttachedOfferImageSlots(props.images).filter(
    (slot) => slot.key !== "hero",
  );

  // Assemble the ordered page renderers, then number them automatically so the
  // footer "Page N of M" stays correct as pages are added or removed.
  const pages: Array<(n: number, total: number) => ReactElement> = [
    (n, total) => (
      <PrintCoverPage
        key="cover"
        data={data}
        job={props.job}
        heroSrc={props.images.hero?.url}
        heroCaption={
          props.images.hero?.source === "ai"
            ? "AI concept, indicative only"
            : undefined
        }
        footer={foot(data, n, total)}
      />
    ),
    (n, total) => (
      <PrintWelcomePage key="welcome" job={props.job} footer={foot(data, n, total)} />
    ),
    ...(galleryImages.length > 0
      ? [
          (n: number, total: number) => (
            <PrintGalleryPage
              key="gallery"
              images={galleryImages}
              footer={foot(data, n, total)}
            />
          ),
        ]
      : []),
    (n, total) => (
      <PrintSnapshotPage key="snapshot" data={data} job={props.job} footer={foot(data, n, total)} />
    ),
    (n, total) => (
      <PrintInvestmentPage
        key="investment"
        data={data}
        draft={props.draft}
        props={props}
        footer={foot(data, n, total)}
      />
    ),
    ...inclusionPages.map(
      (rows, i) =>
        // eslint-disable-next-line react/display-name -- page factory, not a component
        (n: number, total: number) =>
          (
            <PrintInclusionsPage
              key={`inclusions-${i}`}
              rows={rows}
              continued={i > 0}
              footer={foot(data, n, total)}
            />
          ),
    ),
    (n, total) => (
      <PrintTermsPage key="terms" data={data} job={props.job} footer={foot(data, n, total)} last />
    ),
  ];

  const total = pages.length;

  return (
    <div
      className={
        props.screen
          ? "bg-white text-foreground print:hidden"
          : "hidden bg-white text-foreground print:block"
      }
      data-offer-print-template={props.screen ? "screen" : "true"}
    >
      {pages.map((render, index) => render(index + 1, total))}
    </div>
  );
}

function foot(
  data: ReturnType<typeof buildOfferPrintTemplateData>,
  n: number,
  total: number,
): string {
  return getPrintFooterText(data.footerBase, n, total);
}

function PrintCoverPage({
  data,
  job,
  heroSrc,
  heroCaption,
  footer,
}: {
  readonly data: ReturnType<typeof buildOfferPrintTemplateData>;
  readonly job: OfferWorkspaceJob;
  readonly heroSrc?: string;
  readonly heroCaption?: string;
  readonly footer: string;
}) {
  const secondary = job.secondaryCustomerName?.trim() ?? "";
  return (
    <PrintPage footerText={footer}>
      <ProposalMasthead />
      {heroSrc ? (
        <div className="mt-6">
          <ImageSlot
            src={heroSrc}
            caption={heroCaption}
            label="Hero — completed home / render"
            heightClass="h-[95mm]"
          />
        </div>
      ) : null}
      <div className="mt-5 text-center">
        <h1 className="font-sans text-4xl font-bold uppercase tracking-wide text-sidebar">
          Building Proposal
        </h1>
        <p className="mt-2 text-xl font-semibold text-royal-gold-dark">
          {job.buildType}
        </p>
      </div>
      <div className="mt-6 border-t border-royal-gold pt-5">
        <dl className="grid grid-cols-[50mm_minmax(0,1fr)] text-sm">
          <CoverRow label="Client" value={job.clientNames} />
          {secondary ? (
            <CoverRow label="Co-owner" value={secondary} />
          ) : null}
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

function PrintWelcomePage({
  job,
  footer,
}: {
  readonly job: OfferWorkspaceJob;
  readonly footer: string;
}) {
  const paragraphs = buildWelcomeParagraphs(job);
  const secondary = job.secondaryCustomerName?.trim() ?? "";
  const primaryGreeting = job.clientNames
    .replace(/^(Mr|Ms|Mrs|Mr & Ms|Mr & Mrs)\s+/i, "")
    .replace(/\s*&\s*(Ms|Mrs)\s+/i, " and ");
  // Welcome greeting — addresses both clients by name when a secondary is
  // present ("Dear Jaswinder and Harpreet,").
  const greetingName = secondary
    ? `${primaryGreeting} and ${secondary}`
    : primaryGreeting;
  return (
    <PrintPage footerText={footer}>
      <ProposalMasthead />
      <PrintSection eyebrow="A personal welcome" title={`Dear ${greetingName},`}>
        <div className="max-w-[155mm] space-y-4 text-base leading-7">
          {paragraphs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
      </PrintSection>
      <div className="mt-8">
        <p className="font-semibold text-sidebar">{job.preparedBy}</p>
        <p className="text-sm text-muted-foreground">
          Lic. 383992C | MBA Accredited
        </p>
      </div>
    </PrintPage>
  );
}

function PrintGalleryPage({
  images,
  footer,
}: {
  readonly images: readonly AttachedOfferImageSlot[];
  readonly footer: string;
}) {
  return (
    <PrintPage footerText={footer}>
      <ProposalMasthead />
      <PrintSection
        eyebrow="Our work"
        title="Your home will be finished to this standard"
      >
        <p className="max-w-[155mm] text-sm leading-6 text-muted-foreground">
          The images below are from a recently completed home — built to a
          similar size and finish level. Full render to all elevations, luxury
          shaker kitchen, {OFFER_SPEC_FACTS.stoneBenchtopThickness} stone
          benchtops and floor-to-ceiling tiles to the wet areas. Finishes on your
          home are as per the inclusions schedule.
        </p>
      </PrintSection>
      <div className="mt-6 grid grid-cols-2 gap-4">
        {images.map((slot) => (
          <ImageSlot
            key={slot.key}
            src={slot.image.url}
            label={slot.label}
            caption={offerImageCaption(slot.caption, slot.image.source)}
            heightClass="h-[46mm]"
          />
        ))}
      </div>
    </PrintPage>
  );
}

function PrintSnapshotPage({
  data,
  job,
  footer,
}: {
  readonly data: ReturnType<typeof buildOfferPrintTemplateData>;
  readonly job: OfferWorkspaceJob;
  readonly footer: string;
}) {
  const gfGarage = job.groundFloorSqm + job.garageSqm;
  const alfrescoBalcony = job.alfrescoPorchSqm;
  const totalArea =
    gfGarage + job.firstFloorSqm + alfrescoBalcony + job.porchSqm + job.grannyFlatSqm;
  const areaCells = [
    { label: "Ground Floor + Garage", value: formatArea(gfGarage) },
    { label: "First Floor", value: formatArea(job.firstFloorSqm) },
    { label: "Alfresco + Balcony", value: formatArea(alfrescoBalcony) },
    { label: "Porch", value: formatArea(job.porchSqm) },
    // Granny flat is part of Total Area; show it as its own cell when present so
    // the breakdown reconciles with the emphasized total.
    ...(job.grannyFlatSqm > 0
      ? [{ label: "Granny Flat", value: formatArea(job.grannyFlatSqm) }]
      : []),
    { label: "Total Area", value: formatArea(totalArea), emphasis: true },
  ];
  const siteParticulars = formatSiteParticulars(job);
  return (
    <PrintPage footerText={footer}>
      <ProposalMasthead />
      <PrintSection eyebrow="Project snapshot" title="Site and build scope">
        <div className="grid grid-cols-2 gap-6">
          <div className="border border-border p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Site
            </p>
            <p className="mt-2 font-semibold text-sidebar">{job.siteAddress}</p>
            {/* The gap under the address sits on the block, not on the DP line —
                the DP line is optional, and hanging the spacing off it left the
                particulars flush against the address whenever it was absent. */}
            <div className="mt-3 text-sm text-muted-foreground">
              {job.dpNumber.trim() ? <p>{job.dpNumber}</p> : null}
              {siteParticulars ? <p>{siteParticulars}</p> : null}
            </div>
          </div>
          <div className="border border-border p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Build scope
            </p>
            <p className="mt-2 font-semibold text-sidebar">{job.buildType}</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {job.buildScope
                .filter((line) => line.trim())
                .map((line) => (
                  <li key={line}>{line}</li>
                ))}
            </ul>
          </div>
        </div>
      </PrintSection>
      <div className="mt-8 grid grid-cols-5 border border-border text-center text-sm">
        {areaCells.map((cell) => (
          <div
            key={cell.label}
            className={
              cell.emphasis
                ? "bg-sidebar p-4 text-white"
                : "border-r border-border p-4 last:border-r-0"
            }
          >
            <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
              {cell.label}
            </p>
            <p className="mt-2 font-mono font-semibold">{cell.value}</p>
          </div>
        ))}
      </div>
      <p className="mt-6 text-xs text-muted-foreground">
        Total build area {data.areaLabel}.
      </p>
    </PrintPage>
  );
}

function PrintInvestmentPage({
  data,
  draft,
  props,
  footer,
}: {
  readonly data: ReturnType<typeof buildOfferPrintTemplateData>;
  readonly draft: OfferDocumentDraft;
  readonly props: OfferWorkspacePrintTemplateProps;
  readonly footer: string;
}) {
  return (
    <PrintPage footerText={footer}>
      <ProposalMasthead />
      <PrintSection eyebrow="Investment summary" title={draft.headline}>
        <p className="max-w-[155mm] text-base leading-7">{draft.introText}</p>
      </PrintSection>
      <div className="mt-8 rounded-lg border border-border bg-royal-gold-light/60 p-6 text-center">
        {data.savingAmount !== null && data.savingAmount > 0 ? (
          <p className="text-sm font-semibold text-royal-gold-dark">
            Standard price {formatCurrency(props.standardPriceIncGst)} -{" "}
            {props.priceAdjustmentLabel || "saving"}{" "}
            {formatCurrency(data.savingAmount)}
          </p>
        ) : null}
        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Your fixed contract price
        </p>
        <p className="mt-1 font-heading text-5xl font-semibold text-sidebar">
          {formatCurrency(props.customerPrice.selectedContractValueIncGst)}
        </p>
        <p className="mt-2 font-mono text-sm text-muted-foreground">
          Including GST | MBA fixed price contract | Valid until{" "}
          {data.validUntilLabel}
        </p>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-8">
        <PrintBulletList items={draft.inclusionBullets} title="This price includes" />
        <PrintBulletList items={data.exclusionBullets} title="This price excludes" />
      </div>
    </PrintPage>
  );
}

function PrintInclusionsPage({
  rows,
  continued,
  footer,
}: {
  readonly rows: readonly OfferInclusionRow[];
  readonly continued: boolean;
  readonly footer: string;
}) {
  return (
    <PrintPage footerText={footer}>
      <ProposalMasthead />
      <PrintSection
        eyebrow="Inclusions"
        title={continued ? "Full inclusions schedule (cont.)" : "Full inclusions schedule"}
      >
        {continued ? null : (
          <p className="max-w-[155mm] text-sm leading-6 text-muted-foreground">
            All items below are fixed within your contract price. Design provided
            by owner/architect — all costs fixed as per approved plans, confirmed
            at colour selection.
          </p>
        )}
      </PrintSection>
      <table className="mt-6 w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-y border-border bg-muted/70 text-xs uppercase tracking-wide text-muted-foreground">
            <th className="w-[45mm] py-3 pr-4 font-semibold">Category</th>
            <th className="px-4 py-3 font-semibold">Specification</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={`${row.category}-${index}`}
              className={
                row.highlight
                  ? "border-b border-border bg-royal-gold-light/50"
                  : "border-b border-border"
              }
            >
              <td className="py-3 pr-4 align-top font-semibold text-sidebar">
                {row.category}
              </td>
              <td className="px-4 py-3 align-top text-muted-foreground">
                {row.specification}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </PrintPage>
  );
}

function PrintTermsPage({
  data,
  job,
  footer,
  last,
}: {
  readonly data: ReturnType<typeof buildOfferPrintTemplateData>;
  readonly job: OfferWorkspaceJob;
  readonly footer: string;
  readonly last?: boolean;
}) {
  const secondary = job.secondaryCustomerName?.trim() ?? "";
  // Acceptance paragraph — names both clients when present
  // ("I/We, <primary> and <secondary>, accept..."). `I/We` covers both.
  const acceptanceNames = secondary
    ? `${job.clientNames} and ${secondary}`
    : job.clientNames;
  const acceptanceLine = `I/We, ${acceptanceNames}, accept this proposal and agree to proceed to a Master Builders Association fixed price home building contract.`;
  return (
    <PrintPage breakAfter={!last} footerText={footer}>
      <ProposalMasthead />
      <PrintSection eyebrow="Next steps" title="Terms and payment schedule">
        <p className="max-w-[155mm] text-sm leading-6 text-muted-foreground">
          {acceptanceLine}
        </p>
        <p className="mt-3 max-w-[155mm] text-sm leading-6 text-muted-foreground">
          Contract documents, HBCF registration, signed Tender evidence and
          initial payment are handled before Project creation.
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
              <td className="px-4 py-4 text-muted-foreground">{row.trigger}</td>
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
        {secondary ? (
          <SignatureBlock label="Client acceptance — co-owner" name={secondary} />
        ) : null}
      </div>
    </PrintPage>
  );
}
