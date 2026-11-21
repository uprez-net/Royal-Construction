import type { VariationDocumentData } from "@/lib/domain/ports/variation";
import { COMPANY_LINE } from "@/lib/offer/workspace-print-template";

// The variation document the client receives: one A4 page in the offer's own
// livery — the same masthead, charcoal with a gold rule, cover table and mono footer as
// the Building Proposal — so it reads as the next page of the contract they
// signed rather than a form from somewhere else.
//
// Self-contained HTML with inline CSS, rendered to PDF by headless Chromium
// (`generatePDF`) and shown as-is in the wizard's preview, so what the office
// approves on screen is byte-for-byte the page the client is sent.

const BODY_FONT = 'Manrope, "Segoe UI", Helvetica, Arial, sans-serif';
const HEAD_FONT = 'Georgia, "Times New Roman", serif';
const MONO_FONT = '"IBM Plex Mono", Menlo, Consolas, monospace';
// DESIGN.md section 2 and 5: charcoal on white; gold only as a rule or a table
// underline; gold-ink where gold is read; status colours for status words.
const CHARCOAL = "#343434";
const GOLD = "#C6923A";
const GOLD_INK = "#926100";
const SUNK = "#F1EFE9";
const HAIRLINE = "#E6E2D9";
const BORDER_STRONG = "#D3CEC3";
const MUTED = "#6B675F";
const STATUS_DANGER = "#ac0f0f";
const STATUS_OK = "#1e7a45";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// To the cent: this is an invoice, and a rounded figure beside the Xero
// invoice reads as a discrepancy.
const MONEY = new Intl.NumberFormat("en-AU", {
  currency: "AUD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

function money(cents: number): string {
  return MONEY.format(cents / 100);
}

const DAY = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "long",
  timeZone: "Australia/Sydney",
  year: "numeric",
});

function row(label: string, value: string, highlight = false): string {
  const cls = highlight ? " hi" : "";
  return `<tr><td class="lbl${cls}">${esc(label)}</td><td class="val${cls}">${value}</td></tr>`;
}

