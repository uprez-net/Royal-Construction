import {
  buildOfferPrintTemplateData,
  formatArea,
  COMPANY_LINE,
  type OfferPrintTemplateInput,
} from "./workspace-print-template";
import {
  formatBoundedOwnerList,
  CHARS_PER_LINE_SIGNATURE,
  CHARS_PER_LINE_TABLE_CELL,
  chunkByEstimatedHeight,
  chunkInclusionSchedule,
  inclusionPageStartIndexes,
  UNCATEGORISED_INCLUSION_LABEL,
  type OfferInclusionEntry,
  collectOfferSigners,
  estimateWrappedLines,
  type OfferOwner,
  type OfferSignerContext,
  type OfferWorkspaceJob,
} from "./workspace-model";

// Legal fixed-price building Tender document (distinct from the marketing Offer
// proposal). Sections: parties + contract sum, particulars, numbered inclusions
// with status, exclusions, progress payments, terms, and an execution page whose
// signature/date/initial fields carry DocuSign anchor strings for AutoPlace:
//
//   \sigBuilder\  \dateBuilder\
//   \sigOwner1\   \dateOwner1\   \initOwner1\
//   \sigOwner2\   \dateOwner2\   \initOwner2\
//
// DocuSign locates these strings and drops the matching field on top of them.

const NAVY = "#1e2b4d";
const GOLD = "#b8873b";
const GOLD_DARK = "#8f6a24";
const BORDER = "#d9d9d6";
const MUTED = "#5f5f5f";

// Execution signature blocks per page. Each carries a signature space, a date
// line and (for owners) an initial line, so they are tall — 4 is a conservative
// fit for A4 alongside the masthead and the acceptance paragraph. Shared with the
// contract annexure so both legal documents paginate signatures identically.
export const SIGNATURE_BLOCKS_PER_PAGE = 4;

type ExecutionBlock = { readonly html: string; readonly lines: number };

// An execution signature block in line units: its fixed chrome (border, 46px
// signature space, date rule, and for owners an "initial each page" line) plus
// however many lines the party description wraps to.
function executionBlockLines(whoText: string, hasInitialLine: boolean): number {
  const chrome = hasInitialLine ? 7 : 6;
  return chrome + estimateWrappedLines(whoText, CHARS_PER_LINE_SIGNATURE);
}

// Line budget for one execution page. Verified against real Chromium output.
const EXECUTION_LINES_PER_PAGE = 30;
// Owner Details rows that still fit on the cover beneath the masthead, parties
// block and contract sum; past this the table moves to its own page(s).
// Budgets in ESTIMATED WRAPPED LINES (not logical rows): a long company legal
// name or registered office wraps, making its row several lines tall. Verified
// against real Chromium output across the owner-configuration matrix.
const OWNER_DETAIL_LINES_INLINE = 5;
const OWNER_DETAIL_LINES_PER_PAGE = 26;

// An owner's contribution to the Owner Details table, in line units. An
// individual is one row whose height is the tallest of its cells; a company is a
// header row plus one row per director.
function ownerDetailLines(owner: OfferOwner): number {
  const cell = (text: string) =>
    estimateWrappedLines(text, CHARS_PER_LINE_TABLE_CELL);
  const nameCell = cell(
    owner.kind === "company" && owner.abn.trim().length > 0
      ? `${owner.displayName} (ABN/ACN ${owner.abn})`
      : owner.displayName,
  );
  const headerRow = Math.max(nameCell, cell(owner.currentLocation));
  if (owner.kind === "individual") {
    const signer = owner.signatories[0];
    return Math.max(
      headerRow,
      cell(signer?.email ?? ""),
      cell(signer?.phone ?? ""),
    );
  }
  return (
    headerRow +
    owner.signatories.reduce(
      (sum, director) =>
        sum + Math.max(cell(director.name), cell(director.email)),
      0,
    )
  );
}

