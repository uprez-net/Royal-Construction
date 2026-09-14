import {
  buildAreaBreakdown,
  buildOfferPrintTemplateData,
  formatArea,
  formatRoomCount,
  grannyDwellingSpec,
  type OfferDwellingSpec,
  formatSiteParticulars,
  getPrintFooterText,
  PROPOSAL_TAGLINE,
  COMPANY_LINE,
  type OfferPrintScopeRow,
  type OfferPrintTemplateInput,
} from "./workspace-print-template";
import {
  buildWelcomeParagraphs,
  OFFER_SPEC_FACTS,
} from "./workspace-proposal-content";
import {
  getAttachedOfferImageSlots,
  offerImageCaption,
  type AttachedOfferImageSlot,
  type OfferImageMap,
} from "./workspace-images";
import {
  formatBoundedOwnerList,
  CHARS_PER_LINE_INVESTMENT,
  CHARS_PER_LINE_SIGNATURE,
  chunkAllowanceRows,
  chunkByEstimatedHeight,
  chunkInclusionSchedule,
  inclusionPageStartIndexes,
  UNCATEGORISED_INCLUSION_LABEL,
  type OfferInclusionEntry,
  collectOfferSigners,
  estimateWrappedLines,
  formatOwnerGreetingNames,
  type OfferOwner,
  type OfferWorkspaceJob,
} from "./workspace-model";
// DocuSign anchor emitter, shared with the Tender/Contract HTML so the anchor
// styling (tiny + grey, present for AutoPlace) can never drift between documents.
import { anchor } from "./offer-tender-html";

const NAVY = "#1e2b4d";
const GOLD = "#b8873b";
const GOLD_DARK = "#8f6a24";
const GOLD_LIGHT = "#f6efe0";
const BORDER = "#e3e3e0";
const MUTED = "#6b6b6b";

// Builder + up to 3 client signers still fit under the terms-page payment table
// (the common case, kept byte-identical); beyond that, signatures move onto their
// own page(s), chunked so blocks never overflow a physical page (PR #124 review).
const INLINE_SIGNATURE_LIMIT = 4;

type SignatureBlock = { readonly html: string; readonly lines: number };

// A signature block's height in line units: its fixed chrome (heading, signature
// rule, date rule, padding) plus however many lines the signer's name wraps to.
// Counting blocks instead of lines is what let long company names overflow.
function signatureBlockLines(whoText: string): number {
  const CHROME_LINES = 4;
  return (
    CHROME_LINES + estimateWrappedLines(whoText, CHARS_PER_LINE_SIGNATURE)
  );
}

// Line-unit budget for a dedicated signature page, and for the FIRST one, which
// also carries the acceptance paragraph. Verified against real Chromium output.
const SIGNATURE_PAGE_BUDGET = 34;
// Masthead + eyebrow + page title on a signature page.
const SIGNATURE_PAGE_HEADING_LINES = 4;
// However tall the acceptance paragraph grows, always leave room for a block.
const MIN_FIRST_SIGNATURE_PAGE_BUDGET = 10;
// Room left under the terms page's payment table for inline signature blocks.
const INLINE_SIGNATURE_BUDGET = 22;

