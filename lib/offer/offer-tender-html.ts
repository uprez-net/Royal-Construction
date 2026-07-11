import {
  buildOfferPrintTemplateData,
  formatArea,
  COMPANY_LINE,
  type OfferPrintTemplateInput,
} from "./workspace-print-template";
import { STANDARD_INCLUSIONS_SCHEDULE } from "./workspace-proposal-content";

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

const INCLUSIONS_ROWS_PER_PAGE = 12;

type InclusionRow = (typeof STANDARD_INCLUSIONS_SCHEDULE)[number];

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(value: number | null): string {
  if (value === null) return "-";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(value);
}

// Split "Mr Mahesh & Ms Anisha" into individual owners for separate signatures.
// Exported so the DocuSign envelope builds the same signer list as the anchors.
export function splitOwners(clientNames: string): string[] {
  const owners = clientNames
    .split(/\s*&\s*|\s+and\s+/i)
    .map((o) => o.trim())
    .filter(Boolean);
  return owners.length > 0 ? owners : [clientNames];
}

// A DocuSign anchor rendered small and light — present for AutoPlace, unobtrusive.
function anchor(tag: string): string {
  return `<span style="color:#c8c8c8;font-size:7px;">\\${tag}\\</span>`;
}

function masthead(): string {
  const parts = COMPANY_LINE.split(" | ");
  return `<div class="masthead"><span>${esc(parts[0])}</span><span>${esc(parts.slice(1).join("  |  "))}</span></div>`;
}

export function buildTenderHtml(input: OfferPrintTemplateInput): string {
  const data = buildOfferPrintTemplateData(input);
  const { job } = input;
  const owners = splitOwners(job.clientNames);
  const reference = `${job.reference}-${job.revision}`;
  const totalArea =
    job.groundFloorSqm +
    job.firstFloorSqm +
    job.garageSqm +
    job.alfrescoPorchSqm +
    job.porchSqm +
    job.grannyFlatSqm;

  const inclusionChunks: InclusionRow[][] = [];
  for (let i = 0; i < STANDARD_INCLUSIONS_SCHEDULE.length; i += INCLUSIONS_ROWS_PER_PAGE) {
    inclusionChunks.push(
      STANDARD_INCLUSIONS_SCHEDULE.slice(i, i + INCLUSIONS_ROWS_PER_PAGE),
    );
  }

  const totalPages = 1 + inclusionChunks.length + 1 + 1 + 1;
  let pageNo = 0;
  const foot = (): string => {
    pageNo += 1;
    return `<div class="foot"><span>Fixed Price Building Tender — ${esc(reference)}</span><span>Page ${pageNo} of ${totalPages}</span></div>`;
  };

  const body = [
    coverPage(input, data, reference, owners, totalArea, foot()),
    ...inclusionChunks.map((rows, index) =>
      inclusionsPage(rows, index * INCLUSIONS_ROWS_PER_PAGE, index > 0, foot()),
    ),
    exclusionsPaymentPage(data, foot()),
    termsPage(data, foot()),
    executionPage(job, reference, owners, foot()),
  ].join("");

  return `<!doctype html><html><head><meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
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
  .sig { border: 1px solid ${BORDER}; padding: 14px; margin-top: 14px; }
  .sig .who { font-weight: 700; color: ${NAVY}; }
  .sig .lines { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 22px; }
  .sig .field { border-top: 1px solid #333; padding-top: 4px; font-size: 9px; color: ${MUTED}; text-transform: uppercase; letter-spacing: 1px; }
  .sigspace { height: 46px; }
</style></head><body>${body}</body></html>`;
}

