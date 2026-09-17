import {
  buildOfferPrintTemplateData,
  formatArea,
  formatDwellingSpec,
  grannyDwellingSpec,
  COMPANY_LINE,
  type OfferPrintPaymentRow,
  type OfferPrintScopeRow,
  type OfferPrintTemplateInput,
} from "./workspace-print-template";
import { formatPercent } from "./format";
import {
  offerAreaBasisFromJob,
  rawTotalAreaSqm,
} from "./workspace-area";
import {
  formatBoundedOwnerList,
  chunkByEstimatedHeight,
  collectOfferSigners,
  estimateWrappedLines,
  type OfferInclusionEntry,
  type OfferOwner,
  type OfferSignerContext,
  type OfferWorkspaceJob,
} from "./workspace-model";

// Legal fixed-price building Tender document (distinct from the marketing Offer
// proposal). Styled to the Royal Constructions Word tender template
// (tmp/Royal Constructions Tender Template 2026 House). Sections: cover letter +
// tender price, project particulars, owner details, the grouped inclusion
// schedule, contract terms + progress payments, exclusions, and an acceptance
// table whose signature/date/initial fields carry DocuSign anchor strings for
// AutoPlace:
//
//   \sigBuilder\  \dateBuilder\
//   \sigOwner1\   \dateOwner1\   \initOwner1\
//   \sigOwner2\   \dateOwner2\   \initOwner2\
//
// DocuSign locates these strings and drops the matching field on top of them.
// The anchors are declared as tabs in lib/docusign/tender-envelope.ts — every
// owner recipient carries signHere, dateSigned AND initialHere — so removing an
// anchor here silently orphans a tab. Both files order signers by the same
// collectOfferSigners() call, so sigOwner{k} always maps to recipient {k}.

// ─── Legacy tokens: the CONTRACT annexure only ──────────────────────────────
// legalDocShell() below is still consumed by contract-annexure-html.ts. The
// tender was forked onto tenderDocShell() so restyling it could not silently
// restyle the contract; these tokens belong to that older shell alone and must
// never leak into the tender.
const LEGACY_NAVY = "#1e2b4d";
const LEGACY_GOLD = "#b8873b";
const LEGACY_GOLD_DARK = "#8f6a24";
const LEGACY_BORDER = "#d9d9d6";
const LEGACY_MUTED = "#5f5f5f";

// ─── Tender design tokens ───────────────────────────────────────────────────
// Extracted from Royal_Constructions_Tender_Template_2026_House.docx (OOXML:
// word/document.xml, word/styles.xml, word/header1.xml, word/footer1.xml).
// Measurements, not estimates — do not round these "to something nicer" without
// re-measuring against the source. There is no navy anywhere in the source.
const GOLD = "#B8860B"; // headings, title, price
const GOLD_FILL = "#C8A951"; // table header row background + its border
const RULE = "#CCCCCC"; // all cell borders, header/footer hairlines
const ZEBRA = "#F2F2F2"; // even data rows
const ROW_BG = "#FFFFFF"; // odd data rows
const LABEL = "#1A1A1A"; // bold lead-in labels, status text
const BODY = "#333333"; // default body text (w:docDefaults)
const HEADING_SUB = "#242424"; // client name / job address line
const CHROME = "#555555"; // running header + footer text

// Running header/footer contact details. NOT derivable from COMPANY_LINE, which
// carries only the legal name, licence, ABN and MBA accreditation — none of the
// street address, phone, mobile, email or website the template's header needs.
const TENDER_HEADER_LINES: readonly string[] = [
  "38/62 Turner Rd, Smeaton Grange NSW 2567  |  ABN 56 644 111 580",
  "P 1300 832 355  |  M 0406 555 565  |  gurpinder@royalconstructions.com.au  |  royalconstructions.com.au",
];
const TENDER_FOOTER_BASE = "Royal Constructions  |  ABN 56 644 111 580";
const BUILDER_CONTACT_LINE =
  "M: 0406 555 565  |  E: gurpinder@royalconstructions.com.au";
// Statutory disclosures (licence number + ABN). The source template has no
// equivalent block, but these are required disclosures under the Home Building
// Act, so they are folded into the centred cover block rather than dropped.
const BUILDER_STATUTORY_LINE =
  "Royal Constructions Pty Ltd  |  Licence No. 383992C  |  ABN 56 644 111 580  |  MBA Accredited";

// Execution signature blocks per page. Retained for the contract annexure's
// signature pagination; the tender now executes on a single acceptance table.
export const SIGNATURE_BLOCKS_PER_PAGE = 4;

// Shared by the Tender and Contract builders (see contract-annexure-html.ts).
export function esc(value: string): string {
  return value
    // Strip backslashes so user-controlled text (client name, address, spec)
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

const ONES = [
  "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
] as const;
const TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty",
  "ninety",
] as const;
const SCALES = [
  [1_000_000_000, "billion"],
  [1_000_000, "million"],
  [1_000, "thousand"],
] as const;

// 1..999 in words, Australian style ("one hundred and forty-five").
function underThousandInWords(value: number): string {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(`${ONES[hundreds]} hundred`);
  if (rest > 0) {
    if (hundreds > 0) parts.push("and");
    if (rest < 20) parts.push(ONES[rest]);
    else {
      const tens = TENS[Math.floor(rest / 10)];
      const ones = rest % 10;
      parts.push(ones > 0 ? `${tens}-${ONES[ones]}` : tens);
    }
  }
  return parts.join(" ");
}

// The contract sum written out, as the Word template prints it beside the
// figure ("$750,000 / Seven hundred and fifty thousand dollars"). A fixed-price
// tender states its price in words as well as numerals so a mis-keyed or
// altered figure is self-evident. Rounded to whole dollars to match money(),
// which prints no cents — the two must never disagree.
export function amountInWords(value: number): string {
  const whole = Math.round(Math.abs(value));
  if (whole === 0) return "Zero dollars";
  let remaining = whole;
  const parts: string[] = [];
  for (const [scale, name] of SCALES) {
    const count = Math.floor(remaining / scale);
    if (count > 0) {
      parts.push(`${underThousandInWords(count)} ${name}`);
      remaining %= scale;
    }
  }
  if (remaining > 0) {
    // "and" joins the final sub-thousand group: "one million and forty".
    if (parts.length > 0 && remaining < 100) parts.push("and");
    parts.push(underThousandInWords(remaining));
  }
  const words = parts.join(" ");
  const unit = whole === 1 ? "dollar" : "dollars";
  const sentence = `${words.charAt(0).toUpperCase()}${words.slice(1)} ${unit}`;
  return value < 0 ? `Minus ${sentence.toLowerCase()}` : sentence;
}

// A DocuSign anchor rendered small and light — present for AutoPlace, unobtrusive.
// Shared with the contract annexure, so the 7px is left as-is: it is EXACTLY
// 5.25pt (7 × 72/96), so it costs the tender's pt-based metrics nothing, and
// restating it in pt would change the annexure's bytes for no visual gain.
export function anchor(tag: string): string {
  return `<span style="color:#c8c8c8;font-size:7px;">\\${tag}\\</span>`;
}

// The CONTRACT annexure masthead. The tender uses tenderHeader() instead.
export function masthead(): string {
  const parts = COMPANY_LINE.split(" | ");
  return `<div class="masthead"><span>${esc(parts[0])}</span><span>${esc(parts.slice(1).join("  |  "))}</span></div>`;
}

// ─── Inclusion schedule sectioning ──────────────────────────────────────────
// OfferInclusionEntry.category is a per-ROW trade label ("Concrete Slab",
// "Stone Benchtops") — the standard schedule has 44 rows and 44 distinct
// values. The Word template instead groups rows under a handful of numbered
// sections, so the label alone cannot drive the grouping: it becomes the bold
// lead-in of the Description cell, and this map assigns it to a section.
//
// The canonical order below is the source document's. A label that is not
// mapped (an estimator's own wording, an AI-drafted row) falls into a final
// "Other Inclusions" section rather than inventing a classification for it —
// visible, not hidden. Review this map when the standard schedule changes;
// misfiling a row misstates which part of the contract carries it.
export const INCLUSION_SECTION_ORDER: readonly string[] = [
  "Fixed Price Site Cost",
  "Building",
  "Council & Statutory Authority Requirements",
];

