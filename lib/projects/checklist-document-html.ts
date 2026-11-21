import type { ChecklistDocumentData } from "@/lib/domain/ports/checklist";

// The downloaded project checklist (issue #420), laid out like the client's
// own "RC Handover Checklist.docx" rather than a screenshot of the web page:
// the "Royal Constructions:" heading, the checklist name with its note, the
// Project Address / House Type / Checked and completed by block, the rooms
// with a Location and Checked column in two columns side by side, Additional
// Comments, and Name of the Reviewer, Signature and Date at the foot.
//
// Self-contained HTML with inline CSS, rendered to PDF by headless Chromium.
// A checklist that is not closed prints as a draft on every page.

const BODY_FONT = 'Manrope, "Segoe UI", Helvetica, Arial, sans-serif';
const HEAD_FONT = 'Georgia, "Times New Roman", serif';
const MONO_FONT = '"IBM Plex Mono", Menlo, Consolas, monospace';
// DESIGN.md section 2 and 5: charcoal on white; gold only as a letterhead rule
// or a table-header underline; status colours for status words.
const CHARCOAL = "#343434";
const GOLD = "#C6923A";
const SUNK = "#F1EFE9";
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

const DAY = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "long",
  timeZone: "Australia/Sydney",
  year: "numeric",
});

const DAY_TIME = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: "Australia/Sydney",
  year: "numeric",
});

const BOX_CHECKED = `<span class="box on">&#10003;</span>`;
const BOX_EMPTY = `<span class="box"></span>`;

function checkedCell(
  item: ChecklistDocumentData["sections"][number]["items"][number],
): string {
  const flag =
    item.openIssueNumbers.length > 0
      ? `<span class="flag">Issue ${item.openIssueNumbers.map((n) => `#${n}`).join(", ")}</span>`
      : "";
  if (item.state === "NOT_APPLICABLE") {
    return `<span class="na">N/A</span>${flag}`;
  }
  return `${item.state === "CHECKED" ? BOX_CHECKED : BOX_EMPTY}${flag}`;
}

