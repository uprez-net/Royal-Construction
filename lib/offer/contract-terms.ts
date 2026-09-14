import {
  resolveContractPaymentSource,
  type ContractPaymentSource,
  type ContractPaymentSourceKind,
} from "./contract-payment-source";
import { buildProposalInput } from "./offer-proposal-input";
import {
  formatContractMoney,
  paymentScheduleLine,
  stageAmount,
  tenderExclusionLines,
} from "./project-handoff-commercials";
import type { OfferPaymentScheduleRow } from "./workspace-payment-schedule";
import type { OfferWorkspaceSnapshot } from "./workspace-persistence";

// The payment terms the BC4 carries, resolved once for the contract send and for
// the Contract step's preview. The preview read the workspace's own schedule
// while the send filled the BC4 from the signed Tender, so the estimator could
// review one schedule and send the customer another.
//
// Directive-free and Prisma-free so the send and the workspace loader share it
// and the rules can be unit-tested.

// The BC4 template's payment-stage slots. The send refuses a longer schedule.
export const CONTRACT_STAGE_SLOTS = 7;

export type ContractTermsStage = {
  readonly id: string;
  readonly stageName: string;
  readonly percentOfContract: number;
  readonly trigger: string;
  readonly amount: number;
};

// Plain data, so the loader can return it through a Server Action. The Tender's
// documentData is the whole render input and never leaves the server.
export type ContractTerms = {
  readonly source: ContractPaymentSourceKind;
  readonly contractValueIncGst: number;
  readonly paymentSchedule: readonly ContractTermsStage[];
  // The BC4 tab values, exactly as the send fills them.
  readonly paymentScheduleLine: string;
  readonly deposit: ContractTermsStage | null;
  readonly depositAmount: string;
  readonly exclusions: readonly string[];
};

export function resolveContractTerms(input: {
  readonly tenderDocumentData: unknown;
  // What the send renders from: agreedSnapshot, or workspaceState without one.
  readonly agreedSnapshot: OfferWorkspaceSnapshot;
}): { readonly payment: ContractPaymentSource; readonly terms: ContractTerms } {
  const snapshot = input.agreedSnapshot;
  // The price goes through the same path the Tender used: a blank override
  // round-trips to "0", so Number(...) would lock a $0.00 contract while the
  // signed Tender showed the computed value. buildProposalInput runs
  // resolveOptionalPriceInput and the computed-value fallback.
  const contractValueIncGst =
    buildProposalInput(snapshot).customerPrice.selectedContractValueIncGst;
  const payment = resolveContractPaymentSource({
    tenderDocumentData: input.tenderDocumentData,
    agreedPaymentSchedule: snapshot.paymentSchedule,
  });
  const stage = (row: OfferPaymentScheduleRow): ContractTermsStage => ({
    id: row.id,
    stageName: row.stageName,
    percentOfContract: row.percentOfContract,
    trigger: row.trigger,
    amount: stageAmount(contractValueIncGst, row.percentOfContract),
  });

  return {
    payment,
    terms: {
      source: payment.source,
      contractValueIncGst,
      paymentSchedule: payment.paymentSchedule.map(stage),
      paymentScheduleLine: paymentScheduleLine(
        payment.paymentSchedule.slice(0, CONTRACT_STAGE_SLOTS),
        contractValueIncGst,
      ),
      deposit: payment.deposit ? stage(payment.deposit) : null,
      depositAmount: payment.deposit
        ? formatContractMoney(
            stageAmount(contractValueIncGst, payment.deposit.percentOfContract),
          )
        : "",
      // The exclusions the Tender printed, Scope exclusions included: the
      // bullets alone left out every ticked Scope exclusion the customer signed.
      exclusions: tenderExclusionLines(snapshot),
    },
  };
}