// Where entries with no category, or an unmapped one, are collected. Always
// rendered last.
export const OTHER_INCLUSIONS_SECTION = "Other Inclusions";

// Trade label → canonical section. Keys are normalised by normaliseLabel().
const SECTION_BY_TRADE_LABEL: Readonly<Record<string, string>> = {
  // Preliminaries, design, insurance and site establishment.
  "design & plans": "Fixed Price Site Cost",
  "hbcf": "Fixed Price Site Cost",
  "scaffolding": "Fixed Price Site Cost",
  "pc & provisional items": "Fixed Price Site Cost",
  // Council, certifier and statutory approval requirements.
  "approvals": "Council & Statutory Authority Requirements",
  // Construction proper.
  "concrete slab": "Building",
  "frame": "Building",
  "roof": "Building",
  "roof trusses": "Building",
  "external walls": "Building",
  "rendering - full facade": "Building",
  "feature facade": "Building",
  "windows": "Building",
  "external doors": "Building",
  "garage door": "Building",
  "kitchen cabinetry": "Building",
  "stone benchtops": "Building",
  "splashback": "Building",
  "appliances": "Building",
  "vanity cabinetry": "Building",
  "vanity benchtops": "Building",
  "tiling": "Building",
  "shower screens": "Building",
  "tapware": "Building",
  "waterproofing": "Building",
  "internal doors": "Building",
  "door hardware": "Building",
  "staircase": "Building",
  "void": "Building",
  "wardrobes": "Building",
  "gyprock": "Building",
  "insulation": "Building",
  "skirting": "Building",
  "flooring - living": "Building",
  "flooring - bedrooms": "Building",
  "electrical": "Building",
  "lighting": "Building",
  "ducted air con": "Building",
  "hot water": "Building",
  "rainwater tank": "Building",
  "driveway": "Building",
  "painting": "Building",
  "front pillars": "Building",
  "final clean": "Building",
};

// Case-, dash- and whitespace-insensitive so "Rendering — Full Facade" and
// "Rendering - Full  Facade" resolve to the same section.
function normaliseLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ");
}

export type TenderInclusionRow = {
  readonly entry: OfferInclusionEntry;
  // Hierarchical reference, "{section}.{row}", both 1-based.
  readonly ref: string;
  readonly label: string;
};

export type TenderInclusionSection = {
  readonly name: string;
  readonly index: number; // 1-based section number
  readonly rows: readonly TenderInclusionRow[];
};

// Group the flat schedule into the template's numbered sections. Canonical
// sections keep the source document's order; any other mapped section follows
// alphabetically; unmapped/uncategorised rows land in "Other Inclusions" last.
// An empty schedule yields zero sections (never an empty table).
export function buildInclusionSections(
  entries: readonly OfferInclusionEntry[],
): TenderInclusionSection[] {
  if (entries.length === 0) return [];
  const grouped = new Map<string, OfferInclusionEntry[]>();
  for (const entry of entries) {
    const label = (entry.category ?? "").trim();
    const section =
      label.length === 0
        ? OTHER_INCLUSIONS_SECTION
        : (SECTION_BY_TRADE_LABEL[normaliseLabel(label)] ??
          OTHER_INCLUSIONS_SECTION);
    const bucket = grouped.get(section);
    if (bucket) bucket.push(entry);
    else grouped.set(section, [entry]);
  }
  const canonical = INCLUSION_SECTION_ORDER.filter((name) => grouped.has(name));
  const extra = [...grouped.keys()]
    .filter(
      (name) =>
        !INCLUSION_SECTION_ORDER.includes(name) &&
        name !== OTHER_INCLUSIONS_SECTION,
    )
    .sort((a, b) => a.localeCompare(b));
  const ordered = [
    ...canonical,
    ...extra,
    ...(grouped.has(OTHER_INCLUSIONS_SECTION) ? [OTHER_INCLUSIONS_SECTION] : []),
  ];
  return ordered.map((name, sectionIndex) => ({
    name,
    index: sectionIndex + 1,
    rows: (grouped.get(name) ?? []).map((entry, rowIndex) => ({
      entry,
      ref: `${sectionIndex + 1}.${rowIndex + 1}`,
      label: (entry.category ?? "").trim(),
    })),
  }));
}

// ─── Print metrics ──────────────────────────────────────────────────────────
// A4 content box is 297mm − 2 × 15.875mm = 265.25mm ≈ 752pt tall. Measured in
// Chromium, the usable body area between the running header and footer is
// ~942px ≈ 61 lines at 10pt/1.15.
//
// The ceiling was found empirically, not derived: a budget of 58 still paginates
// truthfully across the whole owner/schedule matrix and 60 overflows, so 56
// leaves a few lines of headroom for the char-count wrap estimate being wrong on
// data these fixtures do not cover. Do not raise it without re-running
// tests/offer/offer-tender-template-parity.test.ts, which asserts the footer's
// "of M" equals the PDF's true sheet count. Changing the base font, the
// line-height or the page padding invalidates all of these budgets.
const TENDER_LINES_PER_PAGE = 56;
// Description column is 71.304% of 178.26mm ≈ 127mm ≈ 360pt; at 10pt Arial that
// is roughly 72 characters.
const CHARS_PER_LINE_DESCRIPTION = 72;
// A row's cell padding (4pt top + 4pt bottom) plus its border, in line units.
const INCLUSION_ROW_CHROME_LINES = 1;
// A section heading: 14pt before + a 13pt line + 6pt after ≈ 3 body lines.
const SECTION_HEADING_LINES = 3;
// The intro paragraph that leads the first schedule page.
const SCHEDULE_INTRO_LINES = 3;
// Owner Details rows that still fit beneath the particulars table; past this the
// table moves to its own page(s). Budgets in ESTIMATED WRAPPED LINES, not
// logical rows: a long company legal name or registered office wraps, making its
// row several lines tall.
const OWNER_DETAIL_LINES_INLINE = 8;
const OWNER_DETAIL_LINES_PER_PAGE = 50;

// Per-COLUMN wrap widths for the Owner Details table. A single shared width
// (CHARS_PER_LINE_TABLE_CELL, calibrated for a much wider cell) under-counted
// these four narrow columns by roughly half, which is how ten company owners
// declared one page and printed three.
const CHARS_PER_LINE_OWNER_NAME = 26; // 27.706% ≈ 49.4mm
const CHARS_PER_LINE_OWNER_LOCATION = 22; // 23.748% ≈ 42.3mm
const CHARS_PER_LINE_OWNER_EMAIL = 28; // 29.685% ≈ 52.9mm
const CHARS_PER_LINE_OWNER_PHONE = 18; // 18.861% ≈ 33.6mm
// A table row's own cell padding (4pt top + 4pt bottom) plus its border.
const OWNER_ROW_CHROME_LINES = 1;

