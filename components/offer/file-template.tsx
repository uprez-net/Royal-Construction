import { OfferFile } from "@/context/ChatContext";
import { dateFormat } from "@/utils/formatters";

interface OfferFileTemplateProps extends OfferFile {
  ref?: React.Ref<HTMLIFrameElement>;
  customerName?: string;
  projectName?: string;
  proposalDate?: string;
  drawingsDate?: string;
  proposalNumber?: string;
  contractAmount?: string;
}

export function OfferFileTemplate({
  projectDescription,
  paymentTerms,
  termsAndConditions,
  serviceInclusions = [],
  serviceExclusions = [],
  serviceExclusionsFootnote,
  ref,
  customerName = "Client",
  projectName,
  proposalDate = dateFormat.format(new Date()),
  drawingsDate,
  proposalNumber,
  contractAmount = "$X,XXX",
}: OfferFileTemplateProps) {
  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />

<style>
  :root {
    --navy: #1a2f5a;
    --gold: #c6923a;
    --gold-dark: #8b6420;
    --muted: #6b7280;
    --border: #e2e8f0;
    --surface: #fbfaf7;
    --paper: #ffffff;
    --danger: #b45309;
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: "Aptos", "Segoe UI", system-ui, -apple-system, sans-serif;
    background: linear-gradient(180deg, #f5f5f0 0%, #fafaf7 100%);
    color: var(--navy);
    line-height: 1.6;
    min-height: 100vh;
    overflow-y: auto;
    padding: 24px 18px 40px;
  }

  .container {
    width: min(100%, 760px);
    margin: 0 auto;
    padding: 0 0 36px;
    background: var(--paper);
    border: 1px solid rgba(226, 232, 240, 0.9);
    border-radius: 20px;
    box-shadow:
      0 20px 60px rgba(15, 23, 42, 0.09),
      inset 0 1px 0 rgba(255, 255, 255, 0.8);
    overflow: hidden;
  }

  /* ── HEADER ── */
  .rc-header {
    text-align: center;
    padding: 28px 32px 20px;
    border-bottom: 2.5px solid var(--gold);
    background: #fff;
  }

  .rc-company-name {
    font-size: 26px;
    font-weight: 900;
    color: var(--navy);
    letter-spacing: 0.055em;
    font-family: "Arial Black", "Arial", sans-serif;
    text-transform: uppercase;
    line-height: 1.1;
    margin-bottom: 6px;
  }

  .rc-license-line {
    font-size: 11.5px;
    color: var(--gold);
    letter-spacing: 0.04em;
    font-weight: 600;
  }

  /* ── PROPOSAL TITLE BLOCK ── */
  .proposal-title-block {
    text-align: center;
    padding: 32px 40px 28px;
    border-bottom: 1px solid var(--border);
    background: #fff;
  }

  .proposal-type-label {
    font-size: 30px;
    font-weight: 900;
    color: var(--navy);
    letter-spacing: 0.01em;
    font-family: "Arial Black", "Arial", sans-serif;
    text-transform: uppercase;
    margin-bottom: 8px;
    line-height: 1.1;
  }

  .proposal-subtitle-line {
    font-size: 16px;
    font-weight: 700;
    color: var(--gold);
    margin-bottom: 14px;
    letter-spacing: 0.01em;
  }

  .proposal-meta {
    font-size: 13px;
    color: #555;
    line-height: 2;
  }

  .proposal-meta strong {
    font-weight: 700;
    color: var(--navy);
  }

  /* ── BODY SECTIONS ── */
  .body-content {
    padding: 32px 36px 0;
  }

  .section {
    margin-bottom: 26px;
    padding-bottom: 22px;
    border-bottom: 1px solid var(--border);
  }

  .section:last-of-type {
    border-bottom: none;
  }

  .section-title {
    font-size: 17px;
    font-weight: 700;
    margin-bottom: 12px;
    color: var(--gold-dark);
    letter-spacing: 0.01em;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 15px 18px;
    font-size: 14px;
    color: #374151;
    line-height: 1.65;
  }

  ul {
    list-style: none;
  }

  li {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
    align-items: flex-start;
    font-size: 14px;
  }

  li:last-child {
    margin-bottom: 0;
  }

  .check { color: var(--gold); font-weight: bold; }
  .cross { color: var(--danger); font-weight: bold; }
  .dot   { color: var(--navy);  font-weight: bold; }

  .empty {
    color: var(--muted);
    font-style: italic;
    font-size: 14px;
  }

  .service-group-title {
    font-size: 13.5px;
    font-weight: 700;
    margin-bottom: 10px;
    color: var(--navy);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .card + .card {
    margin-top: 12px;
  }

  /* ── ACCEPTANCE SECTION ── */
  .acceptance {
    margin: 0 36px 0;
    padding: 28px 32px 32px;
    border-top: 2px solid var(--navy);
    background: var(--surface);
    border-radius: 0 0 16px 16px;
  }

  .acceptance-title {
    font-size: 22px;
    font-weight: 900;
    color: var(--navy);
    font-family: "Arial Black", "Arial", sans-serif;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    margin-bottom: 10px;
  }

  .acceptance-divider {
    height: 2px;
    background: var(--gold);
    margin-bottom: 18px;
    border-radius: 2px;
  }

  .acceptance-body {
    font-size: 13.5px;
    color: #444;
    line-height: 1.75;
    margin-bottom: 28px;
  }

  .sig-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 36px;
  }

  .sig-label {
    font-size: 13px;
    font-weight: 700;
    color: var(--navy);
    margin-bottom: 2px;
  }

  .sig-sublabel {
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 22px;
  }

  .sig-line {
    border-top: 1px solid #aaa;
    padding-top: 8px;
    font-size: 12px;
    color: var(--muted);
    font-style: italic;
  }
  /* Inclusions — no card, gold group title, bullet list */
  .inclusion-group {
    margin-bottom: 20px;
  }

  .inclusion-group:last-child {
    margin-bottom: 0;
  }

  .inclusion-group-title {
    font-size: 13px;
    font-weight: 800;
    color: var(--gold);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 8px;
  }

  .inclusion-list {
    list-style: none;
    padding-left: 4px;
  }

  .inclusion-list li {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    font-size: 13.5px;
    color: #374151;
    margin-bottom: 6px;
    line-height: 1.55;
  }

  .inclusion-list li::before {
    content: "•";
    color: #374151;
    font-weight: bold;
    flex-shrink: 0;
    margin-top: 1px;
  }

  /* Exclusions — flat X list, no card */
  .exclusion-intro {
    font-size: 13.5px;
    color: #444;
    margin-bottom: 14px;
    line-height: 1.65;
  }

  .exclusion-list {
    list-style: none;
    padding-left: 4px;
    margin-bottom: 16px;
  }

  .exclusion-list li {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    font-size: 13.5px;
    color: #374151;
    margin-bottom: 7px;
    line-height: 1.55;
  }

  .exclusion-x {
    font-weight: 700;
    color: #374151;
    flex-shrink: 0;
    font-size: 13px;
    margin-top: 1px;
  }

  .exclusion-footnote {
    font-size: 12px;
    color: var(--muted);
    font-style: italic;
    line-height: 1.6;
    margin-top: 12px;
  }

  /* Shared: section heading style matching screenshots */
  .section-heading-navy {
    font-size: 18px;
    font-weight: 900;
    color: var(--navy);
    font-family: "Arial Black", "Arial", sans-serif;
    text-transform: uppercase;
    letter-spacing: 0.01em;
    margin-bottom: 10px;
    line-height: 1.2;
  }

  .section-gold-divider {
    height: 1.5px;
    background: var(--gold);
    margin-bottom: 18px;
    border-radius: 1px;
  }
</style>
</head>

<body>
  <div class="container">

    <!-- ── HEADER ── -->
    <header class="rc-header">
      <div class="rc-company-name">Royal Constructions Pty Ltd</div>
      <div class="rc-license-line">
        Licence No. 383992C &nbsp;|&nbsp; NSW Residential Builder &nbsp;|&nbsp; South West Sydney Specialist
      </div>
    </header>

    <!-- ── PROPOSAL TITLE BLOCK ── -->
    <div class="proposal-title-block">
      <div class="proposal-type-label">Building Proposal</div>
      ${
        proposalNumber || projectName
          ? `<div class="proposal-subtitle-line">${[proposalNumber, projectName].filter(Boolean).join(" — ")}</div>`
          : ""
      }
      <div class="proposal-meta">
        <strong>Prepared exclusively for:</strong> ${customerName}<br>
        ${drawingsDate ? `Based on drawings dated ${drawingsDate}<br>` : ""}
        Date: ${proposalDate}
      </div>
    </div>

    <!-- ── BODY SECTIONS ── -->
    <div class="body-content">

      <section class="section">
        <h2 class="section-heading-navy">Project Description</h2>
        <div class="section-gold-divider"></div>
        <div class="card">
          ${
            projectDescription ||
            '<span class="empty">No project description provided.</span>'
          }
        </div>
      </section>

      <section class="section">
        <h2 class="section-heading-navy">What's Included In Your Fixed Price</h2>
        <div class="section-gold-divider"></div>
        <p class="exclusion-intro">
          Every item below is included in your ${contractAmount ? `<strong>${contractAmount}</strong>` : ""} fixed price contract. Nothing on this list costs extra.
        </p>
        ${
          serviceInclusions.length
            ? serviceInclusions.map((group) => `
                <div class="inclusion-group">
                  <div class="inclusion-group-title">${group.sectionTitle}</div>
                  <ul class="inclusion-list">
                    ${group.items.map((item) => `<li>${item}</li>`).join("")}
                  </ul>
                </div>
              `).join("")
            : `<p class="empty">No inclusions specified.</p>`
        }
      </section>

      <section class="section">
        <h2 class="section-heading-navy">Exclusions — Not Included In Contract Price</h2>
        <div class="section-gold-divider"></div>
        <p class="exclusion-intro">
          The following items are outside this contract and are to be arranged and funded by ${customerName}:
        </p>
        ${
          serviceExclusions.length
            ? `<ul class="exclusion-list">
                ${serviceExclusions.map((item) => `
                  <li>
                    <span class="exclusion-x">X</span>
                    <span>${item}</span>
                  </li>
                `).join("")}
              </ul>
              ${serviceExclusionsFootnote
                ? `<p class="exclusion-footnote">${serviceExclusionsFootnote}</p>`
                : ""}
            `
            : `<p class="empty">No exclusions specified.</p>`
        }
      </section>

      <section class="section">
        <h2 class="section-heading-navy">Payment Terms</h2>
        <div class="section-gold-divider"></div>
        <div class="card">
          ${
            paymentTerms ||
            '<span class="empty">Payment terms not provided.</span>'
          }
        </div>
      </section>

      <section class="section">
        <h2 class="section-heading-navy">Terms &amp; Conditions</h2>
        <div class="section-gold-divider"></div>
        <div class="card">
          ${
            termsAndConditions && termsAndConditions.length > 0
              ? `<ul>
                  ${termsAndConditions
                    .map(
                      (item) =>
                        `<li><span class="dot">•</span><span>${item}</span></li>`,
                    )
                    .join("")}
                 </ul>`
              : '<span class="empty">Terms and conditions not provided.</span>'
          }
        </div>
      </section>

    </div>

    <!-- ── ACCEPTANCE / SIGNATURE ── -->
    <div class="acceptance">
      <div class="acceptance-title">Acceptance</div>
      <div class="acceptance-divider"></div>
      <p class="acceptance-body">
        Royal Constructions is committed to delivering <strong>${customerName}</strong>'s
        project to the highest possible standard. We look forward to welcoming you to the
        Royal Constructions family. Please sign and return this proposal along with the
        required deposit to secure your commencement date.
      </p>
      <div class="sig-grid">
        <div>
          <div class="sig-label">For Royal Constructions Pty Ltd:</div>
          <div class="sig-sublabel">Licence No. 383992C</div>
          <div class="sig-line">Authorised Signature / Date</div>
        </div>
        <div>
          <div class="sig-label">Client Acceptance:</div>
          <div class="sig-sublabel">I/We agree to proceed on the terms of this proposal</div>
          <div class="sig-line">${customerName} — Signature / Date</div>
        </div>
      </div>
    </div>

  </div>
</body>
</html>
`;

  return (
    <iframe
      ref={ref}
      title="Offer Preview"
      srcDoc={html}
      className="block h-full min-h-0 w-[50vw] rounded-2xl border border-[#E2E8F0] bg-white shadow-sm"
    />
  );
}
