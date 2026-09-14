import { formatPercent } from "./format";
import { roundCurrency } from "./pricing";
import type { OfferPaymentScheduleRow } from "./workspace-payment-schedule";
import type { OfferWorkspaceSnapshot } from "./workspace-persistence";
import { getVisibleExclusionRows } from "./workspace-print-template";
import { splitContractValueByGst } from "./workspace-pricing";

// The commercial figures the BC4 contract and the project handoff derive from
// an offer, kept out of the "use server" modules so they can be tested. The two
// used to compute them separately and disagreed: the handoff rounded GST and
// every stage to whole dollars, while the contract printed cents.

// Money as the BC4 contract prints it: AUD with cents.
export function formatContractMoney(value: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(value);
}

// One stage's amount, rounded to the cent once, so the contract tab, the
// project's payment stage and the deposit all carry the same figure.
export function stageAmount(
  contractValueIncGst: number,
  percentOfContract: number,
): number {
  return roundCurrency(contractValueIncGst * percentOfContract);
}

// The stage the BC4 deposit line and the project's deposit read: the one named
// as a deposit, or the first stage when none is.
export function findDepositRow<T extends { readonly stageName: string }>(
  rows: readonly T[],
): T | null {
  return (
    rows.find((row) => row.stageName.toLowerCase().includes("deposit")) ??
    rows[0] ??
    null
  );
}

// BC4 Schedule 2 has one field for every stage: "(1) Deposit 5% $47,250.00 | …".
// The percent used to be toFixed(0), so a 2.5% deposit printed as "3%" beside
// the right dollar amount on a signed contract.
export function paymentScheduleLine(
  rows: readonly OfferPaymentScheduleRow[],
  contractValueIncGst: number,
): string {
  return rows
    .map(
      (row, index) =>
        `(${index + 1}) ${row.stageName} ${formatPercent(row.percentOfContract)} ${formatContractMoney(stageAmount(contractValueIncGst, row.percentOfContract))}`,
    )
    .join("  |  ");
}

// The exclusions the Tender printed: the estimator's bullets and every Scope
// exclusion ticked for the document, deduplicated exactly as the Tender's
// exclusion table is. The contract and the project read draft.exclusionBullets
// alone, so a ticked Scope exclusion the customer signed on the Tender was
// missing from both.
export function tenderExclusionLines(
  snapshot: Pick<OfferWorkspaceSnapshot, "draft" | "exclusions">,
): string[] {
  return getVisibleExclusionRows(snapshot.draft, snapshot.exclusions).map(
    (row) => row.label,
  );
}

export type HandoffPaymentStage = {
  label: string;
  percentage: number;
  amount: number;
};

export type HandoffCommercials = {
  gstAmount: number;
  paymentStages: HandoffPaymentStage[];
  depositValue: number | null;
};

export function buildHandoffCommercials(input: {
  readonly contractValueIncGst: number;
  readonly gstRate: number;
  readonly paymentSchedule: readonly OfferPaymentScheduleRow[];
  readonly deposit: OfferPaymentScheduleRow | null;
}): HandoffCommercials {
  const { contractValueIncGst } = input;
  return {
    // The same back-solve the offer's own GST column uses, rather than a
    // whole-dollar value / 11 that ignored the offer's rate.
    gstAmount: splitContractValueByGst({
      contractValueIncGst,
      gstRate: input.gstRate,
    }).gstAmount,
    paymentStages: input.paymentSchedule.map((row) => ({
      label: row.stageName,
      // Basis points are the stored precision; this drops float noise such as
      // 7.000000000000001 without rounding a half-percent stage.
      percentage: Math.round(row.percentOfContract * 10000) / 100,
      amount: stageAmount(contractValueIncGst, row.percentOfContract),
    })),
    depositValue: input.deposit
      ? stageAmount(contractValueIncGst, input.deposit.percentOfContract)
      : null,
  };
}

export type MissingExecutedDocument = {
  readonly kind: "tender" | "contract";
  // DocuSign completed the document's latest envelope, so it is signed and
  // only the filed PDF is missing.
  readonly signed: boolean;
};

const DOCUMENT_NAME: Record<MissingExecutedDocument["kind"], string> = {
  tender: "Tender",
  contract: "Contract",
};

// Why the handoff cannot attach the executed documents. It used to say "complete
// signing via DocuSign" even when both parties had signed and only the archive
// had failed (issue #90), which sent the estimator chasing a signature that
// already existed.
export function describeMissingExecutedDocuments(
  missing: readonly MissingExecutedDocument[],
): string | null {
  if (missing.length === 0) {
    return null;
  }
  const names = (docs: readonly MissingExecutedDocument[]) =>
    docs.map((doc) => DOCUMENT_NAME[doc.kind]).join(" and ");
  const signed = missing.filter((doc) => doc.signed);
  const unsigned = missing.filter((doc) => !doc.signed);

  const sentences = ["Cannot create the project yet."];
  if (signed.length > 0) {
    sentences.push(
      `The ${names(signed)} ${signed.length === 1 ? "is" : "are"} signed, but the executed PDF could not be fetched from DocuSign and filed. Try again in a moment.`,
    );
  }
  if (unsigned.length > 0) {
    sentences.push(
      `No executed ${names(unsigned)} is on file and DocuSign has not completed ${unsigned.length === 1 ? "it" : "them"}. Complete signing via DocuSign, then try again.`,
    );
  }
  return sentences.join(" ");
}