export function buildVariationDocumentHtml(
  data: VariationDocumentData,
): string {
  const promotional = data.kind === "PROMOTIONAL";
  const raised = DAY.format(data.raisedDate);

  const coverRows = [
    row("Client", esc(data.clientNames)),
    row("Site Location", esc(data.siteAddress)),
    row("Project", esc(data.projectName)),
    row(
      "Activity",
      `${esc(data.activityName)}${data.stageLabel ? `<span class="sub"> · ${esc(data.stageLabel)} stage</span>` : ""}`,
    ),
    row("Variation No.", esc(data.number)),
    row("Date Raised", esc(raised)),
    ...(data.invoiceNumber
      ? [row("Invoice No.", esc(data.invoiceNumber))]
      : []),
    ...(!promotional && data.dueDate
      ? [row("Payment Due", esc(DAY.format(data.dueDate)))]
      : []),
  ].join("");

  const chargeRows = promotional
    ? `<tr><td>Covered by Royal Constructions</td><td class="amt credit">−${money(data.absorbedCents)}</td></tr>`
    : `<tr><td>GST (10%)</td><td class="amt">${money(data.gstCents)}</td></tr>`;

  const totalNote = promotional
    ? `Royal Constructions is covering this variation in full. There is nothing for you to pay; this document is for your records.`
    : `Payable within the terms of your contract${data.dueDate ? `, by ${esc(DAY.format(data.dueDate))}` : ""}${data.invoiceNumber ? `, quoting invoice ${esc(data.invoiceNumber)}` : ""}.`;

  return `<!doctype html><html><head><meta charset="utf-8" />
<title>${esc(`Variation ${data.number}`)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: ${BODY_FONT}; color: ${CHARCOAL}; background: #fff; }
  .page { width: 210mm; min-height: 297mm; padding: 13mm 18mm; display: flex; flex-direction: column; }
  .masthead { border-bottom: 1px solid ${GOLD}; padding-bottom: 6px; font-size: 11px; font-weight: 700; color: ${CHARCOAL}; }
  .foot { margin-top: auto; border-top: 1px solid ${HAIRLINE}; padding-top: 6px; font-family: ${MONO_FONT}; font-size: 8px; color: ${MUTED}; }
  .eyebrow { font-family: ${BODY_FONT}; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${GOLD_INK}; margin-top: 26px; }
  h1.title { font-family: ${HEAD_FONT}; font-size: 26px; color: ${CHARCOAL}; margin-top: 6px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .badge { font-family: ${BODY_FONT}; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; border: 1px solid ${HAIRLINE}; background: ${SUNK}; color: ${GOLD_INK}; padding: 4px 8px; }
  p { line-height: 1.55; font-size: 13px; }
  .muted { color: ${MUTED}; }
  table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 13px; }
  .cover td { padding: 8px 12px; vertical-align: top; }
  .cover .lbl { background: ${SUNK}; color: ${CHARCOAL}; font-weight: 700; width: 50mm; }
  .cover td { border-bottom: 1px solid ${HAIRLINE}; }
  .cover .sub { color: ${MUTED}; }
  .reason { border-left: 3px solid ${BORDER_STRONG}; background: #fff; padding: 12px 16px; margin-top: 10px; white-space: pre-wrap; }
  .price th { text-align: left; text-transform: uppercase; font-size: 11px; letter-spacing: 1px; color: ${MUTED}; background: ${SUNK}; border-top: 1px solid ${HAIRLINE}; border-bottom: 1px solid ${GOLD}; padding: 10px; }
  .price td { border-bottom: 1px solid ${HAIRLINE}; padding: 11px 10px; }
  .price th.amt, .price td.amt { text-align: right; white-space: nowrap; width: 55mm; }
  .price td.amt { font-family: ${MONO_FONT}; color: ${CHARCOAL}; }
  .was { text-decoration: line-through; color: ${MUTED}; margin-right: 10px; }
  .now { font-weight: 700; }
  .credit { color: ${STATUS_OK} !important; }
  .increase { color: ${promotional ? STATUS_DANGER : CHARCOAL} !important; }
  .pricebox { border: 1px solid ${HAIRLINE}; background: ${SUNK}; padding: 20px 24px; margin-top: 22px; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  .pricebox .lbl { text-transform: uppercase; font-size: 11px; letter-spacing: 1px; color: ${MUTED}; }
  .pricebox .big { font-size: 34px; font-weight: 700; color: ${CHARCOAL}; font-family: ${MONO_FONT}; white-space: nowrap; }
  .pricebox p { font-size: 12px; margin-top: 6px; max-width: 95mm; }
</style></head><body>
<div class="page">
  <div class="masthead">${esc(COMPANY_LINE)}</div>
  <div class="eyebrow">Contract variation</div>
  <h1 class="title">Variation ${esc(data.number)}${promotional ? `<span class="badge">Covered by Royal Constructions</span>` : ""}</h1>
  <p style="margin-top:12px;max-width:160mm;">Dear ${esc(data.greetingName)}, this document records a change to the price of one activity on your build${promotional ? ", and that Royal Constructions is covering the difference" : ""}.</p>
  <table class="cover">${coverRows}</table>

  <div class="eyebrow">Reason for this variation</div>
  <p class="reason">${esc(data.reason)}</p>

  <div class="eyebrow">Price change</div>
  <table class="price">
    <thead><tr><th>Item</th><th class="amt">Amount (ex GST)</th></tr></thead>
    <tbody>
      <tr><td>${esc(data.activityName)}<br /><span class="muted" style="font-size:11px;">Quoted price, now the new price</span></td>
        <td class="amt"><span class="was">${money(data.previousPriceCents)}</span><span class="now">${money(data.newPriceCents)}</span></td></tr>
      <tr><td>Variation amount</td><td class="amt increase">+${money(data.differenceCents)}</td></tr>
      ${chargeRows}
    </tbody>
  </table>

  <div class="pricebox">
    <div>
      <div class="lbl">${promotional ? "Total payable by you" : "Total payable (inc GST)"}</div>
      <p class="muted">${totalNote}</p>
    </div>
    <div class="big">${money(data.chargeIncGstCents)}</div>
  </div>

  <p class="muted" style="margin-top:22px;font-size:12px;">All amounts are in Australian dollars. Activity prices are shown excluding GST, as in your contract's cost schedule. Please reply to the email this came with if you have any questions.</p>

  <div class="foot">${esc(`${data.siteAddress} | Variation ${data.number} | Raised ${raised} | Page 1 of 1`)}</div>
</div>
</body></html>`;
}
