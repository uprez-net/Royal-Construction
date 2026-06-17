import type { OfferFile } from "@/context/ChatContext";
import { addDays } from "date-fns";
import {
    ACCEPTANCE_BODY,
    COMPANY_INFO,
    NEXT_STEPS,
    PROMOTIONAL_PACKAGE,
    TIMELINE_FOOTNOTE,
    TIMELINE_STAGES,
} from "@/constants/offerFileContent";
import { dateFormat } from "@/utils/formatters";

interface OfferFileTemplateProps extends OfferFile {
    customerName?: string;
    projectName?: string;
    siteLocation?: string;
    proposalDate?: string;
    revisionDate?: string;
    creatorName?: string;
    contractAmount?: string;
}

const escapeHtml = (value: string): string =>
    value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");

const safeText = (value: unknown): string => {
    if (value === null || value === undefined) {
        return "";
    }

    return escapeHtml(String(value));
}

const safeUrl = (value: unknown): string => {
    if (typeof value !== "string" || value.trim() === "") {
        return "";
    }

    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return "";
        }

        return escapeHtml(url.toString());
    } catch {
        return "";
    }
}

const formatMoneyValue = (value: unknown): string => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return "0";
    }

    return safeText(value.toLocaleString());
}
/**
 * Generates a safe HTML offer file for server-side PDF generation.
 * Don't use in client-side contexts as it relies on server-compatible sanitization.
 * @param OfferFileTemplateProps - The properties of the offer file, including content and metadata.
 * @returns HTML Offer File as a string, sanitized for PDF generation on the server.
 */
