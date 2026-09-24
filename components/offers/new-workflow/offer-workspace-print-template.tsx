import {
  CHARS_PER_LINE_SIGNATURE,
  chunkAllowanceRows,
  chunkByEstimatedHeight,
  chunkInclusionSchedule,
  inclusionPageStartIndexes,
  printedInclusionCategory,
  type OfferInclusionEntry,
  collectOfferSigners,
  estimateWrappedLines,
  formatOwnerGreetingNames,
  formatOwnerNamesLine,
  type OfferDocumentDraft,
  type OfferWorkspaceCostLine,
  type OfferWorkspaceJob,
  type OfferWorkspaceScopeItem,
} from "@/lib/offer/workspace-model";
import type { OfferPaymentScheduleRow } from "@/lib/offer/workspace-payment-schedule";
import {
  buildAreaBreakdown,
  buildOfferPrintTemplateData,
  formatArea,
  formatRoomCount,
  formatSiteParticulars,
  getPrintFooterText,
  grannyDwellingSpec,
  PROPOSAL_TAGLINE,
  type OfferDwellingSpec,
  type OfferPrintScopeRow,
} from "@/lib/offer/workspace-print-template";
import {
  buildWelcomeParagraphs,
  OFFER_SPEC_FACTS,
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

// Mirrors offer-proposal-html.ts: builder + up to 3 client signers still fit under
// the terms-page payment table (the common case); beyond that the signatures move
// onto their own page(s) so they can't overflow a nominal A4 page and desync the
// "Page N of M" footer (PR #124 review — the emailed PDF was fixed first, this is
// the separate React window.print() path).
const INLINE_SIGNATURE_LIMIT = 4;
// Page budgets in LINE UNITS, matching offer-proposal-html.ts exactly. These two
// renderers must paginate identically — they were drifting (8 blocks per page
// here vs 6 there), so the browser download and the emailed PDF could disagree on
// page count for the same offer (PR #124 review).
const SIGNATURE_PAGE_BUDGET = 34;
const SIGNATURE_PAGE_HEADING_LINES = 4;
const MIN_FIRST_SIGNATURE_PAGE_BUDGET = 10;
const INLINE_SIGNATURE_BUDGET = 22;
const SIGNATURE_BLOCK_CHROME_LINES = 4;

function signatureBlockLines(whoText: string): number {
  return (
    SIGNATURE_BLOCK_CHROME_LINES +
    estimateWrappedLines(whoText, CHARS_PER_LINE_SIGNATURE)
  );
}

type SignatureBlockSpec = {
  readonly key: string;
  readonly label: string;
  readonly name: string;
};

// Acceptance paragraph naming every owner ("I/We, A and B and C, accept…"), the
// same wording the emailed HTML uses. Falls back to the clientNames projection
// when owners[] is empty.
function offerAcceptanceLine(job: OfferWorkspaceJob): string {
  const owners = job.owners ?? [];
  const acceptanceNames =
    owners.length > 0
      ? owners
          .map((owner) => owner.displayName.trim())
          .filter(Boolean)
          .join(" and ")
      : job.clientNames;
  return `I/We, ${acceptanceNames}, accept this proposal and agree to proceed to a Master Builders Association fixed price home building contract.`;
}

// Ordered signature blocks: customer signers first (each individual owner; each
// company director shown as "Name, Director of Company"), then the builder below.
function offerSignatureBlocks(job: OfferWorkspaceJob): SignatureBlockSpec[] {
  const signers = collectOfferSigners(job.owners ?? []);
  const clientBlocks: SignatureBlockSpec[] =
    signers.length > 0
      ? signers.map((signer, index) => ({
          key: signer.signatory.id,
          label:
            signers.length > 1
              ? `Client acceptance ${index + 1}`
              : "Client acceptance",
          name: signer.entityName
            ? `${signer.signatory.name}, ${signer.signatory.capacity} of ${signer.entityName}`
            : signer.signatory.name,
        }))
      : [
          {
            key: "client-fallback",
            label: "Client acceptance",
            name: job.clientNames,
          },
        ];
  return [
    ...clientBlocks,
    {
      key: "builder",
      label: "For Royal Constructions Pty Ltd",
      name: job.preparedBy,
    },
  ];
}

export function OfferWorkspacePrintTemplate(
  props: OfferWorkspacePrintTemplateProps,
) {
  const data = buildOfferPrintTemplateData(props);
  // The schedule the estimator edited on this offer — not a module constant.
  // An empty schedule produces zero pages rather than an empty table.
  const inclusionPages = chunkInclusionSchedule(props.draft.inclusionSchedule);
  const inclusionStartIndexes = inclusionPageStartIndexes(inclusionPages);
  const galleryImages = getAttachedOfferImageSlots(props.images).filter(
    (slot) => slot.key !== "hero",
  );
  // Few signers stay inline under the payment table; more move to their own
  // counted page(s) so the footer total matches the real page count.
  // Identical content-aware pagination to the emailed renderer: budget by
  // estimated wrapped-line height, and subtract the acceptance paragraph (which
  // names every owner and is legal text) from the first page's budget.
  const signatureBlocks = offerSignatureBlocks(props.job);
  const signatureLines = signatureBlocks.reduce(
    (sum, block) => sum + signatureBlockLines(block.name),
    0,
  );
  const inlineSignatures =
    signatureBlocks.length <= INLINE_SIGNATURE_LIMIT &&
    signatureLines <= INLINE_SIGNATURE_BUDGET;
  let signatureChunks: SignatureBlockSpec[][] = [];
  if (!inlineSignatures) {
    const acceptanceLines = estimateWrappedLines(
      offerAcceptanceLine(props.job),
      CHARS_PER_LINE_SIGNATURE,
    );
    const firstBudget = Math.max(
      MIN_FIRST_SIGNATURE_PAGE_BUDGET,
      SIGNATURE_PAGE_BUDGET - acceptanceLines - SIGNATURE_PAGE_HEADING_LINES,
    );
    const first =
      chunkByEstimatedHeight(signatureBlocks, firstBudget, (b) =>
        signatureBlockLines(b.name),
      )[0] ?? [];
    const rest = signatureBlocks.slice(first.length);
    signatureChunks = [
      first,
      ...chunkByEstimatedHeight(rest, SIGNATURE_PAGE_BUDGET, (b) =>
        signatureBlockLines(b.name),
      ),
    ].filter((c) => c.length > 0);
  }

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
      <PrintWelcomePage
        key="welcome"
        job={props.job}
        footer={foot(data, n, total)}
      />
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
      <PrintSnapshotPage
        key="snapshot"
        data={data}
        job={props.job}
        footer={foot(data, n, total)}
      />
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
    ...inclusionPages.map((rows, i) =>
      // eslint-disable-next-line react/display-name -- page factory, not a component
      (n: number, total: number) => (
        <PrintInclusionsPage
          key={`inclusions-${i}`}
          specifications={rows}
          startIndex={inclusionStartIndexes[i]}
          continued={i > 0}
          footer={foot(data, n, total)}
        />
      ),
    ),
    ...chunkAllowanceRows(data.scopeRows).map((rows, i) =>
      // eslint-disable-next-line react/display-name -- page factory, not a component
      (n: number, total: number) => (
        <PrintAllowancesPage
          key={`allowances-${i}`}
          rows={rows}
          continued={i > 0}
          footer={foot(data, n, total)}
        />
      ),
    ),
    (n, total) => (
      <PrintTermsPage
        key="terms"
        data={data}
        job={props.job}
        inlineBlocks={inlineSignatures ? signatureBlocks : null}
        footer={foot(data, n, total)}
        last={signatureChunks.length === 0}
      />
    ),
    ...signatureChunks.map((blocks, i) =>
      // eslint-disable-next-line react/display-name -- page factory, not a component
      (n: number, total: number) => (
        <PrintSignaturePage
          key={`signatures-${i}`}
          job={props.job}
          blocks={blocks}
          continued={i > 0}
          footer={foot(data, n, total)}
          last={i === signatureChunks.length - 1}
        />
      ),
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
  // Render every owner from owners[] (companies annotated with ABN/ACN), not the
  // primary/secondary projection — otherwise window.print() dropped owners 3+
  // while the emailed HTML listed them all (codex #8).
  const ownerNamesLine =
    formatOwnerNamesLine(job.owners ?? []) || job.clientNames;
  const ownerLabel = (job.owners?.length ?? 0) > 1 ? "Owners" : "Client";
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
          <CoverRow label={ownerLabel} value={ownerNamesLine} />
          {job.currentLocation.trim() ? (
            <CoverRow label="Current Location" value={job.currentLocation} />
          ) : null}
          <CoverRow label="Site Location" value={job.siteAddress} />
          <CoverRow label="Build Type" value={job.buildType} />
          {data.areaLabel ? (
            <CoverRow label="Total Build Area" value={data.areaLabel} />
          ) : null}
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
  // Greet EVERY owner via the shared helper the emailed HTML also uses, so the
  // printed and emailed letters address the same people. The legacy
  // clientNames/secondary pair (fallback only) dropped owners 3+.
  const legacyGreeting = (() => {
    const secondary = job.secondaryCustomerName?.trim() ?? "";
    const primary = job.clientNames
      .replace(/^(Mr|Ms|Mrs|Mr & Ms|Mr & Mrs)\s+/i, "")
      .replace(/\s*&\s*(Ms|Mrs)\s+/i, " and ");
    return secondary ? `${primary} and ${secondary}` : primary;
  })();
  const greetingName =
    formatOwnerGreetingNames(job.owners ?? []) || legacyGreeting;
  return (
    <PrintPage footerText={footer}>
      <ProposalMasthead />
      <PrintSection
        eyebrow="A personal welcome"
        title={`Dear ${greetingName},`}
      >
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
          benchtops and floor-to-ceiling tiles to the wet areas. Finishes on
          your home are as per the inclusions schedule.
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
  // The same cells and total as snapshotPage() in offer-proposal-html.ts, so the
  // grid adds up and matches the cover, the letter and the Tender.
  const area = buildAreaBreakdown(job);
  const areaCells =
    area.totalSqm > 0
      ? [
          ...area.cells.map((cell) => ({
            label: cell.label,
            value: formatArea(cell.sqm),
            emphasis: false,
          })),
          {
            label: "Total Area",
            value: formatArea(area.totalSqm),
            emphasis: true,
          },
        ]
      : [];
  const granny = grannyDwellingSpec(job);
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
      {areaCells.length > 0 ? (
        <div className="mt-8 grid grid-flow-col auto-cols-fr border border-border text-center text-sm">
          {areaCells.map((cell) => (
            <div
              key={cell.label}
              className={
                cell.emphasis
                  ? "bg-sidebar px-2 py-4 text-white"
                  : "border-r border-border px-2 py-4 last:border-r-0"
              }
            >
              <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
                {cell.label}
              </p>
              {/* With void and granny flat both showing, seven cells leave ~77px
                for a value and "187.35 m²" is ~76px of monospace: it broke at
                the space and printed the unit on a line of its own. */}
              <p className="mt-2 whitespace-nowrap font-mono font-semibold">
                {cell.value}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      {data.areaLabel ? (
        <p className="mt-6 text-xs text-muted-foreground">
          Total build area {data.areaLabel}.
        </p>
      ) : null}
      <PrintDwellingSpec
        title="Major House Specifications"
        spec={{
          bathrooms: job.bathrooms,
          bedrooms: job.bedrooms,
          garageSpaces: job.garageSpaces,
        }}
      />
      {granny ? (
        <PrintDwellingSpec title="Granny Home Specifications" spec={granny} />
      ) : null}
    </PrintPage>
  );
}

// Room counts per dwelling, as the emailed snapshot page prints them: the major
// house always, the granny home only when the build includes one. The printed
// copy carried neither, so it lost the bedroom counts the emailed PDF showed.
function PrintDwellingSpec({
  title,
  spec,
}: {
  readonly title: string;
  readonly spec: OfferDwellingSpec;
}) {
  const cells = [
    { label: "Bedrooms", value: spec.bedrooms },
    { label: "Bathrooms", value: spec.bathrooms },
    { label: "Garage Spaces", value: spec.garageSpaces },
  ];
  return (
    <div className="mt-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-sidebar">
        {title}
      </p>
      <div className="mt-2 grid grid-cols-3 border border-border text-center text-sm">
        {cells.map((cell) => (
          <div
            key={cell.label}
            className="border-r border-border p-3 last:border-r-0"
          >
            <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
              {cell.label}
            </p>
            <p className="mt-2 font-mono font-semibold">
              {formatRoomCount(cell.value)}
            </p>
          </div>
        ))}
      </div>
    </div>
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
        <PrintBulletList
          items={data.summaryInclusions}
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

function PrintInclusionsPage({
  specifications,
  startIndex,
  continued,
  footer,
}: {
  readonly specifications: readonly OfferInclusionEntry[];
  readonly startIndex: number;
  readonly continued: boolean;
  readonly footer: string;
}) {
  return (
    <PrintPage footerText={footer}>
      <ProposalMasthead />
      <PrintSection
        eyebrow="Inclusions"
        title={
          continued
            ? "Full inclusions schedule (cont.)"
            : "Full inclusions schedule"
        }
      >
        {continued ? null : (
          <p className="max-w-[155mm] text-sm leading-6 text-muted-foreground">
            All items below are fixed within your contract price. Design
            provided by owner/architect — all costs fixed as per approved plans,
            confirmed at colour selection.
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
          {specifications.map((entry, index) => (
            <tr
              className="border-b border-border"
              key={`${startIndex + index}`}
            >
              <td className="py-3 pr-4 align-top font-semibold text-sidebar">
                {printedInclusionCategory(specifications, index)}
              </td>
              <td className="px-4 py-3 align-top text-muted-foreground">
                {entry.spec}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </PrintPage>
  );
}

// The prime-cost and provisional sums the estimator ticked "Show on Offer
// document" on the Scope step.
//
// buildOfferPrintTemplateData has always computed `scopeRows`, and until now
// nothing rendered them: a fixed-price proposal went out with no statement of
// which sums were allowances, what they were worth, or what happens when the
// real cost differs — while the estimator saw a ticked checkbox saying it would.
//
// Its own page(s), and only when there is something to disclose, so an offer with
// no allowances keeps exactly the page count it had before. A continued page
// drops the intro, mirroring allowancesPage() in offer-proposal-html.ts.
function PrintAllowancesPage({
  rows,
  continued,
  footer,
}: {
  readonly rows: readonly OfferPrintScopeRow[];
  readonly continued: boolean;
  readonly footer: string;
}) {
  return (
    <PrintPage footerText={footer}>
      <ProposalMasthead />
      <PrintSection
        eyebrow="Allowances"
        title={
          continued
            ? "Prime cost & provisional sums (cont.)"
            : "Prime cost & provisional sums"
        }
      >
        {continued ? null : (
          <p className="max-w-[155mm] text-sm leading-6 text-muted-foreground">
            The amounts below are allowances held within your fixed contract
            price, not fixed costs. Where your final selection costs more or
            less than the allowance, the difference is adjusted by written
            variation as set out against each item.
          </p>
        )}
      </PrintSection>
      <table className="mt-6 w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-y border-border bg-muted/70 text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-3 pr-4 font-semibold">Item</th>
            <th className="w-[30mm] px-4 py-3 text-right font-semibold">
              Allowance
            </th>
            <th className="w-[70mm] px-4 py-3 font-semibold">
              If the actual cost differs
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="border-b border-border" key={row.id}>
              <td className="py-3 pr-4 align-top">
                <span className="font-semibold text-sidebar">{row.label}</span>
                {row.description ? (
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    {row.description}
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-3 text-right align-top font-mono tabular-nums">
                {row.amountLabel}
              </td>
              <td className="px-4 py-3 align-top text-muted-foreground">
                {row.variationRule || "\u2014"}
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
  inlineBlocks,
  footer,
  last,
}: {
  readonly data: ReturnType<typeof buildOfferPrintTemplateData>;
  readonly job: OfferWorkspaceJob;
  // Signature blocks to render inline under the payment table, or null when there
  // are too many and they go on their own PrintSignaturePage(s) instead.
  readonly inlineBlocks: readonly SignatureBlockSpec[] | null;
  readonly footer: string;
  readonly last?: boolean;
}) {
  // Acceptance text + signature blocks derive from owners[] / collectOfferSigners
  // — the SAME source the emailed proposal HTML uses (see offer-proposal-html.ts)
  // — so a window.print() download names every owner and gives every signatory
  // (each individual owner + each company director) its own block.
  return (
    <PrintPage breakAfter={!last} footerText={footer}>
      <ProposalMasthead />
      <PrintSection eyebrow="Next steps" title="Terms and payment schedule">
        {inlineBlocks ? (
          <p className="max-w-[155mm] text-sm leading-6 text-muted-foreground">
            {offerAcceptanceLine(job)}
          </p>
        ) : null}
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
      {inlineBlocks ? (
        <div className="mt-8 grid grid-cols-2 gap-8 text-sm">
          {inlineBlocks.map((block) => (
            <SignatureBlock
              key={block.key}
              label={block.label}
              name={block.name}
            />
          ))}
        </div>
      ) : (
        <p className="mt-8 max-w-[155mm] text-sm leading-6 text-muted-foreground">
          Sign the acceptance on the following page to proceed.
        </p>
      )}
    </PrintPage>
  );
}

// A dedicated signature page, used when there are too many signers to fit inline
// on the terms page. The acceptance paragraph leads the first such page. Mirrors
// signaturePage() in offer-proposal-html.ts so the printed and emailed documents
// agree.
function PrintSignaturePage({
  job,
  blocks,
  continued,
  footer,
  last,
}: {
  readonly job: OfferWorkspaceJob;
  readonly blocks: readonly SignatureBlockSpec[];
  readonly continued: boolean;
  readonly footer: string;
  readonly last?: boolean;
}) {
  return (
    <PrintPage breakAfter={!last} footerText={footer}>
      <ProposalMasthead />
      <PrintSection
        eyebrow="Acceptance"
        title={
          continued
            ? "Acceptance & signatures (cont.)"
            : "Acceptance & signatures"
        }
      >
        {continued ? null : (
          <p className="max-w-[155mm] text-sm leading-6 text-muted-foreground">
            {offerAcceptanceLine(job)}
          </p>
        )}
      </PrintSection>
      <div className="mt-8 grid grid-cols-2 gap-8 text-sm">
        {blocks.map((block) => (
          <SignatureBlock
            key={block.key}
            label={block.label}
            name={block.name}
          />
        ))}
      </div>
    </PrintPage>
  );
}