function sectionTable(
  section: ChecklistDocumentData["sections"][number],
): string {
  const rows = section.items
    .map(
      (item) => `<tr>
  <td class="loc">${esc(item.label)}${
    item.state === "NOT_APPLICABLE" && item.naReason
      ? `<div class="reason">Not applicable: ${esc(item.naReason)}</div>`
      : ""
  }</td>
  <td class="chk">${checkedCell(item)}</td>
</tr>`,
    )
    .join("");
  return `<table class="room">
  <thead><tr><th class="loc">${esc(section.section)}</th><th class="chk">Checked</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

function blankTemplate(): string {
  const rows = Array.from(
    { length: 18 },
    () =>
      `<tr><td class="loc">&nbsp;</td><td class="chk">${BOX_EMPTY}</td></tr>`,
  ).join("");
  return `<p class="note">No inspection items have been configured for this checklist yet. This is a blank template: it records nothing as inspected or completed.</p>
<table class="room blank">
  <thead><tr><th class="loc">Location</th><th class="chk">Checked</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

export function buildChecklistDocumentHtml(
  data: ChecklistDocumentData,
): string {
  const stateBadge = !data.configured
    ? `<span class="badge draft">Blank template – not configured</span>`
    : data.final
      ? `<span class="badge final">Final – closed${data.closedAt ? ` ${esc(DAY.format(data.closedAt))}` : ""}</span>`
      : `<span class="badge draft">Draft – inspection in progress, not closed</span>`;

  const sections = data.configured
    ? `<div class="columns">${data.sections.map(sectionTable).join("")}</div>`
    : blankTemplate();

  const comments = data.comments?.trim()
    ? `<div class="comments-body">${esc(data.comments)}</div>`
    : `<div class="comments-body empty">&nbsp;</div>`;

  const issues =
    data.issues.length > 0
      ? `<div class="appendix">
  <h2>Issue register</h2>
  <table class="issues">
    <thead><tr><th>#</th><th>Location</th><th>Issue</th><th>Tradie</th><th>Status</th></tr></thead>
    <tbody>${data.issues
      .map(
        (issue) => `<tr>
      <td class="num">${issue.number}</td>
      <td>${esc(issue.location)}</td>
      <td class="desc">${esc(issue.description)}</td>
      <td>${esc(issue.tradieName ?? "Unassigned")}</td>
      <td>${esc(issue.statusLabel)}${issue.verifiedAt ? `<div class="muted">${esc(DAY.format(issue.verifiedAt))}</div>` : ""}</td>
    </tr>`,
      )
      .join("")}</tbody>
  </table>
</div>`
      : "";

  const watermark = data.final
    ? ""
    : `<div class="watermark">${data.configured ? "DRAFT" : "TEMPLATE"}</div>`;

  return `<!doctype html><html><head><meta charset="utf-8" />
<title>${esc(`${data.projectName} – ${data.checklistTitle}`)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4; margin: 12mm 12mm 14mm; }
  body { font-family: ${BODY_FONT}; color: ${CHARCOAL}; background: #fff; font-size: 10.5px; }
  .watermark { position: fixed; top: 42%; left: 0; right: 0; text-align: center; font-size: 120px; font-weight: 700; color: rgba(172, 15, 15, 0.08); transform: rotate(-30deg); letter-spacing: 12px; z-index: 0; pointer-events: none; }
  .content { position: relative; z-index: 1; }
  .company { font-family: ${HEAD_FONT}; font-size: 15px; font-weight: 700; color: ${CHARCOAL}; border-bottom: 2px solid ${GOLD}; padding-bottom: 5px; }
  h1 { font-family: ${HEAD_FONT}; font-size: 19px; color: ${CHARCOAL}; margin-top: 10px; }
  .note { margin-top: 4px; color: ${MUTED}; font-style: italic; }
  .badge { display: inline-block; margin-top: 8px; font-size: 9.5px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; padding: 3px 8px; border: 1px solid; }
  .badge.final { color: ${STATUS_OK}; border-color: ${STATUS_OK}; background: #e6f4ec; }
  .badge.draft { color: ${STATUS_DANGER}; border-color: ${STATUS_DANGER}; background: #fbeaea; }
  table { border-collapse: collapse; width: 100%; }
  .header { margin-top: 10px; }
  .header td { border: 1px solid ${BORDER_STRONG}; padding: 6px 8px; vertical-align: top; }
  .header td.lbl { width: 46mm; font-weight: 700; background: ${SUNK}; }
  .columns { column-count: 2; column-gap: 6mm; margin-top: 10px; }
  .room { break-inside: avoid; margin-bottom: 6px; }
  .room th, .room td { border: 1px solid ${BORDER_STRONG}; padding: 3px 6px; text-align: left; vertical-align: top; }
  .room th { background: ${SUNK}; color: ${CHARCOAL}; font-size: 10.5px; border-bottom: 1px solid ${GOLD}; }
  .room th.chk, .room td.chk { width: 17mm; text-align: center; }
  .room.blank { margin-top: 10px; }
  .room.blank td { height: 22px; }
  .reason { color: ${MUTED}; font-size: 9px; margin-top: 2px; }
  .box { display: inline-block; width: 11px; height: 11px; border: 1px solid ${CHARCOAL}; line-height: 10px; font-size: 10px; font-weight: 700; text-align: center; vertical-align: middle; }
  .box.on { color: ${CHARCOAL}; }
  .na { font-weight: 700; font-size: 9px; color: ${MUTED}; }
  .flag { display: block; color: ${STATUS_DANGER}; font-size: 8.5px; font-weight: 700; margin-top: 1px; }
  .block { break-inside: avoid; margin-top: 10px; }
  .block h2, .appendix h2 { font-family: ${HEAD_FONT}; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: ${CHARCOAL}; margin-bottom: 4px; }
  .comments-body { border: 1px solid ${BORDER_STRONG}; min-height: 26mm; padding: 6px 8px; white-space: pre-wrap; line-height: 1.45; }
  .signoff td { border: 1px solid ${BORDER_STRONG}; padding: 6px 8px; vertical-align: top; width: 33.3%; }
  .signoff .lbl { font-weight: 700; display: block; margin-bottom: 4px; }
  .signoff img { max-height: 18mm; max-width: 100%; display: block; }
  .muted { color: ${MUTED}; font-size: 9px; }
  .appendix { margin-top: 12px; break-before: auto; }
  .issues th, .issues td { border: 1px solid ${BORDER_STRONG}; padding: 4px 6px; text-align: left; vertical-align: top; }
  .issues th { background: ${SUNK}; }
  .issues .num { width: 8mm; }
  .issues .desc { width: 40%; white-space: pre-wrap; }
  .foot { margin-top: 10px; border-top: 1px solid ${BORDER_STRONG}; padding-top: 4px; font-family: ${MONO_FONT}; font-size: 8px; color: ${MUTED}; }
</style></head><body>
${watermark}
<div class="content">
  <div class="company">Royal Constructions:</div>
  <h1>${esc(data.checklistTitle)}:</h1>
  <p class="note">Please ensure these items are completed prior to the ${esc(data.checklistNumber === 6 ? "handover" : data.stageLabel.toLowerCase())} inspection.</p>
  ${stateBadge}

  <table class="header">
    <tr><td class="lbl">Project</td><td>${esc(data.projectName)}</td></tr>
    <tr><td class="lbl">Project Address:</td><td>${esc(data.projectAddress)}</td></tr>
    <tr><td class="lbl">House Type:</td><td>${esc(data.houseType)}</td></tr>
    <tr><td class="lbl">Checked and completed by</td><td>${esc(data.checkedBy ?? "")}</td></tr>
  </table>

  ${sections}

  <div class="block">
    <h2>Additional Comments:</h2>
    ${comments}
  </div>

  <div class="block">
    <table class="signoff"><tr>
      <td><span class="lbl">Name of the Reviewer</span>${esc(data.reviewerName)}</td>
      <td><span class="lbl">Signature</span><img src="${esc(data.signatureDataUrl)}" alt="Signature" /></td>
      <td><span class="lbl">Date:</span>${esc(DAY.format(data.signedAt))}</td>
    </tr></table>
  </div>

  ${issues}

  <div class="foot">${esc(
    `${data.projectAddress} | ${data.checklistTitle} (Checklist ${data.checklistNumber}, ${data.stageLabel} stage) | Revision ${data.version} | ${data.final ? "Final" : "Draft"} | Generated ${DAY_TIME.format(data.signedAt)}`,
  )}</div>
</div>
</body></html>`;
}
