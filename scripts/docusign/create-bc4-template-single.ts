/**
 * Create (or recreate) the DocuSign template for the MBA BC4 (March 2025)
 * building Contract from the clean blank PDF.
 *
 *   pnpm exec tsx scripts/docusign/create-bc4-template.ts <path-to-blank-BC4.pdf>
 *
 * The MBA webform export embeds its merge-field tokens as invisible text at
 * every fill position (e.g. `contract_price_value`, `site_address_value`),
 * so every tab here AutoPlaces onto those anchors — no manual coordinates.
 * One anchored tab definition lands on EVERY occurrence of its token, which
 * is exactly right for values printed in several places (contract price on
 * pages i+ii, bank details on pages iii+vi).
 *
 * Roles (customer-first, issue #98): `Owner` (routingOrder 1 — the primary
 * authorised signatory, signs FIRST) and `Builder` (routingOrder 2 —
 * counter-signs to execute). EVERY value printed on the contract is a tab on
 * the Owner role: the values our send action fills from the signed Tender + the
 * estimator's BC4 particulars, the builder-identity constants, and the
 * pre-ticked Schedule 1 checklist — all locked/read-only for the owner. A
 * locked tab with a value renders read-only to its own recipient, so the
 * customer sees the complete contract the instant they open it, independent of
 * routing order or the "write initial value for all recipients" account
 * setting. The Builder role carries only its signature.
 *
 * Why not leave the data on the Builder role? Because with customer-first
 * routing the Builder signs SECOND, and DocuSign does not show a later
 * recipient's field values to an earlier signer by default — the customer would
 * open a blank contract (verified on a real envelope). Assigning the data to
 * the first signer is the DocuSign-native fix.
 *
 * Prints the created template id and writes it to .env's
 * DOCUSIGN_CONTRACT_TEMPLATE_ID if the variable is present but empty.
 */
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import docusign from "docusign-esign";
import { getDocusignConfig } from "@/lib/docusign/config";
import { createDocusignContext } from "@/lib/docusign/client";

const BUILDER_STATICS = {
  businessName: "Royal Constructions Pty Ltd",
  address: "Unit 3, 36 Turner Road, SMEATON GRANGE NSW 2567",
  telephone: "0246600655",
  mobile: "0406555565",
  email: "admin@royalconstructions.com.au",
  licenceNo: "383992C",
  abn: "56644111580",
  bankAccountName: "Royal Constructions Pty Ltd",
  bankBsb: "012514",
  bankAccountNumber: "476285531",
};

type TextTabOptions = {
  readonly value?: string;
  readonly locked?: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly fontSize?: string;
  readonly yOffset?: number;
  readonly xOffset?: number;
};

function textTab(
  anchor: string,
  tabLabel: string,
  opts: TextTabOptions = {},
): docusign.Text {
  return {
    anchorString: anchor,
    anchorUnits: "pixels",
    anchorXOffset: String(opts.xOffset ?? 0),
    anchorYOffset: String(opts.yOffset ?? -3),
    anchorCaseSensitive: "true",
    anchorIgnoreIfNotPresent: "true",
    tabLabel,
    value: opts.value ?? "",
    locked: opts.locked ? "true" : "false",
    required: "false",
    width: String(opts.width ?? 220),
    height: String(opts.height ?? 12),
    fontSize: opts.fontSize ?? "size9",
  } as docusign.Text;
}

// Checkbox offsets calibrated visually against the printed boxes: tokens on
// Schedule 1 / the owner acknowledgment sit inline with their row, while the
// page ii + Schedule 3 tokens sit a few points above theirs.
function checkboxTab(
  anchor: string,
  tabLabel: string,
  opts: { selected?: boolean; locked?: boolean; yOffset?: number } = {},
): docusign.Checkbox {
  return {
    anchorString: anchor,
    anchorUnits: "pixels",
    anchorXOffset: "-6",
    anchorYOffset: String(opts.yOffset ?? 5),
    anchorCaseSensitive: "true",
    anchorIgnoreIfNotPresent: "true",
    tabLabel,
    selected: opts.selected ? "true" : "false",
    locked: opts.locked ? "true" : "false",
  } as docusign.Checkbox;
}