function coverPage(
  input: OfferPrintTemplateInput,
  data: ReturnType<typeof buildOfferPrintTemplateData>,
  reference: string,
  owners: string[],
  totalArea: number,
  foot: string,
): string {
  const { job, customerPrice } = input;
  return `<div class="page">
    ${masthead()}
    <h1 class="doc">Fixed Price Building Tender</h1>
    <div class="refline">Tender Reference: ${esc(reference)} &nbsp;|&nbsp; Date: ${esc(data.preparedDateLabel)}</div>
    <p class="note">This Tender is the final fixed-price offer for the works described below and, on acceptance by both parties, forms the basis of a Master Builders Association (MBA) fixed-price home building contract. It supersedes any earlier negotiation proposal.</p>
    <h2>Parties</h2>
    <div class="parties">
      <div class="party"><div class="role">The Builder</div><div class="who">Royal Constructions Pty Ltd</div><div style="color:${MUTED};font-size:10px;margin-top:4px;">Licence No. 383992C · ABN 56 644 111 580 · MBA Accredited</div></div>
      <div class="party"><div class="role">The Owner${owners.length > 1 ? "s" : ""}</div><div class="who">${esc(job.clientNames)}</div><div style="color:${MUTED};font-size:10px;margin-top:4px;">Site: ${esc(job.siteAddress)}</div></div>
    </div>
    <div class="sum"><div class="top">Contract Sum (including GST)</div><div class="amt">${money(customerPrice.selectedContractValueIncGst)}</div></div>
    <h2>Project Particulars</h2>
    <table>
      <tbody>
        ${particular("Site address", job.siteAddress)}
        ${particular("Title reference", job.dpNumber)}
        ${particular("Zoning", job.zoning)}
        ${particular("Lot area", formatArea(job.lotAreaSqm))}
        ${particular("Build type", job.buildType)}
        ${particular("Total build area", formatArea(totalArea))}
        ${particular("Build scope", job.buildScope.join("; "))}
        ${particular("Prepared by", job.preparedBy)}
      </tbody>
    </table>
    ${foot}
  </div>`;
}

function particular(label: string, value: string): string {
  return `<tr><td class="cat" style="width:45mm;">${esc(label)}</td><td>${esc(value)}</td></tr>`;
}

function inclusionsPage(
  rows: InclusionRow[],
  startIndex: number,
  continued: boolean,
  foot: string,
): string {
  const body = rows
    .map(
      (row, i) =>
        `<tr><td class="num">${startIndex + i + 1}</td><td class="cat">${esc(row.category)}</td><td>${esc(row.specification)}</td><td class="status"><span class="pill">Included</span></td></tr>`,
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

function executionPage(
  job: OfferPrintTemplateInput["job"],
  reference: string,
  owners: string[],
  foot: string,
): string {
  const ownerBlocks = owners
    .map(
      (owner, index) => `
    <div class="sig">
      <div class="who">The Owner — ${esc(owner)}</div>
      <div class="lines">
        <div><div class="sigspace">${anchor(`sigOwner${index + 1}`)}</div><div class="field">Signature</div></div>
        <div><div class="sigspace">${anchor(`dateOwner${index + 1}`)}</div><div class="field">Date</div></div>
      </div>
      <div style="margin-top:10px;font-size:9px;color:${MUTED};">Initial each page: ${anchor(`initOwner${index + 1}`)}</div>
    </div>`,
    )
    .join("");
  return `<div class="page">
    ${masthead()}
    <h2 style="margin-top:20px;">Acceptance &amp; Execution</h2>
    <p>By signing below, the parties accept this Fixed Price Building Tender (${esc(reference)}) and agree to enter into the MBA fixed-price home building contract for the Contract Sum and scope described herein.</p>
    <div class="sig">
      <div class="who">The Builder — Royal Constructions Pty Ltd</div>
      <div class="lines">
        <div><div class="sigspace">${anchor("sigBuilder")}</div><div class="field">Signature (${esc(job.preparedBy)})</div></div>
        <div><div class="sigspace">${anchor("dateBuilder")}</div><div class="field">Date</div></div>
      </div>
    </div>
    ${ownerBlocks}
    <p class="note">Royal Constructions Pty Ltd · Lic. 383992C · ABN 56 644 111 580 · MBA Accredited. Signed copies are retained as the legal system of record.</p>
    ${foot}
  </div>`;
}