// Shared by the Tender and Contract builders (see offer-contract-html.ts).
export function esc(value: string): string {
  return value
    // Strip backslashes so user-controlled text (client name, address, scope)
    // cannot smuggle a DocuSign anchor token like \sigOwner1\ into the PDF and
    // steal a signature/date/initial field via AutoPlace. Real anchors are
    // emitted by anchor(), never through esc().
    .replace(/\\/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function money(value: number | null): string {
  if (value === null) return "-";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(value);
}

// A DocuSign anchor rendered small and light — present for AutoPlace, unobtrusive.
export function anchor(tag: string): string {
  return `<span style="color:#c8c8c8;font-size:7px;">\\${tag}\\</span>`;
}

export function masthead(): string {
  const parts = COMPANY_LINE.split(" | ");
  return `<div class="masthead"><span>${esc(parts[0])}</span><span>${esc(parts.slice(1).join("  |  "))}</span></div>`;
}

export function buildTenderHtml(input: OfferPrintTemplateInput): string {
  const data = buildOfferPrintTemplateData(input);
  const { job } = input;
  // The ordered signer list — one per individual owner and one per company
  // director. The DocuSign envelope (offer-tender-sign.ts) builds recipients
  // from the SAME collectOfferSigners() call in the SAME order, so anchor
  // sigOwner{k} on this PDF maps to recipient k. See ADR 0003.
  const signers = collectOfferSigners(job.owners);
  const reference = `${job.reference}-${job.revision}`;
  const totalArea =
    job.groundFloorSqm +
    job.firstFloorSqm +
    job.garageSqm +
    job.alfrescoPorchSqm +
    job.porchSqm +
    job.grannyFlatSqm;

  // The schedule the estimator edited on this offer — not a module constant.
  // An empty schedule produces zero pages rather than an empty table.
  const inclusionChunks = chunkInclusionSchedule(input.draft.inclusionSchedule);
  const inclusionStartIndexes = inclusionPageStartIndexes(inclusionChunks);

  // Execution signature blocks (customer signers first, then the builder) are
  // chunked across as many pages as they need. Previously every block was emitted
  // on ONE page while the footer counted a single execution page, so the
  // supported 10 signers overflowed onto physical pages the count never declared
  // and a block could split mid-signature — on the document that is actually
  // signed (PR #124 review; the proposal + browser-print renderers were fixed
  // earlier, this legal Tender renderer is a third, separate one).
  const executionBlocks = buildExecutionBlocks(job, signers);
  const executionChunks: string[][] = chunkByEstimatedHeight(
    executionBlocks,
    EXECUTION_LINES_PER_PAGE,
    (block) => block.lines,
  ).map((chunk) => chunk.map((block) => block.html));

  // Owner Details rows also lived entirely on the cover, under the masthead,
  // parties block and contract sum. With ten owners that pushed the cover past
  // one physical sheet, so Chromium printed a page the footer never counted and
  // "Page 1 of N" appeared on sheet 2 (PR #124 review). A short list still sits
  // inline on the cover (the common case, output unchanged); anything longer
  // moves to its own counted page(s). Note a COMPANY owner contributes a header
  // row plus one row per director, so count rendered ROWS, not owners.
  const detailOwners = job.owners ?? [];
  const ownerDetailRows = detailOwners.map(ownerDetailRowsHtml);
  // A company renders a header row PLUS one row per director, and any cell can
  // WRAP — a long legal name or registered office makes its row several lines
  // tall. Counting logical rows (as this first did) therefore still under-counted
  // height; budget by estimated wrapped lines instead (PR #124 review).
  const ownerDetailEntries = detailOwners.map(
    (owner: OfferOwner, index: number) => ({
      html: ownerDetailRows[index],
      lines: ownerDetailLines(owner),
    }),
  );
  const ownerDetailTotal = ownerDetailEntries.reduce(
    (sum: number, entry: { lines: number }) => sum + entry.lines,
    0,
  );
  const inlineOwnerDetails = ownerDetailTotal <= OWNER_DETAIL_LINES_INLINE;
  // An owner is ATOMIC — its header and director rows must not split across
  // sheets — so an owner that would exceed the budget starts the next page.
  const ownerDetailChunks: string[][] = (
    inlineOwnerDetails
      ? []
      : chunkByEstimatedHeight(
          ownerDetailEntries,
          OWNER_DETAIL_LINES_PER_PAGE,
          (entry) => entry.lines,
        )
  ).map((chunk) => chunk.map((entry) => entry.html));

  const totalPages =
    1 +
    ownerDetailChunks.length +
    inclusionChunks.length +
    1 +
    1 +
    executionChunks.length;
  let pageNo = 0;
  const foot = (): string => {
    pageNo += 1;
    return `<div class="foot"><span>Fixed Price Building Tender — ${esc(reference)}</span><span>Page ${pageNo} of ${totalPages}</span></div>`;
  };

  const body = [
    coverPage(
      input,
      data,
      reference,
      totalArea,
      inlineOwnerDetails ? ownerDetailRows : null,
      foot(),
    ),
    ...ownerDetailChunks.map((rows, index) =>
      ownerDetailsPage(rows, index > 0, foot()),
    ),
    ...inclusionChunks.map((rows, index) =>
      inclusionsPage(rows, inclusionStartIndexes[index], index > 0, foot()),
    ),
    exclusionsPaymentPage(data, foot()),
    termsPage(data, foot()),
    ...executionChunks.map((blocks, index) =>
      executionPage(
        job,
        reference,
        blocks,
        index > 0,
        index === executionChunks.length - 1,
        foot(),
      ),
    ),
  ].join("");

  return legalDocShell(body);
}

// NOTE: getTenderOwners()/splitOwners() were removed here (PR #124 sweep). They
// derived the Tender signer list by splitting the legacy combined `clientNames`
// string, which the owners[] party model replaced. Both were already dead (zero
// callers) but remained EXPORTED — a live trap, since a future caller would have
// produced a signer list that diverges from collectOfferSigners() and orphaned
// the AutoPlace anchors, exactly the mismatch their own comments warned about.
// The anchors and the DocuSign recipients both come from collectOfferSigners().

// Shared A4 page shell + stylesheet for the legal documents (Tender and
// Contract) so both render with identical branding and print metrics.
export function legalDocShell(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1f1f1f; font-size: 11.5px; line-height: 1.5; }
  .page { width: 210mm; min-height: 297mm; padding: 16mm 18mm; display: flex; flex-direction: column; page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .masthead { border-bottom: 2px solid ${GOLD}; padding-bottom: 6px; font-size: 10px; font-weight: 700; color: ${NAVY}; display: flex; justify-content: space-between; }
  .foot { margin-top: auto; border-top: 1px solid ${GOLD}; padding-top: 6px; font-family: monospace; font-size: 8px; color: ${MUTED}; display: flex; justify-content: space-between; }
  h1.doc { font-size: 24px; color: ${NAVY}; letter-spacing: 1px; text-transform: uppercase; margin-top: 26px; }
  .refline { color: ${GOLD_DARK}; font-weight: 700; margin-top: 4px; font-size: 13px; }
  h2 { font-size: 13px; color: ${NAVY}; text-transform: uppercase; letter-spacing: 1px; margin-top: 22px; border-bottom: 1px solid ${BORDER}; padding-bottom: 4px; }
  p { margin-top: 8px; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 12px; }
  .party { border: 1px solid ${BORDER}; padding: 12px; }
  .party .role { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: ${MUTED}; }
  .party .who { font-weight: 700; color: ${NAVY}; margin-top: 4px; font-size: 13px; }
  .sum { margin-top: 18px; border: 1px solid ${NAVY}; }
  .sum .top { background: ${NAVY}; color: #fff; padding: 10px 14px; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; }
  .sum .amt { padding: 14px; font-size: 30px; font-weight: 700; color: ${NAVY}; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { text-align: left; background: #f2f3f5; border-top: 1px solid ${BORDER}; border-bottom: 1px solid ${BORDER}; padding: 7px 9px; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: ${MUTED}; }
  td { border-bottom: 1px solid ${BORDER}; padding: 7px 9px; vertical-align: top; }
  td.num { width: 8mm; color: ${MUTED}; }
  td.cat { width: 40mm; font-weight: 700; color: ${NAVY}; }
  td.status { width: 22mm; }
  .pill { display: inline-block; background: #e7efe1; color: #2f6b2f; border-radius: 3px; padding: 1px 6px; font-size: 9px; font-weight: 700; }
  ul { margin-top: 8px; padding-left: 18px; }
  li { margin-bottom: 5px; }
  ol.terms { margin-top: 10px; padding-left: 18px; }
  ol.terms > li { margin-bottom: 9px; }
  ol.terms b { color: ${NAVY}; }
  .note { margin-top: 14px; border-left: 3px solid ${GOLD}; background: #faf6ec; padding: 10px 12px; font-size: 10.5px; color: ${MUTED}; }
  .sig { border: 1px solid ${BORDER}; padding: 14px; margin-top: 14px; break-inside: avoid; page-break-inside: avoid; }
  .sig .who { font-weight: 700; color: ${NAVY}; }
  .sig .lines { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 22px; }
  .sig .field { border-top: 1px solid #333; padding-top: 4px; font-size: 9px; color: ${MUTED}; text-transform: uppercase; letter-spacing: 1px; }
  .sigspace { height: 46px; }
  .build-scope {
    border: 1px solid #8d7b57;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 13px;
  }

  .build-scope .top {
    background: #d8b15b;
    color: #000;
    text-align: center;
    font-weight: bold;
    padding: 6px 10px;
    border-bottom: 1px solid #8d7b57;
  }

  .build-scope .amt {
    background: #f4edd6;
    padding: 10px 14px;
  }

  .scope-list {
    margin: 0;
    padding-left: 18px;

    display: grid;
    grid-template-columns: repeat(2, 1fr);
    column-gap: 32px;
    row-gap: 4px;

    position: relative;
  }

  /* A BORDER, not a background: a background-drawn rule disappears on any
     print path with "Background graphics" off. */
  .scope-list::before {
    content: "";
    position: absolute;
    left: 50%;
    top: -10px;
    bottom: -10px;
    width: 0;
    border-left: 1px solid ${BORDER};
    background: #c7b68c;
    transform: translateX(-50%);
  }

  .scope-list li {
    line-height: 1.35;
    break-inside: avoid;
  }
</style></head><body>${body}</body></html>`;
}

function coverPage(
  input: OfferPrintTemplateInput,
  data: ReturnType<typeof buildOfferPrintTemplateData>,
  reference: string,
  totalArea: number,
  inlineOwnerDetailRows: readonly string[] | null,
  foot: string,
): string {
  const { job, customerPrice } = input;
  const owners = job.owners ?? [];
  const ownerLabel = owners.length > 1 ? "Owners" : "Owner";
  const ownerWho = ownerPartyNamesHtml(job);
  return `<div class="page">
    ${masthead()}
    <h1 class="doc">Fixed Price Building Tender</h1>
    <div class="refline">Tender Reference: ${esc(reference)} &nbsp;|&nbsp; Date: ${esc(data.preparedDateLabel)}</div>
    <p class="note">This Tender is the final fixed-price offer for the works described below and, on acceptance by both parties, forms the basis of a Master Builders Association (MBA) fixed-price home building contract. It supersedes any earlier negotiation proposal.</p>
    <h2>Parties</h2>
    <div class="parties">
      <div class="party"><div class="role">The Builder</div><div class="who">Royal Constructions Pty Ltd</div><div style="color:${MUTED};font-size:10px;margin-top:4px;">Licence No. 383992C · ABN 56 644 111 580 · MBA Accredited</div></div>
      <div class="party"><div class="role">The ${ownerLabel}</div><div class="who">${ownerWho}</div><div style="color:${MUTED};font-size:10px;margin-top:4px;">Site Location: ${esc(job.siteAddress)}</div></div>
    </div>
    <div class="sum"><div class="top">Contract Sum (including GST)</div><div class="amt">${money(customerPrice.selectedContractValueIncGst)}</div></div>
    <div class="build-scope">
      <div class="top">Build Scope</div>
      <div class="amt">
        <ul class="scope-list">
          ${job.buildScope
            .map(item => `<li>${esc(item.trim())}</li>`)
            .join("")}
        </ul>
      </div>
    </div>
    ${inlineOwnerDetailRows && inlineOwnerDetailRows.length > 0
      ? `<h2>Owner Details</h2>
    <table><thead><tr><th>Owner</th><th>Current Location</th><th>Email</th><th>Phone</th></tr></thead><tbody>${inlineOwnerDetailRows.join("")}</tbody></table>`
      : ""}
    <h2>Project Particulars</h2>
    <table>
      <tbody>
        ${particular("Site Location", job.siteAddress)}
        ${/* Omit unknown site particulars rather than contracting to a blank
             title reference, a blank zoning, or a "0 m²" lot — the same reason
             the façade row below is conditional. */ ""}
        ${job.dpNumber.trim() ? particular("Title reference", job.dpNumber) : ""}
        ${job.zoning.trim() ? particular("Zoning", job.zoning) : ""}
        ${job.lotAreaSqm > 0 ? particular("Lot area", formatArea(job.lotAreaSqm)) : ""}
        ${particular("Build type", job.buildType)}
        ${job.facade ? particular("Façade", job.facade) : ""}
        ${particular("Total build area", formatArea(totalArea))}
        ${particular("Prepared by", job.preparedBy)}
      </tbody>
    </table>
    ${foot}
  </div>`;
}

function particular(label: string, value: string): string {
  return `<tr><td class="cat" style="width:45mm;">${esc(label)}</td><td>${esc(value)}</td></tr>`;
}

// Owner display name with ABN/ACN annotation for companies.
function ownerDisplayName(owner: OfferOwner): string {
  const name = owner.displayName.trim();
  if (owner.kind === "company" && owner.abn.trim().length > 0) {
    return `${name} (ABN/ACN ${owner.abn.trim()})`;
  }
  return name;
}

// Combined owner names for the party block: primary on the first line, any
// co-owners on a muted "and …" sub-line (companies annotated with ABN/ACN).
function ownerPartyNamesHtml(job: OfferWorkspaceJob): string {
  const owners = (job.owners ?? []).filter(
    (owner) => owner.displayName.trim().length > 0,
  );
  if (owners.length === 0) return esc(job.clientNames);
  const primary = esc(ownerDisplayName(owners[0]));
  const rest = owners.slice(1).map((owner) => esc(ownerDisplayName(owner)));
  if (rest.length === 0) return primary;
  // Bounded: the full party list is in the Owner Details table, so this fixed
  // cover block shows a few names and counts the rest rather than growing
  // unboundedly and pushing the cover onto a second sheet (PR #124 review).
  return `${primary}<br /><span style="font-size:11px;color:${MUTED};">and ${formatBoundedOwnerList(rest, "; ")} (see Owner Details)</span>`;
}

// One or more Owner Details rows: an individual is a single row (name / current
// location / email / phone); a company is a header row (name + ABN + registered
// office) followed by one sub-row per director signatory.
function ownerDetailRowsHtml(owner: OfferOwner): string {
  const nameCell =
    owner.kind === "company" && owner.abn.trim().length > 0
      ? `${esc(owner.displayName)} <span style="color:${MUTED};">(ABN/ACN ${esc(owner.abn)})</span>`
      : esc(owner.displayName);
  if (owner.kind === "individual") {
    const signer = owner.signatories[0];
    return `<tr><td class="cat" style="width:55mm;">${nameCell}</td><td>${esc(owner.currentLocation)}</td><td>${esc(signer?.email ?? "")}</td><td>${esc(signer?.phone ?? "")}</td></tr>`;
  }
  const header = `<tr><td class="cat" style="width:55mm;">${nameCell}</td><td>${esc(owner.currentLocation)}</td><td colspan="2" style="color:${MUTED};font-size:9px;">Signed by its director(s) below</td></tr>`;
  const directors = owner.signatories
    .map(
      (director) =>
        `<tr><td style="padding-left:14px;color:${MUTED};">↳ ${esc(director.name)}, ${esc(director.capacity)}</td><td></td><td>${esc(director.email)}</td><td>${esc(director.phone)}</td></tr>`,
    )
    .join("");
  return header + directors;
}

function inclusionsPage(
  specifications: readonly OfferInclusionEntry[],
  startIndex: number,
  continued: boolean,
  foot: string,
): string {
  const body = specifications
    .map(
      (entry, i) =>
        `<tr><td class="num">${startIndex + i + 1}</td><td class="cat">${esc(entry.category?.trim() || UNCATEGORISED_INCLUSION_LABEL)}</td><td>${esc(entry.spec)}</td><td class="status"><span class="pill">Included</span></td></tr>`,
    )
    .join("");
  const intro = continued
    ? ""
    : `<p style="color:${MUTED};">All items below are included in the Contract Sum and fixed as per the approved plans and specifications, confirmed at colour selection.</p>`;
  return `<div class="page">
    ${masthead()}
    <h2 style="margin-top:20px;">Scope of Works — Inclusions Schedule${continued ? " (cont.)" : ""}</h2>
    ${intro}
    <table><thead><tr><th>#</th><th>Category</th><th>Specification</th><th>Status</th></tr></thead><tbody>${body}</tbody></table>
    ${foot}
  </div>`;
}

function exclusionsPaymentPage(
  data: ReturnType<typeof buildOfferPrintTemplateData>,
  foot: string,
): string {
  const excludes = data.exclusionBullets
    .map((b) => `<li>${esc(b)}</li>`)
    .join("");
  const pay = data.paymentRows
    .map(
      (row) =>
        `<tr><td class="cat">${esc(row.stageName)}</td><td>${(row.percentOfContract * 100).toFixed(0)}%</td><td>${money(row.amount)}</td><td>${esc(row.trigger)}</td></tr>`,
    )
    .join("");
  return `<div class="page">
    ${masthead()}
    <h2 style="margin-top:20px;">Exclusions</h2>
    <p style="color:${MUTED};">The following are not included in the Contract Sum and, if required, are priced as a written variation:</p>
    <ul>${excludes}</ul>
    <h2>Progress Payment Schedule</h2>
    <table><thead><tr><th>Stage</th><th>%</th><th>Amount (inc GST)</th><th>Trigger</th></tr></thead><tbody>${pay}</tbody></table>
    ${foot}
  </div>`;
}

function termsPage(
  data: ReturnType<typeof buildOfferPrintTemplateData>,
  foot: string,
): string {
  return `<div class="page">
    ${masthead()}
    <h2 style="margin-top:20px;">Terms &amp; Conditions</h2>
    <ol class="terms">
      <li><b>Contract documents.</b> This Tender, the approved plans and specifications, and the executed MBA fixed-price building contract together form the agreement between the parties.</li>
      <li><b>Contract sum.</b> The Contract Sum is fixed and includes GST for the full scope described, subject only to written variations and the provisional/prime-cost allowances noted in the inclusions schedule.</li>
      <li><b>Site conditions.</b> Priced on standard residential site conditions. Class H2/E soil, rock, or abnormal fill identified by geotechnical investigation is addressed by written variation before affected works proceed.</li>
      <li><b>Variations.</b> No variation is carried out without a signed Variation Order. Variations are invoiced with the affected progress claim.</li>
      <li><b>Progress payments.</b> Claims are payable within the period stated in the building contract on completion of each stage set out above.</li>
      <li><b>Insurance &amp; warranty.</b> Home Building Compensation Fund (HBCF) cover and statutory warranties are provided as required under the Home Building Act.</li>
      <li><b>Commencement &amp; duration.</b> Construction commences after finance approval, HBCF certificate, and council/CDC approval, within the period set out in the building contract.</li>
      <li><b>Validity.</b> This Tender is valid until ${esc(data.validUntilLabel)} unless extended in writing.</li>
    </ol>
    <p class="note">Insert Royal Constructions' standard special conditions and any NCC 2025 clauses from the master tender template here before issuing. The clauses above are structural placeholders and should be reconciled with legal wording.</p>
    ${foot}
  </div>`;
}

// Owner Details on their own page, used when the table is too long to sit on the
// cover without pushing it past one physical sheet.
function ownerDetailsPage(
  rows: readonly string[],
  continued: boolean,
  foot: string,
): string {
  return `<div class="page">
    ${masthead()}
    <h2 style="margin-top:20px;">Owner Details${continued ? " (cont.)" : ""}</h2>
    <table><thead><tr><th>Owner</th><th>Current Location</th><th>Email</th><th>Phone</th></tr></thead><tbody>${rows.join("")}</tbody></table>
    ${foot}
  </div>`;
}

// The ordered execution signature blocks: one per customer signer first (each
// individual owner; each company director), then the builder below. The
// sigOwner{k}/dateOwner{k}/initOwner{k} anchors use the signer's GLOBAL index,
// so they stay aligned with the DocuSign recipients built by collectOfferSigners
// in offer-tender-sign no matter how the blocks are later distributed across
// pages. Visual order matches DocuSign routing (customer, then builder).
function buildExecutionBlocks(
  job: OfferPrintTemplateInput["job"],
  signers: OfferSignerContext[],
): ExecutionBlock[] {
  const ownerBlocks = signers.map((signer, index) => {
    const k = index + 1;
    // Plain-text twin drives the height estimate (escaping would inflate it).
    const whoText = signer.entityName
      ? `For ${signer.entityName} — ${signer.signatory.name}, ${signer.signatory.capacity}`
      : `The Owner — ${signer.signatory.name}`;
    const who = signer.entityName
      ? `For ${esc(signer.entityName)} — ${esc(signer.signatory.name)}, ${esc(signer.signatory.capacity)}`
      : `The Owner — ${esc(signer.signatory.name)}`;
    const html = `
    <div class="sig">
      <div class="who">${who}</div>
      <div class="lines">
        <div><div class="sigspace">${anchor(`sigOwner${k}`)}</div><div class="field">Signature</div></div>
        <div><div class="sigspace">${anchor(`dateOwner${k}`)}</div><div class="field">Date</div></div>
      </div>
      <div style="margin-top:10px;font-size:9px;color:${MUTED};">Initial each page: ${anchor(`initOwner${k}`)}</div>
    </div>`;
    return { html, lines: executionBlockLines(whoText, true) };
  });
  const builderBlock = `
    <div class="sig">
      <div class="who">The Builder — Royal Constructions Pty Ltd</div>
      <div class="lines">
        <div><div class="sigspace">${anchor("sigBuilder")}</div><div class="field">Signature (${esc(job.preparedBy)})</div></div>
        <div><div class="sigspace">${anchor("dateBuilder")}</div><div class="field">Date</div></div>
      </div>
    </div>`;
  return [
    ...ownerBlocks,
    {
      html: builderBlock,
      lines: executionBlockLines(
        `The Builder — Royal Constructions Pty Ltd ${job.preparedBy}`,
        false,
      ),
    },
  ];
}

// One page of execution signature blocks. The acceptance paragraph leads the
// first page; the legal footnote closes the last.
function executionPage(
  job: OfferPrintTemplateInput["job"],
  reference: string,
  blocks: readonly string[],
  continued: boolean,
  last: boolean,
  foot: string,
): string {
  const owners = job.owners ?? [];
  // Acceptance paragraph — names every owner when there is more than one
  // ("…<A> and <B>… accept…"); a single owner keeps the neutral "the parties".
  const acceptSubject =
    owners.length > 1
      ? owners
          .map((owner) => owner.displayName.trim())
          .filter(Boolean)
          .map(esc)
          .join(" and ")
      : "the parties";
  const intro = continued
    ? ""
    : `<p>By signing below, ${acceptSubject} accept this Fixed Price Building Tender (${esc(reference)}) and agree to enter into the MBA fixed-price home building contract for the Contract Sum and scope described herein.</p>`;
  const closing = last
    ? `<p class="note">Royal Constructions Pty Ltd · Lic. 383992C · ABN 56 644 111 580 · MBA Accredited. Signed copies are retained as the legal system of record.</p>`
    : "";
  return `<div class="page">
    ${masthead()}
    <h2 style="margin-top:20px;">Acceptance &amp; Execution${continued ? " (cont.)" : ""}</h2>
    ${intro}
    ${blocks.join("")}
    ${closing}
    ${foot}
  </div>`;
}