function signHereTab(anchor: string): docusign.SignHere {
  return {
    anchorString: anchor,
    anchorUnits: "pixels",
    anchorXOffset: "0",
    anchorYOffset: "-8",
    anchorIgnoreIfNotPresent: "true",
  } as docusign.SignHere;
}

function dateSignedTab(anchor: string): docusign.DateSigned {
  return {
    anchorString: anchor,
    anchorUnits: "pixels",
    anchorXOffset: "0",
    anchorYOffset: "-3",
    anchorIgnoreIfNotPresent: "true",
    fontSize: "size9",
  } as docusign.DateSigned;
}

// Schedule 1 statutory checklist — all "Yes", pre-ticked and locked.
const SCHEDULE1_YES_TOKENS = [
  "current_license_yes_value",
  "license_covers_type_of_work_yes_value",
  "license_matches_contract_yes_value",
  "work_covered_in_contract_drawings_and_specification_yes_value",
  "contract_price_stated_or_clearly_not_known_yes_value",
  "warning_about_contract_price_variations_yes_value",
  "aware_of_cooling_off_provisions_yes_value",
  "deposit_10_percent_or_less_yes_value",
  "progress_payments_specified_yes_value",
  "variation_procedure_yes_value",
  "obtainer_of_approval_yes_value",
  "registered_certifier_selection_required_yes_value",
  "no_payment_until_certificate_of_insurance_yes_value",
  "includes_cost_of_insurance_or_alternative_yes_value",
  "consumer_building_guide_provided_yes_value",
  "termination_circumstances_included_yes_value",
  "security_of_payment_guide_included_yes_value",
];

// The Builder counter-signs (routingOrder 2) — all contract DATA now lives on
// the Owner role (the first signer), so the customer opens a complete contract.
function builderTabs(): docusign.Tabs {
  return {
    signHereTabs: [signHereTab("signed_by_builder_value")],
  } as docusign.Tabs;
}