// An owner's contribution to the Owner Details table, in line units. An
// individual is one row whose height is the tallest of its cells; a company is a
// header row plus one row per director. Each cell is measured against ITS OWN
// column width — a row is as tall as its tallest cell.
function ownerDetailLines(owner: OfferOwner): number {
  const name = (text: string) =>
    estimateWrappedLines(text, CHARS_PER_LINE_OWNER_NAME);
  const location = (text: string) =>
    estimateWrappedLines(text, CHARS_PER_LINE_OWNER_LOCATION);
  const email = (text: string) =>
    estimateWrappedLines(text, CHARS_PER_LINE_OWNER_EMAIL);
  const phone = (text: string) =>
    estimateWrappedLines(text, CHARS_PER_LINE_OWNER_PHONE);
  // A company prints its ABN/ACN on its own line beneath the legal name.
  const nameCell =
    name(owner.displayName) +
    (owner.kind === "company" && owner.abn.trim().length > 0 ? 1 : 0);
  if (owner.kind === "individual") {
    const signer = owner.signatories[0];
    return (
      Math.max(
        nameCell,
        location(owner.currentLocation),
        email(signer?.email ?? ""),
        phone(signer?.phone ?? ""),
      ) + OWNER_ROW_CHROME_LINES
    );
  }
  const headerRow =
    Math.max(nameCell, location(owner.currentLocation)) + OWNER_ROW_CHROME_LINES;
  return (
    headerRow +
    owner.signatories.reduce(
      (sum, director) =>
        sum +
        Math.max(
          name(`${director.name}, ${director.capacity}`),
          email(director.email),
          phone(director.phone),
        ) +
        OWNER_ROW_CHROME_LINES,
      0,
    )
  );
}

// ─── Acceptance table metrics ───────────────────────────────────────────────
// The Print Full Name column is 27.706% ≈ 49.4mm wide.
const CHARS_PER_LINE_ACCEPT_NAME = 26;
// Every acceptance row is given 14mm of physical signing space (see .t-accept in
// the shell), so no row is ever shorter than that however short the name is.
const ACCEPTANCE_ROW_MIN_LINES = 4;
// Heading + intro paragraph + the sign-off block that follows the table. Held
// back from every acceptance page's budget rather than only the first/last, so
// the estimate can never run short on the page that happens to carry them.
const ACCEPTANCE_CHROME_LINES = 12;

// A schedule row's height: the Description cell stacks a bold label over the
// spec detail, so both contribute. Measured on the description column because it
// is by far the widest and always the tallest cell in the row.
function inclusionRowLines(row: TenderInclusionRow): number {
  const label = row.label;
  const spec = row.entry.spec.trim();
  const labelLines =
    label.length > 0
      ? estimateWrappedLines(label, CHARS_PER_LINE_DESCRIPTION)
      : 0;
  const specLines =
    spec.length > 0 ? estimateWrappedLines(spec, CHARS_PER_LINE_DESCRIPTION) : 0;
  return (
    Math.max(1, labelLines + specLines) + INCLUSION_ROW_CHROME_LINES
  );
}

// One item in the paginated schedule flow: a section heading, or one row.
type ScheduleItem =
  | { readonly kind: "heading"; readonly section: TenderInclusionSection }
  | {
      readonly kind: "row";
      readonly section: TenderInclusionSection;
      readonly row: TenderInclusionRow;
    };

// Pack the sections into pages. A heading and its first row are ATOMIC — a
// heading must never be the last thing on a sheet — so they are chunked as one
// unit and split back out for rendering.
function chunkSchedule(
  sections: readonly TenderInclusionSection[],
): ScheduleItem[][] {
  if (sections.length === 0) return [];
  type Atom = { readonly items: ScheduleItem[]; readonly lines: number };
  const atoms: Atom[] = [];
  for (const section of sections) {
    const [first, ...rest] = section.rows;
    if (!first) continue;
    atoms.push({
      items: [
        { kind: "heading", section },
        { kind: "row", section, row: first },
      ],
      lines: SECTION_HEADING_LINES + inclusionRowLines(first),
    });
    for (const row of rest) {
      atoms.push({
        items: [{ kind: "row", section, row }],
        lines: inclusionRowLines(row),
      });
    }
  }
  if (atoms.length === 0) return [];
  // The first schedule page also carries the intro paragraph.
  const firstBudget = Math.max(1, TENDER_LINES_PER_PAGE - SCHEDULE_INTRO_LINES);
  const first =
    chunkByEstimatedHeight(atoms, firstBudget, (atom) => atom.lines)[0] ?? [];
  const rest = atoms.slice(first.length);
  return [
    first,
    ...chunkByEstimatedHeight(rest, TENDER_LINES_PER_PAGE, (atom) => atom.lines),
  ]
    .filter((page) => page.length > 0)
    .map((page) => page.flatMap((atom) => atom.items));
}

