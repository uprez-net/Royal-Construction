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
    --primary: #111827;
    --muted: #6b7280;
    --border: #e5e7eb;
    --surface: #f8fafc;
    --success: #16a34a;
    --danger: #dc2626;
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family:
      Inter,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      sans-serif;
    background: white;
    color: var(--primary);
    line-height: 1.7;
  }

  .container {
    max-width: 900px;
    margin: auto;
    padding: 48px;
  }

  .header {
    margin-bottom: 48px;
  }

  .badge {
    display: inline-block;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 6px 12px;
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 16px;
  }

  .title {
    font-size: 42px;
    font-weight: 700;
    margin-bottom: 8px;
  }

  .subtitle {
    color: var(--muted);
  }

  .section {
    margin-bottom: 36px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--border);
  }

  .section:last-child {
    border-bottom: none;
  }

  .section-title {
    font-size: 20px;
    font-weight: 600;
    margin-bottom: 16px;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
  }

  ul {
    list-style: none;
  }

  li {
    display: flex;
    gap: 10px;
    margin-bottom: 10px;
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
    margin-top: 48px;
    padding-top: 24px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 14px;
  }

  .signature {
    margin-top: 60px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 48px;
  }

  .signature-line {
    border-top: 1px solid var(--primary);
    padding-top: 8px;
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
      className="block h-full min-h-0 w-full rounded-xl border bg-white"
    />
  );
}