// The Owner signs FIRST (routingOrder 1). Every value on the contract is a tab
// on THIS recipient so the customer sees it read-only the moment they open the
// envelope (see the file header for why). Three groups:
//  1. Filled from the signed Tender + particulars at envelope time — defined
//     empty here; the send action supplies value + locked=true by tabLabel.
//     The estimator's BC4 particulars are marked locked here too, so a
//     particular left blank stays read-only rather than an editable box the
//     customer could type into.
//  2. Builder-identity constants — locked, baked into the template.
//  3. The owner's OWN fields (signatures, agreement date, acknowledgment) —
//     unlocked, completed by the owner during signing.
function ownerTabs(): docusign.Tabs {
  const locked = { locked: true };
  return {
    signHereTabs: [
      signHereTab("signed_by_owners_value"),
      signHereTab("acknowledgement_of_owner_docusign_0_signature_value"),
    ],
    dateSignedTabs: [
      dateSignedTab("acknowledgement_of_owner_docusign_0_date_value"),
    ],
    textTabs: [
      // ── 1a. Derived from the signed Tender (send fills value + locks) ──
      textTab("contract_price_value", "contractPrice", { width: 160 }),
      textTab("total_value", "contractPriceTotal", { width: 160 }),
      textTab("owners_0_owner_name_value", "ownerNames", { width: 380 }),
      textTab("owners_0_owner_email_value", "ownerEmail", { width: 300 }),
      textTab("site_address_value", "siteAddress", { width: 440 }),
      textTab("percentage_allowed_on_variations_value", "variationPercent", {
        width: 100,
      }),
      textTab("installments_0_installment_item_value", "paymentSchedule", {
        width: 470,
        height: 22,
        fontSize: "size7",
      }),
      textTab("deposit_value", "depositAmount", { width: 140 }),
      textTab("days_not_included_value", "excludedDays", {
        width: 170,
        height: 24,
        fontSize: "size8",
      }),
      textTab("defects_liability_period_value", "defectsLiabilityWeeks", {
        width: 120,
      }),
      textTab(
        "description_of_the_work_to_be_completed_value",
        "workDescription",
        {
          width: 480,
          height: 24,
          fontSize: "size8",
        },
      ),
      textTab("exclusions_value", "exclusionsList", {
        width: 490,
        height: 90,
        fontSize: "size8",
      }),
      // ── 1b. Estimator's BC4 particulars (issue #98) — locked; blank ones stay
      //        read-only. The send fills the ones the estimator entered. ──
      textTab("owners_0_owner_address_value", "ownerAddress", {
        ...locked,
        width: 380,
      }),
      textTab("owners_0_owner_telephone_value", "ownerPhone", {
        ...locked,
        width: 120,
      }),
      textTab("owners_0_owner_mobile_value", "ownerMobile", {
        ...locked,
        width: 160,
      }),
      textTab("funding_lending_authority_value", "lendingAuthority", {
        ...locked,
        width: 200,
      }),
      textTab("funding_owner_value", "fundingOwner", { ...locked, width: 200 }),
      textTab(
        "home_building_compensation_fund_insurance_cover_amount_value",
        "hbcfCost",
        { ...locked, width: 120 },
      ),
      textTab("terms_for_claims_value", "paymentDays", {
        ...locked,
        width: 60,
      }),
      textTab("interest_rate_on_late_payments_value", "interestRate", {
        ...locked,
        width: 60,
      }),
      textTab("proposed_commencement_value", "commencementDate", {
        ...locked,
        width: 150,
      }),
      textTab("construction_period_value", "constructionDays", {
        ...locked,
        width: 100,
      }),
      textTab("demolition_materials_value", "demolitionMaterials", {
        ...locked,
        width: 480,
        height: 30,
        fontSize: "size8",
      }),
      textTab("pre_contract_costs_value", "preContractCosts", {
        ...locked,
        width: 140,
      }),
      textTab("special_conditions_value", "specialConditions", {
        ...locked,
        width: 500,
        height: 200,
        fontSize: "size8",
      }),
      // ── 2. Builder identity: locked constants baked into the template ──
      textTab("business_name_value", "builderName", {
        value: BUILDER_STATICS.businessName,
        ...locked,
        width: 300,
      }),
      textTab("builder_address_value", "builderAddress", {
        value: BUILDER_STATICS.address,
        ...locked,
        width: 380,
      }),
      textTab("builder_telephone_value", "builderPhone", {
        value: BUILDER_STATICS.telephone,
        ...locked,
        width: 120,
      }),
      textTab("builder_mobile_value", "builderMobile", {
        value: BUILDER_STATICS.mobile,
        ...locked,
        width: 160,
      }),
      textTab("builder_email_value", "builderEmail", {
        value: BUILDER_STATICS.email,
        ...locked,
        width: 300,
      }),
      textTab("builder_licence_no_value", "builderLicenceNo", {
        value: BUILDER_STATICS.licenceNo,
        ...locked,
        width: 150,
      }),
      textTab("builder_abn_no_value", "builderAbn", {
        value: BUILDER_STATICS.abn,
        ...locked,
        width: 150,
      }),
      textTab("builder_bank_account_name_value", "builderBankName", {
        value: BUILDER_STATICS.bankAccountName,
        ...locked,
        width: 300,
      }),
      textTab("builder_bank_account_bsb_value", "builderBankBsb", {
        value: BUILDER_STATICS.bankBsb,
        ...locked,
        width: 120,
      }),
      textTab("builder_bank_account_number_value", "builderBankNumber", {
        value: BUILDER_STATICS.bankAccountNumber,
        ...locked,
        width: 160,
      }),
      // ── 3. Owner's own agreement/acknowledgment fields (owner completes) ──
      textTab("signed_date_value", "signedDay", { width: 40 }),
      textTab("signed_month_value", "signedMonth", { width: 100 }),
      textTab("signed_year_value", "signedYear", { width: 40 }),
      textTab(
        "acknowledgement_of_owner_docusign_0_name_value",
        "ownerPrintName",
        { width: 220 },
      ),
      textTab(
        "acknowledgement_of_owner_docusign_0_capacity_value",
        "ownerCapacity",
        { width: 220 },
      ),
    ],
    checkboxTabs: [
      // Derived contract terms — value set by the send action, LOCKED so the
      // customer can't toggle them before signing (defined here + at send time).
      checkboxTab("contract_price_gst_Inclusive of GST_value", "gstInclusive", {
        yOffset: 8,
        locked: true,
      }),
      checkboxTab("included_in_the_contract_price__Yes_value", "hbcfIncluded", {
        yOffset: 8,
        locked: true,
      }),
      checkboxTab("_b_exclusions_Yes_value", "exclusionsYes", {
        yOffset: 8,
        locked: true,
      }),
      // Schedule 1 statutory checklist — pre-ticked + locked constants.
      ...SCHEDULE1_YES_TOKENS.map((token, index) =>
        checkboxTab(token, `sch1Yes${index + 1}`, {
          selected: true,
          locked: true,
        }),
      ),
      // Owner's own acknowledgment ticks (owner completes these).
      checkboxTab(
        "acknowledgement_of_owner_consumer_building_guide_value",
        "ownerAckGuide",
      ),
      checkboxTab(
        "acknowledgement_of_owner_checklist_all_yes_value",
        "ownerAckChecklist",
      ),
    ],
  } as docusign.Tabs;
}

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath || !existsSync(pdfPath)) {
    console.error(
      "Usage: tsx scripts/docusign/create-bc4-template-single.ts <blank-BC4.pdf>",
    );
    process.exit(1);
  }
  const pdfBase64 = readFileSync(pdfPath).toString("base64");

  const config = getDocusignConfig();
  const context = await createDocusignContext(config);
  const templatesApi = new docusign.TemplatesApi(context.apiClient);

  const envelopeTemplate: docusign.EnvelopeTemplate = {
    name: "MBA BC4 Residential Building Contract (Mar 2025) — Royal Constructions",
    description:
      "Head contract sent from the offer workflow once the Tender is signed. "
      + "Tabs AutoPlace onto the MBA webform's embedded merge tokens; created by "
      + "scripts/docusign/create-bc4-template.ts — edit that script, not this template.",
    emailSubject: "Residential Building Contract (BC4) — Royal Constructions",
    shared: "false",
    status: "created",
    documents: [
      {
        documentBase64: pdfBase64,
        name: "MBA_BC4_Contract_vMar2025.pdf",
        fileExtension: "pdf",
        documentId: "1",
      },
    ],
    recipients: {
      // Customer-first (issue #98): the Owner signs first (routingOrder 1) and
      // carries all the contract data; the Builder counter-signs (routingOrder
      // 2). recipientIds are unchanged so the send action + Connect webhook keep
      // matching Builder=1 / Owner=2 by id.
      signers: [
        {
          roleName: "Builder",
          recipientId: "1",
          routingOrder: "2",
          tabs: builderTabs(),
        },
        {
          roleName: "Owner",
          recipientId: "2",
          routingOrder: "1",
          tabs: ownerTabs(),
        },
      ],
    },
  };

  const result = await templatesApi.createTemplate(context.accountId, {
    envelopeTemplate,
  });
  const templateId = result.templateId;
  if (!templateId) {
    throw new Error("DocuSign did not return a template id.");
  }
  console.log("Template created:", templateId);

  if (existsSync(".env")) {
    const env = readFileSync(".env", "utf8");
    if (/^DOCUSIGN_CONTRACT_TEMPLATE_ID=.*$/m.test(env)) {
      writeFileSync(
        ".env",
        env.replace(
          /^DOCUSIGN_CONTRACT_TEMPLATE_ID=.*$/m,
          `DOCUSIGN_CONTRACT_TEMPLATE_ID=${templateId}`,
        ),
      );
      console.log(".env updated with DOCUSIGN_CONTRACT_TEMPLATE_ID");
    } else {
      console.log(`Set DOCUSIGN_CONTRACT_TEMPLATE_ID=${templateId} in .env`);
    }
  }
  process.exit(0);
}

void main().catch((error) => {
  const body = (error as { response?: { body?: unknown } }).response?.body;
  console.error(
    "FAILED:",
    (error as Error).message,
    body ? JSON.stringify(body) : "",
  );
  process.exit(1);
});
