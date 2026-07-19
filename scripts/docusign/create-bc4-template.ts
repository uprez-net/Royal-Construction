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
 * Roles: `Builder` (routing 1 — reviews and completes any open particulars
 * while signing) and `Owner` (routing 2, the primary/authorised signatory).
 * Values our send action derives from the signed Tender arrive locked at
 * envelope time (lib/data/offer-contract-sign.ts fills by tabLabel); builder
 * identity and other constants are locked defaults baked into the template.
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
  address: "Unit 38, 62 Turner Road, SMEATON GRANGE NSW 2567",
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

function builderTabs(): docusign.Tabs {
  const locked = { locked: true };
  return {
    signHereTabs: [signHereTab("signed_by_builder_value")],
    textTabs: [
      // ── Filled from the signed Tender at envelope time (locked there) ──
      textTab("contract_price_value", "contractPrice", { width: 160 }),
      textTab("total_value", "contractPriceTotal", { width: 160 }),
      textTab("owners_0_owner_name_value", "ownerNames", { width: 380 }),
      textTab("owners_0_owner_address_value", "ownerAddress", { width: 380 }),
      textTab("owners_0_owner_telephone_value", "ownerPhone", { width: 120 }),
      textTab("owners_0_owner_mobile_value", "ownerMobile", { width: 160 }),
      textTab("owners_0_owner_email_value", "ownerEmail", { width: 300 }),
      textTab("site_address_value", "siteAddress", { width: 440 }),
      textTab("funding_lending_authority_value", "lendingAuthority", { width: 200 }),
      textTab("funding_owner_value", "fundingOwner", { width: 200 }),
      textTab("home_building_compensation_fund_insurance_cover_amount_value", "hbcfCost", { width: 120 }),
      textTab("percentage_allowed_on_variations_value", "variationPercent", { width: 100 }),
      textTab("installments_0_installment_item_value", "paymentSchedule", {
        width: 470, height: 22, fontSize: "size7",
      }),
      textTab("deposit_value", "depositAmount", { width: 140 }),
      textTab("terms_for_claims_value", "paymentDays", { width: 60 }),
      textTab("interest_rate_on_late_payments_value", "interestRate", { width: 60 }),
      textTab("proposed_commencement_value", "commencementDate", { width: 150 }),
      textTab("construction_period_value", "constructionDays", { width: 100 }),
      textTab("days_not_included_value", "excludedDays", { width: 170, height: 24, fontSize: "size8" }),
      textTab("demolition_materials_value", "demolitionMaterials", { width: 480, height: 30, fontSize: "size8" }),
      textTab("defects_liability_period_value", "defectsLiabilityWeeks", { width: 120 }),
      textTab("pre_contract_costs_value", "preContractCosts", { width: 140 }),
      textTab("description_of_the_work_to_be_completed_value", "workDescription", {
        width: 480, height: 24, fontSize: "size8",
      }),
      textTab("exclusions_value", "exclusionsList", { width: 490, height: 90, fontSize: "size8" }),
      textTab("special_conditions_value", "specialConditions", { width: 500, height: 200, fontSize: "size8" }),
      // ── Builder identity: locked constants baked into the template ──
      textTab("business_name_value", "builderName", { value: BUILDER_STATICS.businessName, ...locked, width: 300 }),
      textTab("builder_address_value", "builderAddress", { value: BUILDER_STATICS.address, ...locked, width: 380 }),
      textTab("builder_telephone_value", "builderPhone", { value: BUILDER_STATICS.telephone, ...locked, width: 120 }),
      textTab("builder_mobile_value", "builderMobile", { value: BUILDER_STATICS.mobile, ...locked, width: 160 }),
      textTab("builder_email_value", "builderEmail", { value: BUILDER_STATICS.email, ...locked, width: 300 }),
      textTab("builder_licence_no_value", "builderLicenceNo", { value: BUILDER_STATICS.licenceNo, ...locked, width: 150 }),
      textTab("builder_abn_no_value", "builderAbn", { value: BUILDER_STATICS.abn, ...locked, width: 150 }),
      textTab("builder_bank_account_name_value", "builderBankName", { value: BUILDER_STATICS.bankAccountName, ...locked, width: 300 }),
      textTab("builder_bank_account_bsb_value", "builderBankBsb", { value: BUILDER_STATICS.bankBsb, ...locked, width: 120 }),
      textTab("builder_bank_account_number_value", "builderBankNumber", { value: BUILDER_STATICS.bankAccountNumber, ...locked, width: 160 }),
    ],
    checkboxTabs: [
      checkboxTab("contract_price_gst_Inclusive of GST_value", "gstInclusive", { yOffset: 8 }),
      checkboxTab("included_in_the_contract_price__Yes_value", "hbcfIncluded", { yOffset: 8 }),
      checkboxTab("_b_exclusions_Yes_value", "exclusionsYes", { yOffset: 8 }),
      ...SCHEDULE1_YES_TOKENS.map((token, index) =>
        checkboxTab(token, `sch1Yes${index + 1}`, { selected: true, locked: true }),
      ),
    ],
  } as docusign.Tabs;
}

function ownerTabs(): docusign.Tabs {
  return {
    signHereTabs: [
      signHereTab("signed_by_owners_value"),
      signHereTab("acknowledgement_of_owner_docusign_0_signature_value"),
    ],
    dateSignedTabs: [dateSignedTab("acknowledgement_of_owner_docusign_0_date_value")],
    textTabs: [
      // Agreement date sentence ("this __ day of __ 20__") — typed by the
      // Owner, whose signature completes the agreement.
      textTab("signed_date_value", "signedDay", { width: 40 }),
      textTab("signed_month_value", "signedMonth", { width: 100 }),
      textTab("signed_year_value", "signedYear", { width: 40 }),
      textTab("acknowledgement_of_owner_docusign_0_name_value", "ownerPrintName", { width: 220 }),
      textTab("acknowledgement_of_owner_docusign_0_capacity_value", "ownerCapacity", { width: 220 }),
    ],
    checkboxTabs: [
      checkboxTab("acknowledgement_of_owner_consumer_building_guide_value", "ownerAckGuide"),
      checkboxTab("acknowledgement_of_owner_checklist_all_yes_value", "ownerAckChecklist"),
    ],
  } as docusign.Tabs;
}

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath || !existsSync(pdfPath)) {
    console.error("Usage: tsx scripts/docusign/create-bc4-template.ts <blank-BC4.pdf>");
    process.exit(1);
  }
  const pdfBase64 = readFileSync(pdfPath).toString("base64");

  const config = getDocusignConfig();
  const context = await createDocusignContext(config);
  const templatesApi = new docusign.TemplatesApi(context.apiClient);

  const envelopeTemplate: docusign.EnvelopeTemplate = {
    name: "MBA BC4 Residential Building Contract (Mar 2025) — Royal Constructions",
    description:
      "Head contract sent from the offer workflow once the Tender is signed. " +
      "Tabs AutoPlace onto the MBA webform's embedded merge tokens; created by " +
      "scripts/docusign/create-bc4-template.ts — edit that script, not this template.",
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
      signers: [
        {
          roleName: "Builder",
          recipientId: "1",
          routingOrder: "1",
          tabs: builderTabs(),
        },
        {
          roleName: "Owner",
          recipientId: "2",
          routingOrder: "2",
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
        env.replace(/^DOCUSIGN_CONTRACT_TEMPLATE_ID=.*$/m, `DOCUSIGN_CONTRACT_TEMPLATE_ID=${templateId}`),
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
  console.error("FAILED:", (error as Error).message, body ? JSON.stringify(body) : "");
  process.exit(1);
});
