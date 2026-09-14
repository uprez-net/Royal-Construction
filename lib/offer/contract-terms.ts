import {
  describeTenderPriceMismatch,
  resolveContractPaymentSource,
  type ContractPaymentSource,
  type ContractPaymentSourceKind,
} from "./contract-payment-source";
import {
  hasContractTerms,
  isContractSentStatus,
} from "./contract-terms-status";
import { buildProposalInput } from "./offer-proposal-input";
import {
  formatContractMoney,
  paymentScheduleLine,
  stageAmount,
  tenderExclusionLines,
} from "./project-handoff-commercials";
import type { OfferPaymentScheduleRow } from "./workspace-payment-schedule";
import {
  deserializeWorkspace,
  parseWorkspaceState,
  type OfferWorkspaceSnapshot,
} from "./workspace-persistence";

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
  // The refusal the send returns for these terms, or null. The preview shows it
  // so the estimator learns before Send that no Contract can go out on them.
  readonly refusal: string | null;
};

// The offer columns the send and the Contract step read. Both go through
// contractTermsInput, so neither can resolve from a different copy of the offer.
export type ContractTermsRow = {
  readonly agreedSnapshot: unknown;
  readonly workspaceState: unknown;
  readonly tender: { readonly documentData: unknown } | null;
};

export type ContractTermsInput = {
  readonly tenderDocumentData: unknown;
  // What the send renders from: agreedSnapshot, or workspaceState without one.
  readonly agreedSnapshot: OfferWorkspaceSnapshot;
};

// Null when the offer has no stored state. A state that does not parse throws,
// as it always has on the send.
export function contractTermsInput(
  row: ContractTermsRow,
): ContractTermsInput | null {
  const state = row.agreedSnapshot ?? row.workspaceState;
  if (!state) {
    return null;
  }
  return {
    tenderDocumentData: row.tender?.documentData ?? null,
    agreedSnapshot: deserializeWorkspace(parseWorkspaceState(state)),
  };
}

export function resolveContractTerms(input: ContractTermsInput): {
  readonly payment: ContractPaymentSource;
  readonly terms: ContractTerms;
} {
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
      // A Tender that printed a different price is refused rather than
      // reconciled.
      refusal:
        describeTenderPriceMismatch({
          tenderContractValueIncGst: payment.tenderContractValueIncGst,
          agreedContractValueIncGst: contractValueIncGst,
        }) ?? describeStageOverflow(payment.paymentSchedule.length),
    },
  };
}

// Refused rather than silently dropping validated stages past the last slot,
// which would send a contract whose schedule doesn't sum to the contract value.
function describeStageOverflow(stageCount: number): string | null {
  return stageCount > CONTRACT_STAGE_SLOTS
    ? `The contract template supports up to ${CONTRACT_STAGE_SLOTS} payment stages, but this schedule has ${stageCount}. Consolidate the payment schedule before sending the Contract.`
    : null;
}

export type SentContractStage = {
  readonly stageName: string;
  // As printed: "2.5%", or "3%" on a Contract sent while percents were rounded.
  readonly percent: string;
  readonly amount: string;
};

// What a sent BC4 carried, read back from the tab values the send stored.
// Resolving again describes today's rules, not that document: a Contract sent
// before the terms came from the signed Tender printed agreedSnapshot's schedule
// with whole-number percents and the exclusion bullets alone.
export type SentContractTerms = {
  readonly source: "sent-contract";
  // The copy the send took the schedule from. Null on a Contract sent before
  // the send recorded it.
  readonly scheduleSource: ContractPaymentSourceKind | null;
  readonly paymentSchedule: readonly SentContractStage[];
  readonly depositAmount: string;
  readonly exclusions: readonly string[];
};

export type ContractPreviewTerms = ContractTerms | SentContractTerms;

const SOURCE_KINDS: readonly ContractPaymentSourceKind[] = [
  "tender-terms",
  "tender-document",
  "agreed-snapshot",
];

// One "(1) Deposit 2.5% $16,250.00" segment of the stage line, as both the
// current and the earlier send wrote it.
const SENT_STAGE = /^\(\d+\) (.*) (\S+%) (\S+)$/;

// Null when the Contract row holds no sent tabs.
export function readSentContractTerms(
  contractDocumentData: unknown,
): SentContractTerms | null {
  const data = asRecord(contractDocumentData);
  const tabs = asRecord(data?.tabs);
  if (!data || !tabs || typeof tabs.paymentSchedule !== "string") {
    return null;
  }
  return {
    source: "sent-contract",
    scheduleSource:
      SOURCE_KINDS.find((kind) => kind === data.paymentScheduleSource) ?? null,
    paymentSchedule: tabs.paymentSchedule
      .split("  |  ")
      .filter((segment) => segment.trim() !== "")
      .map((segment) => {
        const match = SENT_STAGE.exec(segment);
        return match
          ? { stageName: match[1], percent: match[2], amount: match[3] }
          : { stageName: segment, percent: "", amount: "" };
      }),
    depositAmount:
      typeof tabs.depositAmount === "string" ? tabs.depositAmount : "",
    exclusions:
      typeof tabs.exclusionsList === "string"
        ? tabs.exclusionsList.split("\n").filter((line) => line.trim() !== "")
        : [],
  };
}

// The terms the Contract step shows at this status; null before TENDER_SIGNED.
export function contractPreviewTerms(input: {
  readonly status: string;
  readonly row: ContractTermsRow & {
    readonly contract: { readonly documentData: unknown } | null;
  };
}): ContractPreviewTerms | null {
  if (!hasContractTerms(input.status)) {
    return null;
  }
  if (isContractSentStatus(input.status)) {
    const sent = readSentContractTerms(input.row.contract?.documentData);
    // No sent tabs means no send was recorded: a development sign, or a send
    // whose recording failed after DocuSign took it, which resolved these terms.
    if (sent) {
      return sent;
    }
  }
  const termsInput = contractTermsInput(input.row);
  return termsInput ? resolveContractTerms(termsInput).terms : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
