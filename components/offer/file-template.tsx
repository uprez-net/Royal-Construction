import { OfferFile } from "@/context/ChatContext";

export function OfferFileTemplate({
  projectDescription,
  paymentTerms,
  termsAndConditions,
  serviceInclusions = [],
  serviceExclusions = [],
}: OfferFile) {
  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />

<style>
  :root {
    --primary: #0f172a;
    --muted: #64748b;
    --border: #dbe4ee;
    --surface: #f8fafc;
    --paper: #ffffff;
    --success: #0f9d7a;
    --danger: #d14343;
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: "Aptos", "Segoe UI", system-ui, -apple-system, sans-serif;
    background:
      radial-gradient(circle at top, rgba(13, 148, 136, 0.08), transparent 30%),
      linear-gradient(180deg, #eef3f8 0%, #f8fafc 100%);
    color: var(--primary);
    line-height: 1.6;
    min-height: 100vh;
    overflow-y: auto;
    padding: 24px 18px 28px;
  }

  .container {
    width: min(100%, 760px);
    margin: 0 auto;
    padding: 32px 28px 36px;
    background: var(--paper);
    border: 1px solid rgba(148, 163, 184, 0.28);
    border-radius: 24px;
    box-shadow:
      0 20px 60px rgba(15, 23, 42, 0.08),
      inset 0 1px 0 rgba(255, 255, 255, 0.8);
  }

  .header {
    margin-bottom: 28px;
  }

  .badge {
    display: inline-block;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 5px 11px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 14px;
  }

  .title {
    font-size: 34px;
    line-height: 1.08;
    font-weight: 700;
    letter-spacing: -0.03em;
    margin-bottom: 10px;
  }

  .subtitle {
    color: var(--muted);
    font-size: 15px;
  }

  .section {
    margin-bottom: 26px;
    padding-bottom: 22px;
    border-bottom: 1px solid var(--border);
  }

  .section:last-child {
    border-bottom: none;
  }

  .section-title {
    font-size: 17px;
    font-weight: 700;
    margin-bottom: 12px;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 16px 18px;
  }

  ul {
    list-style: none;
  }

  li {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
    align-items: flex-start;
  }

  .check {
    color: var(--success);
    font-weight: bold;
  }

  .cross {
    color: var(--danger);
    font-weight: bold;
  }

  .empty {
    color: var(--muted);
    font-style: italic;
  }

  .footer {
    margin-top: 30px;
    padding-top: 18px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 12px;
  }

  .signature {
    margin-top: 36px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 28px;
  }

  .signature-line {
    border-top: 1px solid var(--primary);
    padding-top: 10px;
    font-size: 13px;
  }
</style>
</head>

<body>
  <div class="container">

    <div class="header">
      <div class="badge">PROJECT PROPOSAL</div>

      <h1 class="title">
        Service Offer
      </h1>

      <p class="subtitle">
        Professional project proposal and scope document
      </p>
    </div>

    <section class="section">
      <h2 class="section-title">Project Description</h2>

      <div class="card">
        ${
          projectDescription ||
          '<span class="empty">No project description provided.</span>'
        }
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">Service Inclusions</h2>

      ${
        serviceInclusions.length
          ? `
          <ul>
            ${serviceInclusions
              .map(
                (item) =>
                  `<li><span class="check">✓</span><span>${item}</span></li>`,
              )
              .join("")}
          </ul>
        `
          : `<p class="empty">No inclusions specified.</p>`
      }
    </section>

    <section class="section">
      <h2 class="section-title">Service Exclusions</h2>

      ${
        serviceExclusions.length
          ? `
          <ul>
            ${serviceExclusions
              .map(
                (item) =>
                  `<li><span class="cross">✕</span><span>${item}</span></li>`,
              )
              .join("")}
          </ul>
        `
          : `<p class="empty">No exclusions specified.</p>`
      }
    </section>

    <section class="section">
      <h2 class="section-title">Payment Terms</h2>

      <div class="card">
        ${
          paymentTerms ||
          '<span class="empty">Payment terms not provided.</span>'
        }
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">Terms & Conditions</h2>

      <div class="card">
        ${
          termsAndConditions ||
          '<span class="empty">Terms and conditions not provided.</span>'
        }
      </div>
    </section>

    <div class="signature">
      <div>
        <div class="signature-line">
          Client Signature
        </div>
      </div>

      <div>
        <div class="signature-line">
          Service Provider Signature
        </div>
      </div>
    </div>

    <div class="footer">
      This document serves as a proposal outlining the project scope,
      deliverables, payment structure, and agreed terms.
    </div>

  </div>
</body>
</html>
`;

  return (
    <iframe
      title="Offer Preview"
      srcDoc={html}
      className="block h-full min-h-0 w-[50vw] rounded-2xl border border-slate-200/60 bg-white shadow-sm"
    />
  );
}