export const generateSafeOfferHTMLServer = ({
    projectWelcomeMessage,
    facadeOptions,
    termsAndConditions,
    revisionChanges,
    projectScope,
    fixedPriceItems,
    promotionalUpgrades,
    customerName = "Client",
    projectName,
    siteLocation,
    proposalDate = dateFormat.format(new Date()),
    revisionDate,
    creatorName = COMPANY_INFO.director,
    contractAmount = "$X,XXX"
}: OfferFileTemplateProps): string => {
    // Valid-until: proposalDate + 28 days
    const validUntil = (() => {
        try {
            return dateFormat.format(addDays(new Date(proposalDate), 28));
        } catch {
            return "";
        }
    })();
    const safeCustomerName = safeText(customerName);
    const safeCustomerFirstName = safeText(customerName.split(" ")[0] || customerName);
    const safeProjectName = safeText(projectName);
    const safeSiteLocation = safeText(siteLocation);
    const safeRevisionDate = safeText(revisionDate);
    const safeCreatorName = safeText(creatorName);
    const safeCreatorSignatureName = safeText(creatorName.split("—")[0].trim());
    const safeContractAmount = safeText(contractAmount);
    const safeValidUntil = safeText(validUntil);
    const welcomeMarkup = projectWelcomeMessage
        ? safeText(projectWelcomeMessage)
        : '<span class="empty">No welcome message provided.</span>';

    const body = `
    <body>
        <div class="container">

        <!-- ═══════════════════════════════════════════════════ -->
        <!-- COVER PAGE                                          -->
        <!-- ═══════════════════════════════════════════════════ -->
        <div class="cover-page">
            <div class="cover-stars-banner">★ ★ ★ ★ ★</div>

            <div class="cover-company-block">
            <div class="cover-company-name">${safeText(COMPANY_INFO.name)}</div>
            <div class="cover-company-sub">${safeText(COMPANY_INFO.tagline)}</div>
            </div>

            <div class="cover-proposal-type">
            <div class="cover-proposal-heading">Custom Home Proposal</div>
            ${projectName ? `<div class="cover-proposal-subtitle">${safeProjectName}</div>` : ""}

            <table class="cover-meta-table">
                <tr>
                <td class="cover-meta-label">Prepared For</td>
                <td class="cover-meta-value">${safeCustomerName}</td>
                </tr>
                ${siteLocation
            ? `
                <tr>
                <td class="cover-meta-label">Site Address</td>
                <td class="cover-meta-value">${safeSiteLocation}</td>
                </tr>`
            : ""
        }
                ${revisionDate
            ? `<tr>
                        <td class="cover-meta-label">Revised Date</td>
                        <td class="cover-meta-value">${safeRevisionDate}</td>
                    </tr>`
            : ""
        }
                <tr>
                <td class="cover-meta-label">Valid Until</td>
                <td class="cover-meta-value">${safeValidUntil}${safeValidUntil ? " &nbsp;(28 days from original proposal)" : "28 days from original proposal"}</td>
                </tr>
                <tr>
                <td class="cover-meta-label">Prepared By</td>
                <td class="cover-meta-value">${safeCreatorName}</td>
                </tr>
            </table>

            <div class="cover-promo-card">
                <div class="cover-promo-header">
                <span class="star">★</span>&nbsp; Limited-Time Promotion &nbsp;<span class="star">★</span>
                </div>
                <div class="cover-promo-body">
                ${safeText(PROMOTIONAL_PACKAGE.amount)} ${safeText(PROMOTIONAL_PACKAGE.label)}
                </div>
                <div class="cover-promo-sub">Sign before ${safeValidUntil || "the expiry date"} to secure this offer</div>
            </div>

            <div class="cover-footer">
                Lic. No. ${safeText(COMPANY_INFO.licenceNo)} &nbsp;·&nbsp; ${safeText(COMPANY_INFO.accreditation)} &nbsp;·&nbsp; ${safeText(COMPANY_INFO.website)}
            </div>
            </div>
        </div>

        <!-- ═══════════════════════════════════════════════════ -->
        <!-- WELCOME / LETTER                                    -->
        <!-- ═══════════════════════════════════════════════════ -->
        <div class="section-wrap">
            <h2 class="section-heading">Welcome, ${safeCustomerFirstName}</h2>
            <div class="section-gold-rule"></div>

            <div class="welcome-body">
            ${welcomeMarkup}
            </div>

            <div class="welcome-signature-name">${safeCreatorSignatureName}</div>
            <div class="welcome-signature-role">${safeText(COMPANY_INFO.directorRole)}</div>

            ${revisionChanges
            ? `
            <div class="revision-card">
            <div class="revision-card-header">
                Revised Proposal — ${safeRevisionDate} &nbsp;|&nbsp; Changes Agreed in Meeting
            </div>
            <div class="revision-card-desc">${safeText(revisionChanges.description)}</div>
            <div class="revision-card-stats">
                Upgrade value added: $${formatMoneyValue(revisionChanges.valueAdded)}
                &nbsp;|&nbsp;
                Net price increase: $${formatMoneyValue(revisionChanges.valueAdded - revisionChanges.youSave)}
                &nbsp;|&nbsp;
                You save: $${formatMoneyValue(revisionChanges.youSave)}
            </div>
            </div>`
            : ""
        }
        </div>

        <!-- ═══════════════════════════════════════════════════ -->
        <!-- PROJECT SCOPE                                       -->
        <!-- ═══════════════════════════════════════════════════ -->
        <div class="section-wrap">
            <h2 class="section-heading">Project Scope</h2>
            <div class="section-gold-rule"></div>

            ${projectScope && projectScope.length
            ? projectScope
                .map(
                    (group) => `
                <div class="scope-group">
                <div class="scope-group-title">${safeText(group.sectionTitle)}</div>
                <ul class="scope-list">
                    ${group.items
                            .map(
                                (item) => `
                    <li>
                        <span class="scope-star">★</span>
                        <span>${safeText(item)}</span>
                    </li>
                    `,
                            )
                            .join("")}
                </ul>
                </div>
            `,
                )
                .join("")
            : `<p class="empty">No project scope provided.</p>`
        }
        </div>

        <!-- ═══════════════════════════════════════════════════ -->
        <!-- YOUR INVESTMENT                                     -->
        <!-- ═══════════════════════════════════════════════════ -->
        <div class="section-wrap">
            <h2 class="section-heading">Your Investment</h2>
            <div class="section-gold-rule"></div>

            <div class="investment-price-hero">
            <div class="investment-price-label">Indicative Fixed Price</div>
            <div class="investment-price-amount">${safeContractAmount}</div>
            <div class="investment-price-gst">Inclusive of GST</div>
            <div class="investment-price-sub">including ${safeText(PROMOTIONAL_PACKAGE.amount)} promotional upgrade package</div>
            </div>

            <div class="investment-sub-heading">What Your Fixed Price Includes</div>
            
            <table class="fpi-table">
            <thead>
                <tr>
                <th>Item</th>
                <th>Included</th>
                </tr>
            </thead>
            <tbody>
                ${fixedPriceItems && fixedPriceItems.length
            ? fixedPriceItems
                .map(
                    (item) => `
                    <tr>
                    <td>${safeText(item)}</td>
                    <td><span class="fpi-yes">Yes</span></td>
                    </tr>
                `,
                )
                .join("")
            : `<tr><td colspan="2" class="empty" style="padding:14px 16px;">No fixed price items provided.</td></tr>`
        }
            </tbody>
            </table>
        </div>

        <!-- ═══════════════════════════════════════════════════ -->
        <!-- YOUR $50,000 PROMOTIONAL UPGRADE PACKAGE           -->
        <!-- ═══════════════════════════════════════════════════ -->
        <div class="section-wrap">
            <h2 class="section-heading">Your ${safeText(PROMOTIONAL_PACKAGE.amount)} Promotional Upgrade Package</h2>
            <div class="section-gold-rule"></div>

            <p class="promo-intro">
            Every item below is included in your fixed price at no additional cost. This package represents
            ${safeText(PROMOTIONAL_PACKAGE.amount)} of upgrades — agreed and locked in as part of your revised proposal.
            </p>

            <table class="promo-table">
            <thead>
                <tr>
                <th colspan="2">Premium Upgrade Item</th>
                </tr>
            </thead>
            <tbody>
                ${(() => {
            const items =
                promotionalUpgrades && promotionalUpgrades.length
                    ? promotionalUpgrades
                    : [];
            if (items.length === 0) {
                return `<tr><td colspan="2" class="empty" style="padding:14px 16px;">No upgrade items provided.</td></tr>`;
            }
            // Render in two-column pairs, last item spans if odd
            const rows = [];
            for (let i = 0; i < items.length; i += 2) {
                const left = items[i];
                const right = items[i + 1];
                rows.push(`
                    <tr>
                        <td style="width:50%">
                        <span class="promo-item-star">★</span>
                        <span>${safeText(left)}</span>
                        </td>
                        <td style="width:50%">
                        ${right
                        ? `
                        <span class="promo-item-star">★</span>
                        <span>${safeText(right)}</span>
                        `
                        : ""
                    }
                        </td>
                    </tr>
                    `);
            }
            return rows.join("");
        })()}
            </tbody>
            </table>

            <div class="inclusion-credit-card">
            <span class="star">★</span>
            &nbsp;${safeText(PROMOTIONAL_PACKAGE.inclusionCreditAmount)} ${safeText(PROMOTIONAL_PACKAGE.inclusionCreditLabel)}&nbsp;
            <span class="star">★</span>
            </div>
        </div>

        <!-- ═══════════════════════════════════════════════════ -->
        <!-- FAÇADE OPTIONS FOR YOUR CONSIDERATION               -->
        <!-- ═══════════════════════════════════════════════════ -->
        <div class="section-wrap">
            <h2 class="section-heading">Façade Options for Your Consideration</h2>
            <div class="section-gold-rule"></div>

            <p class="facade-intro">${facadeOptions ? safeText(facadeOptions.optionsDescription) : "No façade options available."}</p>

            ${facadeOptions && facadeOptions.options && facadeOptions.options.length > 0
            ? facadeOptions.options
                .map(
                    (option) => {
                        const imageUrl = safeUrl(option.imageUrl);
                        const title = safeText(option.title);

                        return `
                    <div class="facade-option">
                    <div class="facade-option-title">${title}</div>
                    <div class="facade-option-desc">${safeText(option.description)}</div>
                    ${imageUrl ? `<img class="facade-option-img" src="${imageUrl}" alt="${title}" />` : ""}
                    </div>
                    `;
                    },
                )
                .join("")
            : ""
        }
            <p class="empty">Façade images shown for illustrative purposes — final selections, materials and detailing confirmed at the design stage to suit your block at ${safeSiteLocation}.</p>
        </div>

        <!-- ═══════════════════════════════════════════════════ -->
        <!-- INDICATIVE PROJECT TIMELINE                         -->
        <!-- ═══════════════════════════════════════════════════ -->
        <div class="section-wrap">
            <h2 class="section-heading">Indicative Project Timeline</h2>
            <div class="section-gold-rule"></div>

            <table class="timeline-table">
            <thead>
                <tr>
                <th>#</th>
                <th>Stage</th>
                <th>What Happens</th>
                </tr>
            </thead>
            <tbody>
                ${TIMELINE_STAGES.map(
            (s, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td class="stage-name">${safeText(s.stage)}</td>
                    <td>${safeText(s.description)}</td>
                </tr>
                `,
        ).join("")}
            </tbody>
            </table>
            <p class="timeline-footnote">${safeText(TIMELINE_FOOTNOTE)}</p>
        </div>

        <!-- ═══════════════════════════════════════════════════ -->
        <!-- YOUR NEXT STEPS                                     -->
        <!-- ═══════════════════════════════════════════════════ -->
        <div class="section-wrap">
            <h2 class="section-heading">Your Next Steps</h2>
            <div class="section-gold-rule"></div>

            <p class="next-steps-intro">
            We have built this proposal to give you everything you need to make a confident decision.
            To move forward:
            </p>

            <ul class="next-steps-list">
            ${NEXT_STEPS.map(
            (s, i) => `
                <li class="next-step-item">
                <div class="next-step-num">${i + 1}</div>
                <div class="next-step-body">
                    <div class="next-step-title">${safeText(s.title)}</div>
                    <div class="next-step-desc">${safeText(s.description)}</div>
                </div>
                </li>
            `,
        ).join("")}
            </ul>

            <div class="next-steps-cta">
            <div class="next-steps-cta-heading">Ready to Proceed?</div>
            <div class="next-steps-cta-name">${safeText(COMPANY_INFO.director)}, Royal Constructions</div>
            <div class="next-steps-cta-meta">
                www.${safeText(COMPANY_INFO.website)} &nbsp;·&nbsp; Licence No. ${safeText(COMPANY_INFO.licenceNo)} &nbsp;·&nbsp; ${safeText(COMPANY_INFO.accreditation)}
            </div>
            </div>
        </div>

        <!-- ═══════════════════════════════════════════════════ -->
        <!-- IMPORTANT NOTES & TERMS                             -->
        <!-- ═══════════════════════════════════════════════════ -->
        <div class="section-wrap">
            <h2 class="section-heading">Important Notes &amp; Terms</h2>
            <div class="section-gold-rule"></div>

            ${termsAndConditions && termsAndConditions.length > 0
            ? termsAndConditions
                .map(
                    (note) => `
            <div class="notes-item">
                <div class="notes-item-title">${safeText(note.title)}</div>
                <div class="notes-item-body">
                ${safeText(note.description)}
                </div>
            </div>
            `,
                )
                .join("")
            : `<p class="empty">No important notes or terms provided.</p>`
        }
        </div>

        <!-- ═══════════════════════════════════════════════════ -->
        <!-- ACCEPTANCE                                          -->
        <!-- ═══════════════════════════════════════════════════ -->
        <div class="acceptance-wrap">
            <h2 class="section-heading">Acceptance</h2>
            <div class="section-gold-rule"></div>

            <div class="acceptance-card">
            ${ACCEPTANCE_BODY(safeCustomerName, safeSiteLocation)}

            <div class="sig-grid">
                <div>
                <div class="sig-name">${safeCustomerName}</div>
                <div class="sig-sublabel">Client</div>
                <div class="sig-line">Signature</div>
                <div class="sig-line" style="margin-top:20px;">Date</div>
                </div>
                <div>
                <div class="sig-name">${safeText(COMPANY_INFO.director.split("—")[0].trim())}</div>
                <div class="sig-sublabel">${safeText(COMPANY_INFO.directorRole)}</div>
                <div class="sig-line">Authorised Signature</div>
                <div class="sig-line" style="margin-top:20px;">Date</div>
                </div>
            </div>
            </div>
        </div>

        </div>
        </body>
    `

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
            --gold-light: #e8b86d;
            --gold-dark: #8b6420;
            --gold-bg: #fdf8ee;
            --muted: #6b7280;
            --border: #e2e8f0;
            --surface: #fbfaf7;
            --paper: #ffffff;
            --danger: #b45309;
            --green: #166534;
            --green-bg: #dcfce7;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: "Aptos", "Segoe UI", system-ui, -apple-system, sans-serif;
            background: #f0ede6;
            color: var(--navy);
            line-height: 1.6;
            min-height: 100vh;
            overflow-y: auto;
            padding: 24px 18px 40px;
        }

        .container {
            width: min(100%, 780px);
            margin: 0 auto;
            background: var(--paper);
            border: 1px solid rgba(226,232,240,0.9);
            border-radius: 4px;
            box-shadow: 0 8px 40px rgba(15,23,42,0.12);
            overflow: hidden;
        }

        /* ─── COVER PAGE ────────────────────────────────────── */
        .cover-page {
            background: var(--paper);
            padding-bottom: 40px;
        }

        .cover-stars-banner {
            background: var(--navy);
            text-align: center;
            padding: 10px 20px;
            font-size: 18px;
            color: var(--gold);
            letter-spacing: 8px;
        }

        .cover-company-block {
            text-align: center;
            padding: 22px 32px 18px;
            border-bottom: 1.5px solid var(--gold);
        }

        .cover-company-name {
            font-size: 28px;
            font-weight: 900;
            color: var(--navy);
            letter-spacing: 0.1em;
            font-family: "Arial Black", "Arial", sans-serif;
            text-transform: uppercase;
            line-height: 1.1;
            margin-bottom: 6px;
        }

        .cover-company-sub {
            font-size: 12px;
            color: var(--muted);
            letter-spacing: 0.18em;
            text-transform: uppercase;
            font-weight: 500;
        }

        .cover-proposal-type {
            text-align: center;
            padding: 32px 40px 28px;
        }

        .cover-proposal-heading {
            font-size: 26px;
            font-weight: 900;
            color: var(--navy);
            letter-spacing: 0.08em;
            font-family: "Arial Black", "Arial", sans-serif;
            text-transform: uppercase;
            margin-bottom: 6px;
        }

        .cover-proposal-subtitle {
            font-size: 14.5px;
            font-style: italic;
            color: var(--muted);
            margin-bottom: 28px;
        }

        .cover-meta-table {
            width: 100%;
            border-collapse: collapse;
            background: var(--navy);
            border-radius: 6px;
            overflow: hidden;
        }

        .cover-meta-table tr td {
            padding: 10px 20px;
            font-size: 13px;
            vertical-align: middle;
            border-bottom: 1px solid rgba(255,255,255,0.07);
        }

        .cover-meta-table tr:last-child td {
            border-bottom: none;
        }

        .cover-meta-label {
            color: var(--gold);
            font-weight: 700;
            font-size: 11px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            width: 130px;
            white-space: nowrap;
        }

        .cover-meta-value {
            color: #ffffff;
            font-weight: 500;
        }

        .cover-promo-card {
            margin: 28px 40px 0;
            background: var(--gold-bg);
            border: 1.5px solid var(--gold-light);
            border-radius: 6px;
            padding: 18px 24px;
            text-align: center;
        }

        .cover-promo-header {
            font-size: 12.5px;
            font-weight: 800;
            color: var(--gold-dark);
            letter-spacing: 0.06em;
            text-transform: uppercase;
            margin-bottom: 8px;
        }

        .cover-promo-header .star { color: var(--gold); }

        .cover-promo-body {
            font-size: 14.5px;
            font-weight: 900;
            color: var(--navy);
            text-transform: uppercase;
            letter-spacing: 0.02em;
            margin-bottom: 6px;
        }

        .cover-promo-sub {
            font-size: 12px;
            color: var(--muted);
            font-style: italic;
        }

        .cover-footer {
            text-align: center;
            padding: 28px 20px 0;
            font-size: 12px;
            color: var(--muted);
            letter-spacing: 0.04em;
        }

        /* ─── SECTION CHROME ────────────────────────────────── */
        .section-wrap {
            padding: 32px 44px 28px;
            border-bottom: 1px solid var(--border);
        }

        .section-wrap:last-child { border-bottom: none; }

        .section-heading {
            font-size: 17px;
            font-weight: 900;
            color: var(--navy);
            font-family: "Arial Black", "Arial", sans-serif;
            text-transform: uppercase;
            letter-spacing: 0.02em;
            margin-bottom: 8px;
            line-height: 1.2;
        }

        .section-gold-rule {
            height: 1.5px;
            background: var(--gold);
            margin-bottom: 18px;
            border-radius: 1px;
        }

        /* ─── WELCOME / LETTER ──────────────────────────────── */
        .welcome-body {
            font-size: 14px;
            color: #374151;
            line-height: 1.75;
            margin-bottom: 18px;
        }

        .welcome-signature-name {
            font-size: 15px;
            font-weight: 700;
            color: var(--navy);
            margin-top: 22px;
            margin-bottom: 2px;
        }

        .welcome-signature-role {
            font-size: 13px;
            color: var(--muted);
            margin-bottom: 22px;
        }

        /* Revision changes card */
        .revision-card {
            border: 1.5px solid var(--navy);
            border-radius: 6px;
            padding: 16px 20px;
            background: #f8f9fc;
        }

        .revision-card-header {
            font-size: 12px;
            font-weight: 800;
            color: var(--navy);
            text-transform: uppercase;
            letter-spacing: 0.07em;
            margin-bottom: 8px;
        }

        .revision-card-desc {
            font-size: 13.5px;
            color: #374151;
            line-height: 1.65;
            margin-bottom: 10px;
        }

        .revision-card-stats {
            font-size: 13px;
            font-weight: 700;
            color: var(--gold-dark);
        }

        /* ─── PROJECT SCOPE ─────────────────────────────────── */
        .scope-group {
            margin-bottom: 22px;
        }

        .scope-group:last-child { margin-bottom: 0; }

        .scope-group-title {
            font-size: 14px;
            font-weight: 700;
            color: var(--navy);
            margin-bottom: 10px;
        }

        .scope-list {
            list-style: none;
            padding: 0;
        }

        .scope-list li {
            display: flex;
            gap: 10px;
            align-items: flex-start;
            font-size: 13.5px;
            color: #374151;
            margin-bottom: 7px;
            line-height: 1.55;
        }

        .scope-star {
            color: var(--gold);
            font-size: 13px;
            flex-shrink: 0;
            margin-top: 1px;
        }

        /* ─── YOUR INVESTMENT ───────────────────────────────── */
        .investment-price-hero {
            background: var(--navy);
            border-radius: 6px;
            text-align: center;
            padding: 28px 20px;
            margin-bottom: 28px;
        }

        .investment-price-label {
            font-size: 11.5px;
            font-weight: 700;
            color: var(--gold);
            letter-spacing: 0.1em;
            text-transform: uppercase;
            margin-bottom: 8px;
        }

        .investment-price-amount {
            font-size: 52px;
            font-weight: 900;
            color: #ffffff;
            font-family: "Arial Black", "Arial", sans-serif;
            line-height: 1;
            margin-bottom: 8px;
        }

        .investment-price-gst {
            font-size: 12px;
            font-weight: 700;
            color: var(--gold);
            letter-spacing: 0.1em;
            text-transform: uppercase;
            margin-bottom: 6px;
        }

        .investment-price-sub {
            font-size: 12px;
            color: rgba(255,255,255,0.55);
            font-style: italic;
        }

        .investment-sub-heading {
            font-size: 15px;
            font-weight: 700;
            color: var(--navy);
            margin-bottom: 12px;
        }

        .fpi-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13.5px;
        }

        .fpi-table thead tr {
            background: var(--navy);
        }

        .fpi-table thead th {
            padding: 10px 16px;
            color: #ffffff;
            font-weight: 600;
            font-size: 13px;
            text-align: left;
        }

        .fpi-table thead th:last-child {
            text-align: center;
            width: 110px;
        }

        .fpi-table tbody tr:nth-child(odd) {
            background: #f9fafb;
        }

        .fpi-table tbody tr:nth-child(even) {
            background: #ffffff;
        }

        .fpi-table tbody td {
            padding: 9px 16px;
            color: #374151;
            border-bottom: 1px solid #f0f0f0;
        }

        .fpi-table tbody td:last-child {
            text-align: center;
        }

        .fpi-yes {
            font-weight: 700;
            color: var(--green);
            background: var(--green-bg);
            padding: 2px 10px;
            border-radius: 4px;
            font-size: 12.5px;
            display: inline-block;
        }

        /* ─── PROMOTIONAL UPGRADES ──────────────────────────── */
        .promo-intro {
            font-size: 13.5px;
            color: #374151;
            line-height: 1.7;
            margin-bottom: 18px;
        }

        .promo-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
            margin-bottom: 22px;
        }

        .promo-table thead tr {
            background: var(--navy);
        }

        .promo-table thead th {
            padding: 10px 16px;
            color: #ffffff;
            font-weight: 600;
            text-align: left;
            font-size: 13px;
        }

        .promo-table tbody tr:nth-child(odd) {
            background: #f9fafb;
        }

        .promo-table tbody tr:nth-child(even) {
            background: #ffffff;
        }

        .promo-table tbody td {
            padding: 9px 14px;
            color: #374151;
            vertical-align: top;
            border-bottom: 1px solid #f0f0f0;
            line-height: 1.55;
        }

        .promo-item-star {
            color: var(--gold);
            margin-right: 6px;
            font-size: 12px;
        }

        .promo-highlight-row td {
            background: #fffbeb !important;
        }

        .promo-highlight-text {
            background: #fef08a;
            padding: 1px 3px;
            border-radius: 2px;
        }

        .inclusion-credit-card {
            background: var(--gold-bg);
            border: 1.5px solid var(--gold-light);
            border-radius: 6px;
            padding: 14px 20px;
            text-align: center;
            font-size: 13.5px;
            font-weight: 700;
            color: var(--navy);
        }

        .inclusion-credit-card .star { color: var(--gold); }

        /* ─── FAÇADE OPTIONS ────────────────────────────────── */
        .facade-intro {
            font-size: 13.5px;
            color: #374151;
            line-height: 1.7;
            margin-bottom: 28px;
        }
        
        .facade-option {
            margin-bottom: 36px;
        }
        
        .facade-option:last-child {
            margin-bottom: 0;
        }
        
        .facade-option-title {
            font-size: 15px;
            font-weight: 700;
            color: var(--navy);
            margin-bottom: 6px;
        }
        
        .facade-option-desc {
            font-size: 13.5px;
            font-style: italic;
            color: #374151;
            line-height: 1.65;
            margin-bottom: 16px;
        }
        
        .facade-option-img {
            width: 100%;
            border-radius: 6px;
            display: block;
            object-fit: cover;
            max-height: 420px;
        }

        /* ─── TIMELINE ──────────────────────────────────────── */
        .timeline-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13.5px;
        }

        .timeline-table thead tr {
            background: var(--navy);
        }

        .timeline-table thead th {
            padding: 10px 16px;
            color: #ffffff;
            font-weight: 600;
            text-align: left;
            font-size: 13px;
        }

        .timeline-table thead th:first-child {
            width: 36px;
            text-align: center;
        }

        .timeline-table tbody tr:nth-child(odd) {
            background: #f9fafb;
        }

        .timeline-table tbody tr:nth-child(even) {
            background: #ffffff;
        }

        .timeline-table tbody td {
            padding: 10px 16px;
            color: #374151;
            border-bottom: 1px solid #f0f0f0;
            vertical-align: top;
            line-height: 1.55;
        }

        .timeline-table tbody td:first-child {
            text-align: center;
            color: var(--muted);
            font-weight: 700;
            font-size: 13px;
        }

        .timeline-table tbody td.stage-name {
            font-weight: 700;
            color: var(--navy);
            width: 200px;
        }

        .timeline-footnote {
            font-size: 12px;
            color: var(--muted);
            font-style: italic;
            margin-top: 14px;
            line-height: 1.6;
        }

        /* ─── NEXT STEPS ────────────────────────────────────── */
        .next-steps-intro {
            font-size: 13.5px;
            color: #374151;
            line-height: 1.7;
            margin-bottom: 20px;
        }

        .next-steps-list {
            list-style: none;
            margin-bottom: 28px;
        }

        .next-step-item {
            display: flex;
            gap: 0;
            margin-bottom: 1px;
            border: 1px solid var(--border);
            border-radius: 0;
            overflow: hidden;
        }

        .next-step-item:first-child { border-radius: 6px 6px 0 0; }
        .next-step-item:last-child { border-radius: 0 0 6px 6px; }

        .next-step-num {
            background: var(--gold);
            color: #fff;
            font-size: 16px;
            font-weight: 900;
            width: 48px;
            min-width: 48px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: "Arial Black", "Arial", sans-serif;
        }

        .next-step-body {
            padding: 14px 18px;
            flex: 1;
            background: #fff;
        }

        .next-step-title {
            font-size: 14px;
            font-weight: 700;
            color: var(--navy);
            margin-bottom: 4px;
        }

        .next-step-desc {
            font-size: 13px;
            color: #374151;
            line-height: 1.6;
        }

        .next-steps-cta {
            background: var(--navy);
            border-radius: 6px;
            text-align: center;
            padding: 20px 24px;
        }

        .next-steps-cta-heading {
            font-size: 14px;
            font-weight: 800;
            color: var(--gold);
            letter-spacing: 0.06em;
            text-transform: uppercase;
            margin-bottom: 6px;
        }

        .next-steps-cta-name {
            font-size: 15px;
            font-weight: 700;
            color: #ffffff;
            margin-bottom: 6px;
        }

        .next-steps-cta-meta {
            font-size: 12px;
            color: var(--gold-light);
            letter-spacing: 0.04em;
        }

        /* ─── NOTES & TERMS ─────────────────────────────────── */
        .notes-item {
            margin-bottom: 20px;
        }

        .notes-item:last-child { margin-bottom: 0; }

        .notes-item-title {
            font-size: 14px;
            font-weight: 700;
            color: var(--navy);
            margin-bottom: 6px;
        }

        .notes-item-title.highlight-title {
            background: #fef08a;
            display: inline-block;
            padding: 0 3px;
        }

        .notes-item-body {
            font-size: 13.5px;
            color: #374151;
            line-height: 1.7;
        }

        .notes-highlight-body {
            background: #fef08a;
            padding: 2px 3px;
            border-radius: 2px;
        }

        /* ─── ACCEPTANCE ─────────────────────────────────────── */
        .acceptance-wrap {
            padding: 32px 44px 40px;
        }

        .acceptance-card {
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 24px 28px;
            margin-bottom: 32px;
            font-size: 13.5px;
            color: #374151;
            line-height: 1.7;
        }

        .sig-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 40px;
            margin-top: 28px;
        }

        .sig-name {
            font-size: 16px;
            font-weight: 700;
            color: var(--navy);
            margin-bottom: 2px;
        }

        .sig-line {
            border-top: 1px solid #aaa;
            margin-top: 36px;
            padding-top: 6px;
            font-size: 12px;
            color: var(--muted);
            font-style: italic;
        }

        .sig-sublabel {
            font-size: 12px;
            color: var(--muted);
            margin-top: 2px;
        }

        /* ─── PAYMENT TERMS & T&C (kept from original) ─────── */
        .card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 15px 18px;
            font-size: 14px;
            color: #374151;
            line-height: 1.65;
        }

        ul.tc-list { list-style: none; }

        ul.tc-list li {
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
            align-items: flex-start;
            font-size: 14px;
        }

        .dot { color: var(--navy); font-weight: bold; }

        .empty {
            color: var(--muted);
            font-style: italic;
            font-size: 14px;
        }
        
        @media print {
            p,
            li,
            table,
            tr,
            td,
            section,
            article,
            .keep-together {
            break-inside: avoid;
            page-break-inside: avoid;
            }

            h1, h2, h3, h4, h5, h6 {
            break-after: avoid;
            page-break-after: avoid;
            }

            /* Cover page always ends on its own page */
            .cover-page {
            break-after: page;
            page-break-after: always;
            }

            /* Keep heading + rule + first content together */
            .section-gold-rule {
            break-after: avoid;
            page-break-after: avoid;
            }

            /* Keep every logical block intact */
            .section-wrap,
            .scope-group,
            .notes-item,
            .revision-card,
            .acceptance-card,
            .next-step-item,
            .investment-price-hero,
            .cover-promo-card,
            .inclusion-credit-card,
            .next-steps-cta,
            .promo-intro,
            .timeline-footnote {
            break-inside: avoid;
            page-break-inside: avoid;
            }
        }
        </style>
        </head>
        ${body}
        </html>`;

    return html;
}