export function buildTenderHtml(input: OfferPrintTemplateInput): string {
  const data = buildOfferPrintTemplateData(input);
  const { job } = input;
  // The ordered signer list — one per individual owner and one per company
  // director. The DocuSign envelope (offer-tender-sign.ts → tender-envelope.ts)
  // builds recipients from the SAME collectOfferSigners() call in the SAME
  // order, so anchor sigOwner{k} on this PDF maps to recipient k. See ADR 0003.
  const signers = collectOfferSigners(job.owners);
  const reference = `${job.reference}-${job.revision}`;
  // The total the offer's cover and snapshot print. This sum left out balcony and
  // void, so the signed Tender stated a smaller build than the offer before it.
  const totalArea = rawTotalAreaSqm(offerAreaBasisFromJob(job));

  // The schedule the estimator edited on this offer — not a module constant.
  // An empty schedule produces zero sections rather than an empty table.
  const sections = buildInclusionSections(input.draft.inclusionSchedule);
  const schedulePages = chunkSchedule(sections);
  // Contract Terms continues the schedule's section numbering, exactly as the
  // source template's "4.   Contract Terms & Payment Schedule" follows its three
  // inclusion sections.
  const contractTermsSectionNo = sections.length + 1;

  // Owner Details: a short list sits inline beneath the particulars table (the
  // common case); anything longer moves to its own counted page(s). A COMPANY
  // owner contributes a header row plus one row per director and any cell can
  // WRAP, so budget by estimated wrapped lines, not logical rows.
  const detailOwners = job.owners ?? [];
  const ownerDetailRows = detailOwners.map(ownerDetailRowsHtml);
  const ownerDetailEntries = detailOwners.map((owner, index) => ({
    html: ownerDetailRows[index],
    lines: ownerDetailLines(owner),
  }));
  const ownerDetailTotal = ownerDetailEntries.reduce(
    (sum, entry) => sum + entry.lines,
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

  // Acceptance rows are chunked like every other flow: a row is atomic, so one
  // that would exceed the budget starts the next sheet rather than splitting a
  // signature across a page boundary on the document that is actually signed.
  const acceptanceRows = buildAcceptanceRows(job, signers);
  const acceptanceChunks = chunkByEstimatedHeight(
    acceptanceRows,
    Math.max(1, TENDER_LINES_PER_PAGE - ACCEPTANCE_CHROME_LINES),
    (row) => row.lines,
  );

  // The prime cost and provisional sums the Important Notes make the price
  // subject to: every allowance ticked "Show on Tender". They sit beneath the
  // exclusions while they fit and continue on counted pages when they don't.
  const allowanceLayout = layoutTenderAllowances(data);

  const totalPages =
    1 + // cover letter
    1 + // project particulars
    ownerDetailChunks.length +
    schedulePages.length +
    1 + // contract terms + progress payments
    1 + // exclusions, with the allowances that fit beneath them
    allowanceLayout.continuation.length +
    acceptanceChunks.length;
  let pageNo = 0;
  const foot = (): string => {
    pageNo += 1;
    return `<div class="rfoot">${esc(TENDER_FOOTER_BASE)}  |  Tender ${esc(reference)}  |  Page ${pageNo} of ${totalPages}</div>`;
  };

  // The three "N% deposit" sentences quote the schedule's own deposit stage. With
  // no stages there is no deposit to ask for, so the clause is dropped.
  const deposit = depositRow(data.paymentRows);
  const depositPercent = deposit
    ? formatPercent(deposit.percentOfContract)
    : null;

  const body = [
    coverPage(input, data, depositPercent, foot()),
    particularsPage(
      input,
      totalArea,
      inlineOwnerDetails ? ownerDetailRows : null,
      foot(),
    ),
    ...ownerDetailChunks.map((rows, index) =>
      ownerDetailsPage(rows, index > 0, foot()),
    ),
    ...schedulePages.map((items, index) =>
      schedulePage(items, index === 0, foot()),
    ),
    contractTermsPage(data, contractTermsSectionNo, depositPercent, foot()),
    exclusionsPage(data, allowanceLayout.inline, foot()),
    ...allowanceLayout.continuation.map((rows, index) =>
      allowancesPage(
        rows,
        allowanceLayout.inline.length > 0 || index > 0,
        foot(),
      ),
    ),
    ...acceptanceChunks.map((rows, index) =>
      acceptancePage(
        job,
        signers,
        rows,
        depositPercent,
        index === 0,
        index === acceptanceChunks.length - 1,
        foot(),
      ),
    ),
  ].join("");

  return tenderDocShell(body);
}

// ─── Document shells ────────────────────────────────────────────────────────

// The deposit stage, by the rule the contract's deposit field already uses
// (lib/data/offer-contract-sign.ts): the stage named for it, else the first.
function depositRow(
  rows: readonly OfferPrintPaymentRow[],
): OfferPrintPaymentRow | undefined {
  return (
    rows.find((row) => row.stageName.toLowerCase().includes("deposit")) ??
    rows[0]
  );
}

// The TENDER shell. Forked from legalDocShell() so restyling the tender to the
// Word template could not silently restyle the Contract annexure, which is a
// separate legal document with its own review cycle. Every measurement below
// comes from the source .docx — see the token block at the top of this file.
export function tenderDocShell(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* Arial 10pt ${BODY}, Word single line spacing (pgMar 900 twips = 15.875mm). */
  body { font-family: Arial, Helvetica, sans-serif; color: ${BODY}; font-size: 10pt; line-height: 1.15; }
  /* An explicit white ground: printBackground makes the PDF honour it, and any
     on-screen preview of this HTML would otherwise inherit the host's own
     background and render the #1A1A1A labels near-invisible. */
  .page { width: 210mm; min-height: 297mm; padding: 15.875mm; background: #FFFFFF; display: flex; flex-direction: column; page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .page-body { flex: 1 1 auto; padding-bottom: 3pt; }

  /* Running header: two centred 8pt lines over a 0.5pt hairline. */
  .rhead { text-align: center; font-size: 8pt; color: ${CHROME}; line-height: 1.3; padding-bottom: 6pt; border-bottom: 0.5pt solid ${RULE}; margin-bottom: 4pt; }
  /* Running footer: 0.5pt hairline over one centred 8pt line. */
  .rfoot { margin-top: auto; padding-top: 4pt; border-top: 0.5pt solid ${RULE}; text-align: center; font-size: 8pt; color: ${CHROME}; }

  .t-date { text-align: right; margin: 4pt 0; }
  .t-title { text-align: center; font-size: 16pt; font-weight: 700; color: ${GOLD}; margin: 19pt 0 3pt; }
  .t-clients { text-align: center; font-size: 10.5pt; line-height: 20.25pt; color: ${HEADING_SUB}; margin-bottom: 1.5pt; }
  .t-clients b { color: ${LABEL}; }
  .t-brief { text-align: center; font-style: italic; margin-bottom: 3pt; }
  /* The source separates its cover blocks with literal empty paragraphs: two
     blank 10pt lines (≈23pt) between the build brief and the salutation, and
     two more between the letter and the price. Emitting real empty <p> tags
     would be fragile, so the same rhythm is set as margins. */
  .t-letter { margin-top: 23pt; }
  .t-letter p { margin: 2pt 0 11pt; }
  .t-price-label { text-align: center; font-size: 12pt; font-weight: 700; color: ${LABEL}; margin: 26pt 0 2pt; }
  .t-price { text-align: center; font-size: 14pt; font-weight: 700; color: ${GOLD}; margin: 2pt 0 3pt; }
  /* Licence/ABN disclosure, kept well clear of the letter it used to interrupt. */
  .t-statutory { text-align: center; font-size: 8pt; color: ${CHROME}; margin-top: 22pt; }
  .t-signoff { margin-top: 14pt; }
  .t-signoff b { color: ${LABEL}; }
  .t-initials { font-size: 8pt; color: ${CHROME}; margin-top: 6pt; }
  .t-inset { font-size: 8pt; font-weight: 700; color: ${LABEL}; }
  /* Manual bullet on a hanging indent (ind left=360 hanging=200 twips). */
  .t-bullet { text-indent: -10pt; padding-left: 18pt; margin: 2pt 0; }
  .t-dot { color: ${LABEL}; }

  /* Sentence case, no letter-spacing, no underline rule — as the source. */
  h2.t-section { font-size: 13pt; font-weight: 700; color: ${GOLD}; margin: 14pt 0 6pt; break-after: avoid; page-break-after: avoid; }
  h3.t-sub { font-size: 12pt; font-weight: 700; color: ${GOLD}; margin: 3pt 0 4pt; break-after: avoid; page-break-after: avoid; }
  p { margin: 2pt 0; }

  /* Every table in the source is built identically: 0.5pt ${RULE} cell borders,
     a ${GOLD_FILL} header row, 4/4/4/6pt padding (tcMar 80/80/80/120 twips) and
     zebra striping that restarts at 1 in EVERY table, first data row white. */
  table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 8pt; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th { background: ${GOLD_FILL}; color: #FFFFFF; font-weight: 700; font-size: 10pt; text-align: left; border: 0.5pt solid ${GOLD_FILL}; padding: 4pt 4pt 4pt 6pt; vertical-align: top; }
  td { background: ${ROW_BG}; color: ${BODY}; border: 0.5pt solid ${RULE}; padding: 4pt 4pt 4pt 6pt; vertical-align: top; }
  tbody tr:nth-child(even) td { background: ${ZEBRA}; }
  td b { color: ${LABEL}; }
  td.t-status { font-weight: 700; color: ${LABEL}; }

  /* Column widths as percentages of the 178.26mm content width (twips ÷ 10106). */
  .c-ref { width: 8.906%; }
  .c-desc { width: 71.304%; }
  .c-status { width: 19.790%; }
  .c-item { width: 23.748%; }
  .c-detail { width: 76.252%; }
  .c-name { width: 27.706%; }
  .c-sign { width: 42.608%; }
  .c-date { width: 29.685%; }
  .c-exc-item { width: 23.748%; }
  .c-exc-means { width: 42.608%; }
  .c-exc-req { width: 33.644%; }
  /* The source has no allowances table; it reuses the exclusions widths. */
  .c-alw-item { width: 42.608%; }
  .c-alw-amt { width: 23.748%; }
  .c-alw-rule { width: 33.644%; }
  .c-pay-stage { width: 23.748%; }
  .c-pay-pct { width: 8.906%; }
  .c-pay-amt { width: 19.790%; }
  .c-pay-trigger { width: 47.556%; }
  .c-own-name { width: 27.706%; }
  .c-own-loc { width: 23.748%; }
  .c-own-email { width: 29.685%; }
  .c-own-phone { width: 18.861%; }

  /* Word gives these rows an implicit height; HTML collapses an empty cell, so
     the signing space has to be asserted or there is nowhere to sign. */
  .t-accept td { height: 14mm; }
</style></head><body>${body}</body></html>`;
}

// The two-line centred running header, repeated on every page.
function tenderHeader(): string {
  return `<div class="rhead">${TENDER_HEADER_LINES.map(esc).join("<br />")}</div>`;
}

function tenderPage(content: string, foot: string): string {
  return `<div class="page">${tenderHeader()}<div class="page-body">${content}</div>${foot}</div>`;
}

// A4 page shell + stylesheet for the CONTRACT annexure. The tender was forked
// onto tenderDocShell() above; every byte of this one is left exactly as it was,
// so the annexure's output is unchanged by the tender restyle (asserted by
// tests/offer/offer-tender-template-parity.test.ts).
//
// That includes the .build-scope / .scope-list rules at the end, which are now
// DEAD: they styled the Tender's "Build Scope" box, which the restyle removed,
// and the annexure has never emitted either class. They are kept only to hold
// this shell byte-identical — the guarantee that justified forking rather than
// restyling in place. Delete them with the Contract's own redesign, not before.
export function legalDocShell(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1f1f1f; font-size: 11.5px; line-height: 1.5; }
  .page { width: 210mm; min-height: 297mm; padding: 16mm 18mm; display: flex; flex-direction: column; page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .masthead { border-bottom: 2px solid ${LEGACY_GOLD}; padding-bottom: 6px; font-size: 10px; font-weight: 700; color: ${LEGACY_NAVY}; display: flex; justify-content: space-between; }
  .foot { margin-top: auto; border-top: 1px solid ${LEGACY_GOLD}; padding-top: 6px; font-family: monospace; font-size: 8px; color: ${LEGACY_MUTED}; display: flex; justify-content: space-between; }
  h1.doc { font-size: 24px; color: ${LEGACY_NAVY}; letter-spacing: 1px; text-transform: uppercase; margin-top: 26px; }
  .refline { color: ${LEGACY_GOLD_DARK}; font-weight: 700; margin-top: 4px; font-size: 13px; }
  h2 { font-size: 13px; color: ${LEGACY_NAVY}; text-transform: uppercase; letter-spacing: 1px; margin-top: 22px; border-bottom: 1px solid ${LEGACY_BORDER}; padding-bottom: 4px; }
  p { margin-top: 8px; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 12px; }
  .party { border: 1px solid ${LEGACY_BORDER}; padding: 12px; }
  .party .role { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: ${LEGACY_MUTED}; }
  .party .who { font-weight: 700; color: ${LEGACY_NAVY}; margin-top: 4px; font-size: 13px; }
  .sum { margin-top: 18px; border: 1px solid ${LEGACY_NAVY}; }
  .sum .top { background: ${LEGACY_NAVY}; color: #fff; padding: 10px 14px; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; }
  .sum .amt { padding: 14px; font-size: 30px; font-weight: 700; color: ${LEGACY_NAVY}; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { text-align: left; background: #f2f3f5; border-top: 1px solid ${LEGACY_BORDER}; border-bottom: 1px solid ${LEGACY_BORDER}; padding: 7px 9px; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: ${LEGACY_MUTED}; }
  td { border-bottom: 1px solid ${LEGACY_BORDER}; padding: 7px 9px; vertical-align: top; }
  td.num { width: 8mm; color: ${LEGACY_MUTED}; }
  td.cat { width: 40mm; font-weight: 700; color: ${LEGACY_NAVY}; }
  td.status { width: 22mm; }
  .pill { display: inline-block; background: #e7efe1; color: #2f6b2f; border-radius: 3px; padding: 1px 6px; font-size: 9px; font-weight: 700; }
  ul { margin-top: 8px; padding-left: 18px; }
  li { margin-bottom: 5px; }
  ol.terms { margin-top: 10px; padding-left: 18px; }
  ol.terms > li { margin-bottom: 9px; }
  ol.terms b { color: ${LEGACY_NAVY}; }
  .note { margin-top: 14px; border-left: 3px solid ${LEGACY_GOLD}; background: #faf6ec; padding: 10px 12px; font-size: 10.5px; color: ${LEGACY_MUTED}; }
  .sig { border: 1px solid ${LEGACY_BORDER}; padding: 14px; margin-top: 14px; break-inside: avoid; page-break-inside: avoid; }
  .sig .who { font-weight: 700; color: ${LEGACY_NAVY}; }
  .sig .lines { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 22px; }
  .sig .field { border-top: 1px solid #333; padding-top: 4px; font-size: 9px; color: ${LEGACY_MUTED}; text-transform: uppercase; letter-spacing: 1px; }
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
    border-left: 1px solid ${LEGACY_BORDER};
    background: #c7b68c;
    transform: translateX(-50%);
  }

  .scope-list li {
    line-height: 1.35;
    break-inside: avoid;
  }
</style></head><body>${body}</body></html>`;
}

// ─── Pages ──────────────────────────────────────────────────────────────────

// The cover letter: date, title, client + site block, build brief, statutory
// disclosures, the letter itself and the total tender price.
function coverPage(
  input: OfferPrintTemplateInput,
  data: ReturnType<typeof buildOfferPrintTemplateData>,
  depositPercent: string | null,
  foot: string,
): string {
  const { job, customerPrice } = input;
  const owners = (job.owners ?? []).filter(
    (owner) => owner.displayName.trim().length > 0,
  );
  const clientLabel = owners.length > 1 ? "Clients" : "Client";
  const clientNames =
    owners.length > 0
      ? formatBoundedOwnerList(owners.map((owner) => ownerDisplayName(owner)))
      : job.clientNames;
  const salutation =
    owners.length > 0 ? owners[0].displayName.trim() : job.clientNames;
  // The source template's "*Insert brief of build eg. Double storey home*" slot.
  const brief = job.buildScope
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .join(", ");
  // The template prints the contract sum as numerals AND words on one line.
  const selected = customerPrice.selectedContractValueIncGst;
  const priceLine =
    selected === null
      ? money(null)
      : `${money(selected)} / ${esc(amountInWords(selected))}`;
  // The letter body. The source's "preliminary drawings by *client or architect
  // company name*" names a drawings author the offer model does not carry, so
  // the attribution is omitted rather than printed blank on a fixed-price
  // tender — see the D10 note in the PR.
  const letter = [
    `I have pleasure in presenting to you this tender for your new home, incorporating the clarifications and inclusions agreed in our recent correspondence.`,
    `Below is an itemised list of inclusions which have been included in your tender price based on the preliminary drawings provided.`,
    `Should you wish to discuss any of the contents of this tender, please do not hesitate to contact me.`,
    `I trust the tender meets with your approval; we look forward to providing you with a high level of service in the construction of your new home.`,
    depositPercent
      ? `This tender will remain firm until ${esc(data.validUntilLabel)}, subject to your acceptance and ${depositPercent} deposit.`
      : `This tender will remain firm until ${esc(data.validUntilLabel)}, subject to your acceptance.`,
  ];
  return tenderPage(
    `<div class="t-date">${esc(data.preparedDateLabel)}</div>
    <div class="t-title">FIXED PRICE TENDER</div>
    <div class="t-clients"><b>${esc(clientLabel)}:</b> ${esc(clientNames)}</div>
    <div class="t-clients">${esc(job.siteAddress)}</div>
    ${brief ? `<div class="t-brief">${esc(brief)}</div>` : ""}
    <div class="t-letter">
      <p>Dear ${esc(salutation)},</p>
      ${letter.map((para) => `<p>${para}</p>`).join("")}
    </div>
    <div class="t-price-label">TOTAL TENDER PRICE incl. GST</div>
    <div class="t-price">${priceLine}</div>
    ${/* Statutory disclosures sit at the foot of the cover, clear of the
         letter: they are a required notice, not part of the address block the
         template opens with. */ ""}
    <div class="t-statutory">${esc(BUILDER_STATUTORY_LINE)}</div>`,
    foot,
  );
}

// Project particulars, and the owner details table when it is short enough to
// sit beneath them.
function particularsPage(
  input: OfferPrintTemplateInput,
  totalArea: number,
  inlineOwnerDetailRows: readonly string[] | null,
  foot: string,
): string {
  const { job } = input;
  const grannySpec = grannyDwellingSpec(job);
  const ownerLabel = (job.owners ?? []).length > 1 ? "Owners" : "Owner";
  return tenderPage(
    `<h3 class="t-sub">Project Particulars</h3>
    <table>
      <tbody>
        ${particular("Site Location", job.siteAddress)}
        ${/* Omit unknown site particulars rather than contracting to a blank
             title reference, a blank zoning, or a "0 m²" lot. */ ""}
        ${job.dpNumber.trim() ? particular("Title reference", job.dpNumber) : ""}
        ${job.zoning.trim() ? particular("Zoning", job.zoning) : ""}
        ${job.lotAreaSqm > 0 ? particular("Lot area", formatArea(job.lotAreaSqm)) : ""}
        ${particular("Build type", job.buildType)}
        ${job.facade ? particular("Façade", job.facade) : ""}
        ${particular("Total build area", formatArea(totalArea))}
        ${particular(
          "Major House Specifications",
          formatDwellingSpec({
            bathrooms: job.bathrooms,
            bedrooms: job.bedrooms,
            garageSpaces: job.garageSpaces,
          }),
        )}
        ${grannySpec ? particular("Granny Home Specifications", formatDwellingSpec(grannySpec)) : ""}
        ${particular("Prepared by", job.preparedBy)}
      </tbody>
    </table>
    ${
      inlineOwnerDetailRows && inlineOwnerDetailRows.length > 0
        ? `<h3 class="t-sub">${esc(ownerLabel)} Details</h3>
    ${ownerDetailsTable(inlineOwnerDetailRows)}`
        : ""
    }`,
    foot,
  );
}

function particular(label: string, value: string): string {
  return `<tr><td class="c-item"><b>${esc(label)}</b></td><td class="c-detail">${esc(value)}</td></tr>`;
}

// Owner display name with ABN/ACN annotation for companies.
function ownerDisplayName(owner: OfferOwner): string {
  const name = owner.displayName.trim();
  if (owner.kind === "company" && owner.abn.trim().length > 0) {
    return `${name} (ABN/ACN ${owner.abn.trim()})`;
  }
  return name;
}

function ownerDetailsTable(rows: readonly string[]): string {
  return `<table><thead><tr><th class="c-own-name">Owner</th><th class="c-own-loc">Current Location</th><th class="c-own-email">Email</th><th class="c-own-phone">Phone</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

// One or more Owner Details rows: an individual is a single row (name / current
// location / email / phone); a company is a header row (name + ABN + registered
// office) followed by one sub-row per director signatory.
function ownerDetailRowsHtml(owner: OfferOwner): string {
  const nameCell =
    owner.kind === "company" && owner.abn.trim().length > 0
      ? `<b>${esc(owner.displayName)}</b><br />ABN/ACN ${esc(owner.abn)}`
      : `<b>${esc(owner.displayName)}</b>`;
  if (owner.kind === "individual") {
    const signer = owner.signatories[0];
    return `<tr><td class="c-own-name">${nameCell}</td><td class="c-own-loc">${esc(owner.currentLocation)}</td><td class="c-own-email">${esc(signer?.email ?? "")}</td><td class="c-own-phone">${esc(signer?.phone ?? "")}</td></tr>`;
  }
  const header = `<tr><td class="c-own-name">${nameCell}</td><td class="c-own-loc">${esc(owner.currentLocation)}</td><td class="c-own-email" colspan="2">Signed by its director(s) below</td></tr>`;
  const directors = owner.signatories
    .map(
      (director) =>
        `<tr><td class="c-own-name">${esc(director.name)}, ${esc(director.capacity)}</td><td class="c-own-loc"></td><td class="c-own-email">${esc(director.email)}</td><td class="c-own-phone">${esc(director.phone)}</td></tr>`,
    )
    .join("");
  return header + directors;
}

// Owner Details on their own page, used when the table is too long to sit
// beneath the particulars without pushing past one physical sheet.
function ownerDetailsPage(
  rows: readonly string[],
  continued: boolean,
  foot: string,
): string {
  return tenderPage(
    `<h3 class="t-sub">Owner Details${continued ? " (cont.)" : ""}</h3>
    ${ownerDetailsTable(rows)}`,
    foot,
  );
}

// One page of the inclusion schedule. Sections open a numbered gold heading and
// a fresh table; a section continued from the previous sheet reopens with a
// "(cont.)" heading so no table is left headless.
function schedulePage(
  items: readonly ScheduleItem[],
  first: boolean,
  foot: string,
): string {
  const parts: string[] = [];
  if (first) {
    parts.push(
      `<p>All items below are included in the Tender Price and fixed as per the approved plans and specifications, confirmed at colour selection.</p>`,
    );
  }
  // Tracked as a name rather than the section object: TypeScript does not follow
  // assignments made inside the closures below, so a nullable object reference
  // narrows to `never` on the continuation branch.
  let openSectionName = "";
  let openRows: string[] = [];
  const closeTable = () => {
    if (openRows.length > 0) {
      parts.push(
        `<table><thead><tr><th class="c-ref">Ref</th><th class="c-desc">Description</th><th class="c-status">Status</th></tr></thead><tbody>${openRows.join("")}</tbody></table>`,
      );
      openRows = [];
    }
  };
  const openHeading = (section: TenderInclusionSection, continued: boolean) => {
    closeTable();
    // "1." + three spaces + the section name, exactly as the source.
    parts.push(
      `<h2 class="t-section">${section.index}.&nbsp;&nbsp;&nbsp;${esc(section.name)}${continued ? " (cont.)" : ""}</h2>`,
    );
    openSectionName = section.name;
  };
  for (const item of items) {
    if (item.kind === "heading") {
      openHeading(item.section, false);
      continue;
    }
    if (openSectionName !== item.section.name) {
      openHeading(item.section, true);
    }
    openRows.push(inclusionRowHtml(item.row));
  }
  closeTable();
  return tenderPage(parts.join(""), foot);
}

// A schedule row. The Description cell is a SINGLE block — a bold lead-in label
// (the entry's trade label) over the specification detail, separated by <br />,
// not a list and not separate paragraphs. Where a row has no detail the cell is
// the bold label alone.
function inclusionRowHtml(row: TenderInclusionRow): string {
  const label = row.label;
  const spec = row.entry.spec.trim();
  const description =
    label.length > 0 && spec.length > 0
      ? `<b>${esc(label)}</b><br />${esc(spec)}`
      : label.length > 0
        ? `<b>${esc(label)}</b>`
        : esc(spec);
  return `<tr><td class="c-ref">${esc(row.ref)}</td><td class="c-desc">${description}</td><td class="c-status t-status">Included</td></tr>`;
}

// "N.   Contract Terms & Payment Schedule": the source's two-column Item/Detail
// table, followed by the real per-stage progress payment schedule. The source
// collapses payments to one boilerplate row of typical percentages; this offer
// carries actual staged amounts, which are worth more to a client than
// boilerplate, so they are printed as their own table.
function contractTermsPage(
  data: ReturnType<typeof buildOfferPrintTemplateData>,
  sectionNo: number,
  depositPercent: string | null,
  foot: string,
): string {
  const term = (item: string, detail: string): string =>
    `<tr><td class="c-item"><b>${item}</b></td><td class="c-detail">${detail}</td></tr>`;
  // formatPercent, as the React print path uses: toFixed(0) printed a 12.5% stage
  // as 13% beside an amount computed from 12.5%.
  const pay = data.paymentRows
    .map(
      (row) =>
        `<tr><td class="c-pay-stage"><b>${esc(row.stageName)}</b></td><td class="c-pay-pct">${formatPercent(row.percentOfContract)}</td><td class="c-pay-amt">${money(row.amount)}</td><td class="c-pay-trigger">${esc(row.trigger)}</td></tr>`,
    )
    .join("");
  return tenderPage(
    `<h2 class="t-section">${sectionNo}.&nbsp;&nbsp;&nbsp;Contract Terms &amp; Payment Schedule</h2>
    <table>
      <thead><tr><th class="c-item">Item</th><th class="c-detail">Detail</th></tr></thead>
      <tbody>
        ${term("Contract Documents", "This Tender, the approved plans and specifications, and the executed MBA fixed-price home building contract together form the agreement between the parties.")}
        ${term("Construction Period", "Approximately 8&ndash;10 months from slab pour to handover, subject to council approval timing and site conditions. Pre-construction and plan preparation time is additional. Final period to be confirmed in the MBA Building Contract.")}
        ${term("Tender Validity", depositPercent ? `This tender remains firm until ${esc(data.validUntilLabel)}, subject to acceptance and ${depositPercent} deposit.` : `This tender remains firm until ${esc(data.validUntilLabel)}, subject to acceptance.`)}
        ${term("Site Conditions", "Priced on standard residential site conditions. Class H2/E soil, rock, or abnormal fill identified by geotechnical investigation is addressed by written variation before affected works proceed.")}
        ${term("Progress Payments", "Claims are payable within the period stated in the building contract on completion of each stage set out below.")}
        ${term("Variations", "No variation is carried out without a signed Variation Order. Owner-requested variations: $250 + GST admin fee plus cost of works. Variations may extend the contract period by a minimum of 2 weeks. Variation amounts are payable at the next progress claim.")}
        ${term("Insurance &amp; Warranty", "Home Building Compensation Fund (HBCF) cover and statutory warranties are provided as required under the Home Building Act.")}
        ${term("Commencement", "Construction commences after finance approval, HBCF certificate, and council/CDC approval, within the period set out in the building contract.")}
      </tbody>
    </table>
    <h3 class="t-sub">Progress Payment Schedule</h3>
    <table><thead><tr><th class="c-pay-stage">Stage</th><th class="c-pay-pct">%</th><th class="c-pay-amt">Amount (incl. GST)</th><th class="c-pay-trigger">Trigger</th></tr></thead><tbody>${pay}</tbody></table>`,
    foot,
  );
}

// ─── Exclusions sheet and allowances layout ─────────────────────────────────
// The Exclusions table's columns are 23.748% / 42.608% / 33.644% of 178.26mm.
// The Item cell is bold, so it holds fewer characters per millimetre.
const CHARS_PER_LINE_EXCLUSION_ITEM = 20;
const CHARS_PER_LINE_EXCLUSION_MEANS = 40;
const CHARS_PER_LINE_EXCLUSION_REQUIRED = 32;
// A note bullet runs the full content width less its hanging indent.
const CHARS_PER_LINE_NOTE = 90;
// A table's header row, in line units.
const TABLE_HEADER_LINES = 2;
// An h3.t-sub heading: a 12pt line plus 3pt above and 4pt below.
const SUB_HEADING_LINES = 2;
// The one-line intro above the exclusions table, with its spacing.
const EXCLUSIONS_INTRO_LINES = 2;
// The allowances intro: two lines at full width, with its spacing.
const TENDER_ALLOWANCES_INTRO_LINES = 2.5;
// A row's 4pt top and bottom padding plus its border, about three quarters of a
// 10pt line. The owner and schedule tables round this up to a whole line; these
// two tables share one sheet, so they use the measured figure, and the Chromium
// sheet-count tests hold it to what actually prints.
const SHARED_SHEET_ROW_CHROME_LINES = 0.75;
// The Tender's allowance columns: Item 42.608% (a bold label over its
// description) and "If the actual cost differs" 33.644% of 178.26mm.
const CHARS_PER_LINE_TENDER_ALLOWANCE_ITEM = 36;
const CHARS_PER_LINE_TENDER_ALLOWANCE_RULE = 32;

type TenderExclusionRow = ReturnType<
  typeof buildOfferPrintTemplateData
>["exclusionRows"][number];

// An exclusion row is as tall as its tallest cell. An empty cell prints a dash.
function exclusionRowLines(row: TenderExclusionRow): number {
  return (
    Math.max(
      estimateWrappedLines(row.label, CHARS_PER_LINE_EXCLUSION_ITEM),
      estimateWrappedLines(row.description || "-", CHARS_PER_LINE_EXCLUSION_MEANS),
      estimateWrappedLines(
        row.variationRule || "-",
        CHARS_PER_LINE_EXCLUSION_REQUIRED,
      ),
    ) + SHARED_SHEET_ROW_CHROME_LINES
  );
}

// Each note is its own paragraph, with a little spacing after it.
function importantNotesLines(hasAllowances: boolean): number {
  return importantNotes(hasAllowances).reduce(
    (sum, note) => sum + estimateWrappedLines(note, CHARS_PER_LINE_NOTE) + 0.25,
    0,
  );
}

// An allowance row is as tall as its taller cell: the label stacked over the
// description, or the variation rule. An empty rule prints a dash.
function tenderAllowanceRowLines(row: OfferPrintScopeRow): number {
  const item =
    estimateWrappedLines(row.label, CHARS_PER_LINE_TENDER_ALLOWANCE_ITEM) +
    (row.description.trim().length > 0
      ? estimateWrappedLines(
          row.description,
          CHARS_PER_LINE_TENDER_ALLOWANCE_ITEM,
        )
      : 0);
  return (
    Math.max(
      item,
      estimateWrappedLines(
        row.variationRule || "-",
        CHARS_PER_LINE_TENDER_ALLOWANCE_RULE,
      ),
    ) + SHARED_SHEET_ROW_CHROME_LINES
  );
}

type TenderAllowanceLayout = {
  // Printed beneath the exclusions and Important Notes, on their sheet.
  readonly inline: readonly OfferPrintScopeRow[];
  // Each on a sheet of its own after that.
  readonly continuation: readonly (readonly OfferPrintScopeRow[])[];
};

// The allowances follow the exclusions on the same sheet while they fit. The
// section's heading, intro and table header only go there with at least one
// row, so a heading is never the last thing on the sheet; whatever does not fit
// continues on counted pages. Rows are measured at the Tender's own column widths.
function layoutTenderAllowances(
  data: ReturnType<typeof buildOfferPrintTemplateData>,
): TenderAllowanceLayout {
  const rows = data.tenderScopeRows;
  if (rows.length === 0) {
    return { inline: [], continuation: [] };
  }
  const exclusionsLines =
    SUB_HEADING_LINES +
    EXCLUSIONS_INTRO_LINES +
    TABLE_HEADER_LINES +
    data.exclusionRows.reduce((sum, row) => sum + exclusionRowLines(row), 0) +
    importantNotesLines(true);
  let remaining =
    TENDER_LINES_PER_PAGE -
    exclusionsLines -
    SUB_HEADING_LINES -
    TENDER_ALLOWANCES_INTRO_LINES -
    TABLE_HEADER_LINES;
  const inline: OfferPrintScopeRow[] = [];
  for (const row of rows) {
    const lines = tenderAllowanceRowLines(row);
    if (lines > remaining) break;
    inline.push(row);
    remaining -= lines;
  }
  const rest = rows.slice(inline.length);
  if (rest.length === 0) {
    return { inline, continuation: [] };
  }
  // A sheet of its own carries the heading and table header, plus the intro
  // when none of the section fitted beneath the exclusions.
  const budget =
    TENDER_LINES_PER_PAGE -
    SUB_HEADING_LINES -
    TABLE_HEADER_LINES -
    (inline.length === 0 ? TENDER_ALLOWANCES_INTRO_LINES : 0);
  return {
    inline,
    continuation: chunkByEstimatedHeight(rest, budget, tenderAllowanceRowLines),
  };
}

// "Exclusions & Important Notes". Kept as three columns rather than the source's
// bullets: the description and variation rule are captured on every Scope
// exclusion and were previously printed NOWHERE — an estimator typed "Can be
// priced later as a written variation" and no client saw it. The offer keeps its
// short bullets; the TENDER is the document that carries the obligation, so it
// carries the detail. A free-text bullet has no such detail and prints
// label-only; that gap is visible here rather than hidden, which is the point.
function exclusionsPage(
  data: ReturnType<typeof buildOfferPrintTemplateData>,
  inlineAllowances: readonly OfferPrintScopeRow[],
  foot: string,
): string {
  const notes = importantNotes(data.tenderScopeRows.length > 0);
  const excludes = data.exclusionRows
    .map(
      (row) =>
        `<tr><td class="c-exc-item"><b>${esc(row.label)}</b></td><td class="c-exc-means">${esc(row.description) || "&mdash;"}</td><td class="c-exc-req">${esc(row.variationRule) || "&mdash;"}</td></tr>`,
    )
    .join("");
  return tenderPage(
    `<h3 class="t-sub">Exclusions &amp; Important Notes</h3>
    <p>The following are not included in the Tender Price and, if required, are priced as a written variation:</p>
    <table><thead><tr><th class="c-exc-item">Item</th><th class="c-exc-means">What this means</th><th class="c-exc-req">If required</th></tr></thead><tbody>${excludes}</tbody></table>
    ${notes.map(bullet).join("")}
    ${inlineAllowances.length > 0 ? allowancesSection(inlineAllowances, false) : ""}`,
    foot,
  );
}

// The "Important Notes" half of the section heading. The source carries these as
// bulleted notes beneath the exclusions, not as a block of bold prose.
//
// The price note used to make the Tender subject to allowances "noted in the
// inclusions schedule", a list the Tender never printed. It now points at the
// allowances page when there is one, and claims no allowances when there isn't.
function importantNotes(hasAllowances: boolean): readonly string[] {
  return [
    "This Tender is the final fixed-price offer for the works described above and, on acceptance by both parties, forms the basis of a Master Builders Association (MBA) fixed-price home building contract. It supersedes any earlier negotiation proposal.",
    hasAllowances
      ? "The Tender Price is fixed and includes GST for the full scope described, subject only to written variations and the prime cost and provisional sum allowances set out in this Tender."
      : "The Tender Price is fixed and includes GST for the full scope described, subject only to written variations.",
    "Above tender is subject to final engineering details and council requirements.",
  ];
}

// "Prime Cost & Provisional Sums": every allowance ticked "Show on Tender", with
// its amount and what happens when the real cost differs, whatever the Offer box
// says: the Tender is the document that is signed. The section follows the
// exclusions on their sheet while it fits (layoutTenderAllowances) and runs on
// "(cont.)" pages after that. The item cell stacks the description under the
// label only when it says something the variation rule does not (scopeRows drops
// repeats).
function allowancesPage(
  rows: readonly OfferPrintScopeRow[],
  continued: boolean,
  foot: string,
): string {
  return tenderPage(allowancesSection(rows, continued), foot);
}

function allowancesSection(
  rows: readonly OfferPrintScopeRow[],
  continued: boolean,
): string {
  const body = rows
    .map((row) => {
      const description = row.description.trim();
      const item = description
        ? `<b>${esc(row.label)}</b><br />${esc(description)}`
        : `<b>${esc(row.label)}</b>`;
      return `<tr><td class="c-alw-item">${item}</td><td class="c-alw-amt">${esc(row.amountLabel)}</td><td class="c-alw-rule">${esc(row.variationRule) || "&mdash;"}</td></tr>`;
    })
    .join("");
  return `<h3 class="t-sub">Prime Cost &amp; Provisional Sums${continued ? " (cont.)" : ""}</h3>
    ${continued ? "" : `<p>The following amounts are allowances included in the Tender Price, not fixed costs. Where the final selection costs more or less than the allowance, the difference is adjusted by written variation as set out against each item.</p>`}
    <table><thead><tr><th class="c-alw-item">Item</th><th class="c-alw-amt">Allowance</th><th class="c-alw-rule">If the actual cost differs</th></tr></thead><tbody>${body}</tbody></table>`;
}

// A manual bullet glyph plus two spaces on a hanging indent — the source's own
// construction (ind left=360 hanging=200 twips). A real <ul> will not reproduce
// the 18pt/10pt geometry without fighting browser defaults.
function bullet(text: string): string {
  return `<p class="t-bullet"><span class="t-dot">&bull;</span>&nbsp;&nbsp;${esc(text)}</p>`;
}

// "Acceptance of Tender": a single three-column table — one row per customer
// signer in collectOfferSigners() order, then the builder last, matching the
// DocuSign routing order (customer routing 1, builder routing 2). The
// sigOwner{k}/dateOwner{k}/initOwner{k} anchors use the signer's GLOBAL index so
// they stay aligned with the recipients built in offer-tender-sign.ts.
type AcceptanceRow = { readonly html: string; readonly lines: number };

// The acceptance rows in DocuSign routing order: every customer signer first,
// then the builder. A row is never shorter than its 14mm signing space, and a
// company director's row carries the entity name too, so it wraps well past it.
function buildAcceptanceRows(
  job: OfferWorkspaceJob,
  signers: readonly OfferSignerContext[],
): AcceptanceRow[] {
  const rowFor = (whoText: string, whoHtml: string, tags: readonly [string, string]) => ({
    html: `<tr><td class="c-name">${whoHtml}</td><td class="c-sign">${anchor(tags[0])}</td><td class="c-date">${anchor(tags[1])}</td></tr>`,
    lines: Math.max(
      ACCEPTANCE_ROW_MIN_LINES,
      estimateWrappedLines(whoText, CHARS_PER_LINE_ACCEPT_NAME) + 1,
    ),
  });
  const ownerRows = signers.map((signer, index) => {
    const k = index + 1;
    // Plain-text twin drives the height estimate (escaping would inflate it).
    const whoText = signer.entityName
      ? `Client: ${signer.signatory.name}, ${signer.signatory.capacity} of ${signer.entityName}`
      : `Client: ${signer.signatory.name}`;
    const whoHtml = signer.entityName
      ? `Client: ${esc(signer.signatory.name)}, ${esc(signer.signatory.capacity)} of ${esc(signer.entityName)}`
      : `Client: ${esc(signer.signatory.name)}`;
    return rowFor(whoText, whoHtml, [`sigOwner${k}`, `dateOwner${k}`]);
  });
  const builderText = `Builder: ${job.preparedBy} Royal Constructions`;
  const builderHtml = `Builder: ${esc(job.preparedBy)}<br />Royal Constructions`;
  return [
    ...ownerRows,
    rowFor(builderText, builderHtml, ["sigBuilder", "dateBuilder"]),
  ];
}

// One page of the acceptance table. The intro leads the first page, the sign-off
// and the initial anchors close the last. Previously this was a single page: ten
// company directors, whose rows carry a long entity name AND 14mm of signing
// space each, overflowed it onto sheets the footer never counted.
function acceptancePage(
  job: OfferWorkspaceJob,
  signers: readonly OfferSignerContext[],
  rows: readonly AcceptanceRow[],
  depositPercent: string | null,
  first: boolean,
  last: boolean,
  foot: string,
): string {
  // The source template has no "initial each page" line, but the DocuSign
  // envelope declares an initialHereTabs entry for EVERY owner recipient
  // (lib/docusign/tender-envelope.ts). Dropping these anchors would leave those
  // tabs unplaced, so they keep a home here.
  const initials = signers
    .map((_, index) => anchor(`initOwner${index + 1}`))
    .join(" ");
  return tenderPage(
    `<h3 class="t-sub">Acceptance of Tender${first ? "" : " (cont.)"}</h3>
    ${first ? `<p>Please read and acknowledge that you understand the above document by signing below. ${depositPercent ? `Once signed, please return along with the ${depositPercent} deposit to proceed.` : "Once signed, please return it to proceed."}</p>` : ""}
    <table class="t-accept">
      <thead><tr><th class="c-name">Print Full Name</th><th class="c-sign">Signature</th><th class="c-date">Date</th></tr></thead>
      <tbody>${rows.map((row) => row.html).join("")}</tbody>
    </table>
    ${last && initials ? `<div class="t-initials">${initials}</div>` : ""}
    ${
      last
        ? `<div class="t-signoff">
      <p>Yours Faithfully,</p>
      <p><b>${esc(job.preparedBy)}</b><br />Royal Constructions<br />${esc(BUILDER_CONTACT_LINE)}</p>
    </div>`
        : ""
    }`,
    foot,
  );
}