function esc(value: string): string {
  return value
    // Strip backslashes so user-controlled text (client name, address, scope)
    // cannot smuggle a DocuSign anchor token like \sigOwner1\ into the signed
    // acceptance PDF and steal a signature/date field via AutoPlace. Harmless for
    // the emailed copy (real names/addresses carry no backslashes); real anchors
    // are emitted by anchor(), never through esc(). Mirrors offer-tender-html.esc.
    .replace(/\\/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(value: number | null): string {
  if (value === null) {
    return "-";
  }
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(value);
}

// One owner's display name for the cover — companies annotated with ABN/ACN.
function ownerDisplayName(owner: OfferOwner): string {
  const name = owner.displayName.trim();
  if (owner.kind === "company" && owner.abn.trim().length > 0) {
    return `${name} (ABN/ACN ${owner.abn.trim()})`;
  }
  return name;
}

// Cover "Client" cell for N owners: primary on the first line, any co-owners on
// a muted "and …" sub-line (companies annotated). Falls back to the legacy
// clientNames projection when owners[] is somehow empty.
function ownerNamesCellHtml(job: OfferWorkspaceJob): string {
  const owners = (job.owners ?? []).filter((owner) =>
    owner.displayName.trim().length > 0,
  );
  if (owners.length === 0) {
    return esc(job.clientNames);
  }
  const primary = esc(ownerDisplayName(owners[0]));
  const rest = owners.slice(1).map((owner) => esc(ownerDisplayName(owner)));
  if (rest.length === 0) {
    return primary;
  }
  // Bounded: every owner is still named in full on the acceptance page and gets
  // their own signature block, so this fixed cover cell shows a few and counts
  // the rest instead of growing until the cover spills onto a second physical
  // sheet and desyncs "Page N of M" (PR #124 review).
  return `${primary}<br /><span style="font-size:11px;color:${MUTED};">and ${formatBoundedOwnerList(rest, "; ")}</span>`;
}

// Build a complete, self-contained HTML document of the building proposal,
// suitable for headless-Chrome PDF rendering (generatePDF). Mirrors the on-screen
// print template but with inline CSS so it renders standalone.
//
// `forSignature` renders the customer-acceptance blocks with DocuSign anchor
// tokens (\sigOwner{k}\ / \dateOwner{k}\) instead of blank wet-sign rules, and
// replaces the builder's wet-sign block with a non-signature "Prepared by"
// credit — this is the PDF sent as a customer-only DocuSign acceptance envelope
// (ADR 0004). The default (emailed negotiation copy) keeps the wet-sign rules.
export function buildProposalHtml(
  input: OfferPrintTemplateInput,
  images: OfferImageMap,
  options: { readonly forSignature?: boolean } = {},
): string {
  const forSignature = options.forSignature ?? false;
  const data = buildOfferPrintTemplateData(input);
  const { job } = input;
  const galleryImages = getAttachedOfferImageSlots(images).filter(
    (slot) => slot.key !== "hero",
  );

  // The schedule the estimator edited on this offer — not a module constant.
  // An empty schedule produces zero pages rather than an empty table.
  const inclusionPages = chunkInclusionSchedule(input.draft.inclusionSchedule);
  const inclusionStartIndexes = inclusionPageStartIndexes(inclusionPages);

  // Signature blocks (customer signers first, then the builder). A handful fit
  // under the terms-page payment table (the common 1–3 signer case, unchanged);
  // more than that overflowed a single fixed-height page — the 10-signer offer
  // split a signer's line across two physical pages and left the footer reading
  // "Page 9 of 9" over 10 pages (PR #124 review). Past the inline limit, move the
  // whole set onto its own chunked page(s), each counted so the footer stays true.
  const signatureBlocks = signatureBlocksHtml(job, forSignature);
  const signatureLines = signatureBlocks.reduce(
    (sum, block) => sum + block.lines,
    0,
  );
  // Inline only when the blocks BOTH are few and actually fit under the payment
  // table — four blocks of long company names are far taller than four of short
  // individual names, so the count alone never decided this correctly.
  const inlineSignatures =
    signatureBlocks.length <= INLINE_SIGNATURE_LIMIT &&
    signatureLines <= INLINE_SIGNATURE_BUDGET;
  let signatureChunks: SignatureBlock[][] = [];
  if (!inlineSignatures) {
    // The first signature page also carries the acceptance paragraph, which NAMES
    // EVERY OWNER and is legal text that cannot be truncated — so its height is
    // measured and subtracted from that page's budget rather than assumed. Ten
    // long company names make it many lines tall.
    const acceptanceLines = estimateWrappedLines(
      acceptanceLineText(job),
      CHARS_PER_LINE_SIGNATURE,
    );
    const firstBudget = Math.max(
      MIN_FIRST_SIGNATURE_PAGE_BUDGET,
      SIGNATURE_PAGE_BUDGET - acceptanceLines - SIGNATURE_PAGE_HEADING_LINES,
    );
    const first = chunkByEstimatedHeight(
      signatureBlocks,
      firstBudget,
      (block) => block.lines,
    )[0] ?? [];
    const rest = signatureBlocks.slice(first.length);
    signatureChunks = [
      first,
      ...chunkByEstimatedHeight(rest, SIGNATURE_PAGE_BUDGET, (b) => b.lines),
    ].filter((chunk) => chunk.length > 0);
  }

  // Only when there is something to disclose, so an offer with no allowances
  // keeps the page count it had before.
  const allowancePages = chunkAllowanceRows(data.scopeRows);

  const totalPages =
    5 +
    inclusionPages.length +
    (galleryImages.length > 0 ? 1 : 0) +
    allowancePages.length +
    signatureChunks.length;
  let pageNo = 0;
  const foot = () => {
    pageNo += 1;
    return `<div class="foot">${esc(getPrintFooterText(data.footerBase, pageNo, totalPages))}</div>`;
  };

  const pages: string[] = [
    coverPage(input, data, images, foot()),
    welcomePage(job, foot()),
    ...(galleryImages.length > 0 ? [galleryPage(galleryImages, foot())] : []),
    snapshotPage(input, data, foot()),
    investmentPage(input, data, foot()),
    ...inclusionPages.map((rows, index) =>
      inclusionsPage(rows, inclusionStartIndexes[index], index > 0, foot()),
    ),
    ...allowancePages.map((rows, index) =>
      allowancesPage(rows, index > 0, foot()),
    ),
    termsPage(input, data, inlineSignatures ? signatureBlocks : null, foot()),
    ...signatureChunks.map((chunk, index) =>
      signaturePage(job, chunk, index > 0, foot()),
    ),
  ];

  return `<!doctype html><html><head><meta charset="utf-8" />
<style>
  /* Keep the intended colours when the PDF is produced by a path that would
     otherwise drop backgrounds (browser print, printBackground:false). */
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Arial, Helvetica, sans-serif; color: #222; }
  .page { width: 210mm; min-height: 297mm; padding: 13mm 18mm; display: flex; flex-direction: column; page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .masthead { border-bottom: 1px solid ${GOLD}; padding-bottom: 6px; font-size: 11px; font-weight: 700; color: ${NAVY}; }
  .foot { margin-top: auto; border-top: 1px solid ${GOLD}; padding-top: 6px; font-family: monospace; font-size: 8px; color: ${MUTED}; }
  .eyebrow { font-family: monospace; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${GOLD_DARK}; margin-top: 26px; }
  h1.title { font-size: 26px; color: ${NAVY}; margin-top: 6px; }
  p { line-height: 1.55; font-size: 13px; }
  .muted { color: ${MUTED}; }
  .hero, .slot { border: 1px dashed ${GOLD}; background: ${GOLD_LIGHT}; display: flex; align-items: center; justify-content: center; text-align: center; overflow: hidden; }
  .hero img, .slot img { width: 100%; height: 100%; object-fit: cover; }
  .hero { height: 95mm; margin-top: 20px; }
  .caption { text-align: center; font-size: 10px; font-style: italic; color: ${MUTED}; margin-top: 4px; }
  .cover-title { text-align: center; margin-top: 18px; }
  .cover-title h1 { font-size: 34px; text-transform: uppercase; letter-spacing: 2px; color: ${NAVY}; }
  .cover-title .sub { font-size: 18px; font-weight: 700; color: ${GOLD_DARK}; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 22px; font-size: 13px; }
  .cover-table td { padding: 9px 12px; }
  .cover-table .lbl { background: ${NAVY}; color: #fff; font-weight: 700; width: 50mm; }
  .cover-table .val { background: #f4f5f7; }
  .cover-table .lbl.hi { background: ${GOLD}; }
  .cover-table .val.hi { background: ${NAVY}; color: #fff; font-weight: 700; }
  .tagline { margin-top: auto; text-align: center; font-size: 16px; font-style: italic; font-weight: 700; color: ${MUTED}; padding-top: 18px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 22px; }
  .gallery { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 22px; }
  .gallery .slot { height: 46mm; }
  .box { border: 1px solid ${BORDER}; padding: 16px; }
  .box .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: ${MUTED}; }
  .box .big { font-weight: 700; color: ${NAVY}; margin-top: 6px; }
  /* Column flow, not a fixed 5: void and granny flat add cells only when present. */
  .areatable { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; border: 1px solid ${BORDER}; margin-top: 26px; text-align: center; }
  .areatable > div { padding: 14px 6px; border-right: 1px solid ${BORDER}; font-size: 12px; }
  .areatable > div:last-child { border-right: none; background: ${NAVY}; color: #fff; }
  .areatable .cap { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: ${MUTED}; }
  .areatable > div:last-child .cap { color: #cfd6e6; }
  .areatable .num { font-family: monospace; font-weight: 700; margin-top: 6px; }
  .spechead { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${NAVY}; margin-top: 22px; }
  .spectable { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid ${BORDER}; margin-top: 8px; text-align: center; }
  .spectable > div { padding: 12px 6px; border-right: 1px solid ${BORDER}; font-size: 12px; }
  .spectable > div:last-child { border-right: none; }
  .spectable .cap { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: ${MUTED}; }
  .spectable .num { font-family: monospace; font-weight: 700; margin-top: 6px; }
  .pricebox { border: 1px solid ${BORDER}; background: ${GOLD_LIGHT}; padding: 24px; text-align: center; margin-top: 26px; }
  .pricebox .save { font-size: 13px; font-weight: 700; color: ${GOLD_DARK}; }
  .pricebox .big { font-size: 46px; font-weight: 700; color: ${NAVY}; margin-top: 4px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 26px; }
  .cols h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: ${NAVY}; }
  .cols ul { list-style: none; margin-top: 12px; }
  .cols li { position: relative; padding-left: 16px; margin-bottom: 10px; font-size: 13px; line-height: 1.5; }
  /* The includes list grows with the offer, and page 4 has a fixed height. At
     15 items the last line was printing over the footer rule. Tighten the gap
     first (whitespace is cheapest to lose), then the type, so a long list stays
     on its page instead of spilling. */
  .cols.tight li { margin-bottom: 6px; font-size: 12.5px; line-height: 1.45; }
  .cols.tighter li { margin-bottom: 4px; font-size: 12px; line-height: 1.4; }
  .cols.tightest li { margin-bottom: 2px; font-size: 11.5px; line-height: 1.35; }
  /* A GLYPH, not a background box. Drawing the bullet with background-color
     meant it vanished entirely on any print path with "Background graphics"
     off — the client received a bare indented list with no bullets at all.
     Text always prints. */
  .cols li:before { content: "\\25AA"; position: absolute; left: 0; top: 0; color: ${GOLD}; font-size: inherit; line-height: inherit; }
  .inc { width: 100%; border-collapse: collapse; margin-top: 22px; font-size: 13px; }
  .inc th { text-align: left; text-transform: uppercase; font-size: 11px; letter-spacing: 1px; color: ${MUTED}; background: #f2f3f5; border-top: 1px solid ${BORDER}; border-bottom: 1px solid ${BORDER}; padding: 10px; }
  .inc td { border-bottom: 1px solid ${BORDER}; padding: 10px; vertical-align: top; }
  .inc td.cat { font-weight: 700; color: ${NAVY}; width: 45mm; }
  .inc th.amt, .inc td.amt { text-align: right; width: 30mm; white-space: nowrap; }
  .inc .sub { font-weight: 400; color: ${MUTED}; font-size: 11px; margin-top: 3px; line-height: 1.45; }
  .inc.alw td.cat { width: auto; }
  .inc.alw th:last-child, .inc.alw td:last-child { width: 70mm; }
  .inc td.amt { font-family: monospace; color: ${NAVY}; }
  .pay th { text-align: left; text-transform: uppercase; font-size: 11px; letter-spacing: 1px; color: ${MUTED}; background: #f2f3f5; border-top: 1px solid ${BORDER}; border-bottom: 1px solid ${BORDER}; padding: 10px; }
  .pay td { border-bottom: 1px solid ${BORDER}; padding: 12px 10px; font-size: 13px; }
  .pay td.stage { font-weight: 700; }
  .pay td.amt { font-family: monospace; }
  .sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 30px; font-size: 13px; }
  .sig { break-inside: avoid; }
  .sig h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: ${NAVY}; margin-bottom: 14px; }
  .sig p { margin-bottom: 14px; }
</style></head><body>${pages.join("")}</body></html>`;
}

function coverPage(
  input: OfferPrintTemplateInput,
  data: ReturnType<typeof buildOfferPrintTemplateData>,
  images: OfferImageMap,
  foot: string,
): string {
  const { job } = input;
  const hero = images.hero;
  // "Client" cover row lists every owner (companies annotated with ABN/ACN);
  // co-owners fall onto a muted "and …" sub-line. Reads owners[] (source of
  // truth); single-owner offers render unchanged.
  const clientCell = ownerNamesCellHtml(job);
  // Both addresses are labelled per issue #109. Current Location is the primary
  // owner's residential/postal address; Site Location is the build site.
  const currentLocationRow = job.currentLocation.trim()
    ? coverRow("Current Location", job.currentLocation)
    : "";
  return `<div class="page">
    <div class="masthead">${esc(COMPANY_LINE)}</div>
    ${hero ? `<div class="hero"><img src="${esc(hero.url)}" alt="" /></div>` : ""}
    ${hero?.source === "ai" ? `<div class="caption">AI concept, indicative only</div>` : ""}
    <div class="cover-title"><h1>Building Proposal</h1><div class="sub">${esc(job.buildType)}</div></div>
    <table class="cover-table">
      ${coverRowHtml("Client", clientCell)}
      ${currentLocationRow}
      ${coverRow("Site Location", job.siteAddress)}
      ${coverRow("Build Type", job.buildType)}
      ${coverRow("Total Build Area", data.areaLabel)}
      ${coverRow("Contract Price", data.priceLine, true)}
      ${coverRow("Quote Reference", `${job.reference}-${job.revision} | Valid: ${data.validUntilLabel}`)}
      ${coverRow("Prepared By", job.preparedBy)}
      ${coverRow("Date", data.preparedDateLabel)}
    </table>
    <div class="tagline">${esc(PROPOSAL_TAGLINE)}</div>
    ${foot}
  </div>`;
}

function coverRow(label: string, value: string, hi = false): string {
  return `<tr><td class="lbl${hi ? " hi" : ""}">${esc(label)}</td><td class="val${hi ? " hi" : ""}">${esc(value)}</td></tr>`;
}

// Variant that injects already-escaped/pre-built HTML into the value cell
// (used to render the secondary client as a sub-line under the primary).
function coverRowHtml(label: string, valueHtml: string, hi = false): string {
  return `<tr><td class="lbl${hi ? " hi" : ""}">${esc(label)}</td><td class="val${hi ? " hi" : ""}">${valueHtml}</td></tr>`;
}

function welcomePage(
  job: OfferPrintTemplateInput["job"],
  foot: string,
): string {
  // Greet EVERY owner (shared helper, also used by the React print template).
  // Falls back to the legacy clientNames/secondary pair only when owners[] is
  // empty — that pair dropped owners 3+ from the greeting.
  const legacyGreeting = (() => {
    const secondary = job.secondaryCustomerName?.trim() ?? "";
    const primary = job.clientNames
      .replace(/^(Mr|Ms|Mrs|Mr & Ms|Mr & Mrs)\s+/i, "")
      .replace(/\s*&\s*(Ms|Mrs)\s+/i, " and ");
    return secondary ? `${primary} and ${secondary}` : primary;
  })();
  const greeting =
    formatOwnerGreetingNames(job.owners ?? []) || legacyGreeting;
  const paragraphs = buildWelcomeParagraphs(job)
    .map((p) => `<p style="margin-bottom:14px;">${esc(p)}</p>`)
    .join("");
  return `<div class="page">
    <div class="masthead">${esc(COMPANY_LINE)}</div>
    <div class="eyebrow">A personal welcome</div>
    <h1 class="title">Dear ${esc(greeting)},</h1>
    <div style="margin-top:16px;max-width:155mm;">${paragraphs}</div>
    <div style="margin-top:26px;">
      <p style="font-weight:700;color:${NAVY};">${esc(job.preparedBy)}</p>
      <p class="muted" style="font-size:12px;">Lic. 383992C | MBA Accredited</p>
    </div>
    ${foot}
  </div>`;
}

function galleryPage(
  images: readonly AttachedOfferImageSlot[],
  foot: string,
): string {
  const slots = images
    .map((slot) => {
      const caption = offerImageCaption(slot.caption, slot.image.source);
      return `<div><div class="slot"><img src="${esc(slot.image.url)}" alt="" /></div><div class="caption">${esc(caption)}</div></div>`;
    })
    .join("");
  return `<div class="page">
    <div class="masthead">${esc(COMPANY_LINE)}</div>
    <div class="eyebrow">Our work</div>
    <h1 class="title">Your home will be finished to this standard</h1>
    <p class="muted" style="margin-top:12px;max-width:155mm;">The images below are from a recently completed home — built to a similar size and finish level. Full render to all elevations, luxury shaker kitchen, ${esc(OFFER_SPEC_FACTS.stoneBenchtopThickness)} stone benchtops and floor-to-ceiling tiles to the wet areas. Finishes on your home are as per the inclusions schedule.</p>
    <div class="gallery">${slots}</div>
    ${foot}
  </div>`;
}

function snapshotPage(
  input: OfferPrintTemplateInput,
  data: ReturnType<typeof buildOfferPrintTemplateData>,
  foot: string,
): string {
  const { job } = input;
  const area = buildAreaBreakdown(job);
  const scope = job.buildScope
    .filter((line) => line.trim())
    .map((line) => `<li style="font-size:13px;color:${MUTED};">${esc(line)}</li>`)
    .join("");
  const cell = (cap: string, num: string) =>
    `<div><div class="cap">${esc(cap)}</div><div class="num">${esc(num)}</div></div>`;
  const particulars = formatSiteParticulars(job);
  // Room counts print per dwelling: the major house always, the granny home only
  // when the build includes one.
  const specSection = (title: string, spec: OfferDwellingSpec) =>
    `<div class="spechead">${esc(title)}</div>
    <div class="spectable">
      ${cell("Bedrooms", formatRoomCount(spec.bedrooms))}
      ${cell("Bathrooms", formatRoomCount(spec.bathrooms))}
      ${cell("Garage Spaces", formatRoomCount(spec.garageSpaces))}
    </div>`;
  const granny = grannyDwellingSpec(job);
  return `<div class="page">
    <div class="masthead">${esc(COMPANY_LINE)}</div>
    <div class="eyebrow">Project snapshot</div>
    <h1 class="title">Site and build scope</h1>
    <div class="grid2">
      <div class="box"><div class="lbl">Site</div><div class="big">${esc(job.siteAddress)}</div><div style="margin-top:10px;">${job.dpNumber.trim() ? `<p class="muted" style="font-size:12px;">${esc(job.dpNumber)}</p>` : ""}${particulars ? `<p class="muted" style="font-size:12px;">${esc(particulars)}</p>` : ""}</div></div>
      <div class="box"><div class="lbl">Build scope</div><div class="big">${esc(job.buildType)}</div><ul style="margin-top:8px;list-style:none;">${scope}</ul></div>
    </div>
    <div class="areatable">
      ${area.cells.map((entry) => cell(entry.label, formatArea(entry.sqm))).join("")}
      ${cell("Total Area", formatArea(area.totalSqm))}
    </div>
    <p class="muted" style="margin-top:22px;font-size:12px;">Total build area ${esc(data.areaLabel)}.</p>
    ${specSection("Major House Specifications", {
      bathrooms: job.bathrooms,
      bedrooms: job.bedrooms,
      garageSpaces: job.garageSpaces,
    })}
    ${granny ? specSection("Granny Home Specifications", granny) : ""}
    ${foot}
  </div>`;
}

// How hard to squeeze the page-4 lists so they stay on page 4.
//
// Budgeted in LINE UNITS, not item count: a wrapped item costs two lines, and
// it was a 15-item list of mostly-wrapping lines that pushed the last entry
// over the footer rule. The two columns sit side by side, so the taller one
// decides. Thresholds verified against real Chromium output.
export function investmentListDensity(
  includes: readonly string[],
  excludes: readonly string[],
): "" | "tight" | "tighter" | "tightest" {
  const lines = (items: readonly string[]) =>
    items.reduce(
      (sum, item) => sum + estimateWrappedLines(item, CHARS_PER_LINE_INVESTMENT),
      0,
    );
  const tallest = Math.max(lines(includes), lines(excludes));
  if (tallest <= 16) return "";
  if (tallest <= 21) return "tight";
  if (tallest <= 26) return "tighter";
  return "tightest";
}

function investmentPage(
  input: OfferPrintTemplateInput,
  data: ReturnType<typeof buildOfferPrintTemplateData>,
  foot: string,
): string {
  const { draft, customerPrice, priceAdjustmentLabel, standardPriceIncGst } = input;
  const saving =
    data.savingAmount !== null && data.savingAmount > 0
      ? `<div class="save">Standard price ${money(standardPriceIncGst)} - ${esc(priceAdjustmentLabel || "saving")} ${money(data.savingAmount)}</div>`
      : "";
  const includes = data.summaryInclusions.map((b) => `<li>${esc(b)}</li>`).join("");
  const excludes = data.exclusionBullets.map((b) => `<li>${esc(b)}</li>`).join("");
  return `<div class="page">
    <div class="masthead">${esc(COMPANY_LINE)}</div>
    <div class="eyebrow">Investment summary</div>
    <h1 class="title">${esc(draft.headline)}</h1>
    <p style="margin-top:14px;max-width:155mm;">${esc(draft.introText)}</p>
    <div class="pricebox">
      ${saving}
      <div class="lbl" style="text-transform:uppercase;font-size:11px;letter-spacing:1px;color:${MUTED};margin-top:6px;">Your fixed contract price</div>
      <div class="big">${money(customerPrice.selectedContractValueIncGst)}</div>
      <div class="muted" style="font-family:monospace;font-size:13px;margin-top:6px;">Including GST | MBA fixed price contract | Valid until ${esc(data.validUntilLabel)}</div>
    </div>
    <div class="cols ${investmentListDensity(data.summaryInclusions, data.exclusionBullets)}">
      <div><h2>This price includes</h2><ul>${includes}</ul></div>
      <div><h2>This price excludes</h2><ul>${excludes}</ul></div>
    </div>
    ${foot}
  </div>`;
}

function inclusionsPage(
  specifications: readonly OfferInclusionEntry[],
  startIndex: number,
  continued: boolean,
  foot: string,
): string {
  const body = specifications
    .map(
      (entry) =>
        `<tr><td class="cat">${esc(entry.category?.trim() || UNCATEGORISED_INCLUSION_LABEL)}</td><td class="muted">${esc(entry.spec)}</td></tr>`,
    )
    .join("");
  const intro = continued
    ? ""
    : `<p class="muted" style="margin-top:12px;max-width:155mm;">All items below are fixed within your contract price. Design provided by owner/architect — all costs fixed as per approved plans, confirmed at colour selection.</p>`;
  return `<div class="page">
    <div class="masthead">${esc(COMPANY_LINE)}</div>
    <div class="eyebrow">Inclusions</div>
    <h1 class="title">Full inclusions schedule${continued ? " (cont.)" : ""}</h1>
    ${intro}
    <table class="inc"><thead><tr><th>Category</th><th>Specification</th></tr></thead><tbody>${body}</tbody></table>
    ${foot}
  </div>`;
}

// Prime cost and provisional sums, mirroring PrintAllowancesPage in
// offer-workspace-print-template.tsx so the emailed PDF and the printed
// document disclose the same allowances in the same place. `scopeRows` was
// computed and rendered by neither before this. A continued page drops the intro,
// as the inclusions schedule does.
function allowancesPage(
  rows: readonly OfferPrintScopeRow[],
  continued: boolean,
  foot: string,
): string {
  const body = rows
    .map(
      (row) =>
        `<tr><td class="cat">${esc(row.label)}${row.description ? `<div class="sub">${esc(row.description)}</div>` : ""}</td><td class="amt">${esc(row.amountLabel)}</td><td class="muted">${esc(row.variationRule) || "&mdash;"}</td></tr>`,
    )
    .join("");
  return `<div class="page">
    <div class="masthead">${esc(COMPANY_LINE)}</div>
    <div class="eyebrow">Allowances</div>
    <h1 class="title">Prime cost &amp; provisional sums${continued ? " (cont.)" : ""}</h1>
    ${continued ? "" : `<p class="muted" style="margin-top:12px;max-width:155mm;">The amounts below are allowances held within your fixed contract price, not fixed costs. Where your final selection costs more or less than the allowance, the difference is adjusted by written variation as set out against each item.</p>`}
    <table class="inc alw"><thead><tr><th>Item</th><th class="amt">Allowance</th><th>If the actual cost differs</th></tr></thead><tbody>${body}</tbody></table>
    ${foot}
  </div>`;
}

// Acceptance paragraph — names every owner ("I/We, A and B and C, accept…").
// Single-owner offers keep the "I/We, <owner>, accept…" wording; `I/We` covers
// both. Falls back to the clientNames projection when owners[] is empty.
// Returns HTML-ready text (owner names already escaped) — insert it directly, do
// NOT wrap in esc() again or a company name like "Smith & Jones" double-escapes to
// "Smith &amp;amp; Jones" in the legal acceptance paragraph (PR #124 review).
function acceptanceLineHtml(job: OfferWorkspaceJob): string {
  const owners = job.owners ?? [];
  const acceptanceNames =
    owners.length > 0
      ? owners
          .map((owner) => owner.displayName.trim())
          .filter(Boolean)
          .map(esc)
          .join(" and ")
      : esc(job.clientNames);
  return `I/We, ${acceptanceNames}, accept this proposal and agree to proceed to a Master Builders Association fixed price home building contract.`;
}

// Plain-text twin of acceptanceLineHtml, used ONLY to estimate the paragraph's
// rendered height. Escaping inflates character counts (an "&" becomes "&amp;"),
// so measuring the HTML would overstate how many lines it wraps to.
function acceptanceLineText(job: OfferWorkspaceJob): string {
  const owners = job.owners ?? [];
  const names =
    owners.length > 0
      ? owners
          .map((owner) => owner.displayName.trim())
          .filter(Boolean)
          .join(" and ")
      : job.clientNames;
  return `I/We, ${names}, accept this proposal and agree to proceed to a Master Builders Association fixed price home building contract.`;
}

// A wet-sign rule, or — in `forSignature` mode — the DocuSign anchor token that
// AutoPlaces the matching signature/date tab for customer signer `k` (1-based).
// The anchor number MUST match the recipient order in lib/docusign/offer-envelope
// (both walk collectOfferSigners in the same order), so sigOwner{k} maps to
// recipient k. Only the customer blocks carry anchors — the acceptance is
// customer-only (ADR 0004).
function signLine(kind: "sig" | "date", index: number, forSignature: boolean): string {
  if (!forSignature) {
    return "_______________________";
  }
  return anchor(`${kind === "sig" ? "sigOwner" : "dateOwner"}${index + 1}`);
}

// The ordered signature blocks: client blocks first (each individual owner;
// each company director, labelled with capacity + company), then the builder
// block below. Falls back to the clientNames projection when owners[] is empty.
// In `forSignature` mode the client blocks carry DocuSign anchors and the
// builder block becomes a non-signature "Prepared by" credit (the builder does
// not sign the acceptance).
function signatureBlocksHtml(
  job: OfferWorkspaceJob,
  forSignature: boolean,
): SignatureBlock[] {
  const signers = collectOfferSigners(job.owners ?? []);
  const clientSigs: SignatureBlock[] =
    signers.length > 0
      ? signers.map((signer, index) => {
          const heading =
            signers.length > 1
              ? `Client acceptance ${index + 1}`
              : "Client acceptance";
          // The plain-text form drives the height estimate — a company director
          // renders as "Name, Director of <full legal name>", which wraps.
          const whoText = signer.entityName
            ? `${signer.signatory.name}, ${signer.signatory.capacity} of ${signer.entityName}`
            : signer.signatory.name;
          const who = signer.entityName
            ? `${esc(signer.signatory.name)}, ${esc(signer.signatory.capacity)} of ${esc(signer.entityName)}`
            : esc(signer.signatory.name);
          return {
            html: `<div class="sig"><h3>${esc(heading)}</h3><p>Signature: ${signLine("sig", index, forSignature)}</p><p>${who}</p><p>Date: ${signLine("date", index, forSignature)}</p></div>`,
            lines: signatureBlockLines(whoText),
          };
        })
      : [
          {
            html: `<div class="sig"><h3>Client acceptance</h3><p>Signature: ${signLine("sig", 0, forSignature)}</p><p>${esc(job.clientNames)}</p><p>Date: ${signLine("date", 0, forSignature)}</p></div>`,
            lines: signatureBlockLines(job.clientNames),
          },
        ];
  // Builder block: a wet-sign block on the emailed copy; on the DocuSign copy the
  // builder does not sign, so show a "Prepared by" credit with no anchor and no
  // blank signature rule (which would read as an unsigned builder line).
  const builderBlock: SignatureBlock = forSignature
    ? {
        html: `<div class="sig"><h3>Prepared by</h3><p>${esc(job.preparedBy)}</p><p class="muted">Royal Constructions Pty Ltd</p></div>`,
        lines: signatureBlockLines(job.preparedBy),
      }
    : {
        html: `<div class="sig"><h3>For Royal Constructions Pty Ltd</h3><p>Signature: _______________________</p><p>${esc(job.preparedBy)}</p><p>Date: ___________________________</p></div>`,
        lines: signatureBlockLines(job.preparedBy),
      };
  return [...clientSigs, builderBlock];
}

// Terms + payment schedule. When the signatures fit inline (few signers) they are
// rendered here under the table exactly as before; otherwise inlineBlocks is null
// and the signatures are emitted on their own signaturePage(s).
function termsPage(
  input: OfferPrintTemplateInput,
  data: ReturnType<typeof buildOfferPrintTemplateData>,
  inlineBlocks: readonly SignatureBlock[] | null,
  foot: string,
): string {
  const { job } = input;
  const rows = data.paymentRows
    .map(
      (row) =>
        `<tr><td class="stage">${esc(row.stageName)}</td><td class="amt">${(row.percentOfContract * 100).toFixed(0)}% - ${money(row.amount)}</td><td class="muted">${esc(row.trigger)}</td></tr>`,
    )
    .join("");
  const acceptance = inlineBlocks
    ? `<p class="muted" style="margin-top:12px;max-width:155mm;">${acceptanceLineHtml(job)}</p>`
    : "";
  const sigs = inlineBlocks
    ? `<div class="sigs">${inlineBlocks.map((b) => b.html).join("")}</div>`
    : `<p class="muted" style="margin-top:12px;max-width:155mm;">Sign the acceptance on the following page to proceed.</p>`;
  return `<div class="page">
    <div class="masthead">${esc(COMPANY_LINE)}</div>
    <div class="eyebrow">Next steps</div>
    <h1 class="title">Terms and payment schedule</h1>
    ${acceptance}
    <table class="pay"><thead><tr><th>Stage</th><th>Amount</th><th>Trigger</th></tr></thead><tbody>${rows}</tbody></table>
    ${sigs}
    ${foot}
  </div>`;
}

// A dedicated signature page (used when there are too many signers to fit inline
// on the terms page). The acceptance paragraph leads the first such page.
function signaturePage(
  job: OfferWorkspaceJob,
  blocks: readonly SignatureBlock[],
  continued: boolean,
  foot: string,
): string {
  const acceptance = continued
    ? ""
    : `<p class="muted" style="margin-top:12px;max-width:155mm;">${acceptanceLineHtml(job)}</p>`;
  return `<div class="page">
    <div class="masthead">${esc(COMPANY_LINE)}</div>
    <div class="eyebrow">Acceptance</div>
    <h1 class="title">Acceptance &amp; signatures${continued ? " (cont.)" : ""}</h1>
    ${acceptance}
    <div class="sigs">${blocks.map((b) => b.html).join("")}</div>
    ${foot}
  </div>`;
}
