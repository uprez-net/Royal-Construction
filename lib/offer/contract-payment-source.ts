import {
  findDepositRow,
  formatContractMoney,
  paymentScheduleLine,
} from "./project-handoff-commercials";
import type { OfferPaymentScheduleRow } from "./workspace-payment-schedule";

// The Contract and the project take the payment schedule and deposit printed on
// the SIGNED Tender. The contract price stays from agreedSnapshot, and a Tender
// whose printed price differs from it is refused rather than reconciled.
//
// Both used to read agreedSnapshot.paymentSchedule, which is not the document
// the customer signed: the Tender renders from the workspace at send time, so a
// schedule edited in between reached the BC4 and the project while the signed
// Tender said otherwise.
//
// Directive-free and Prisma-free so the rules can be unit-tested.

export type TenderPaymentTerms = {
  readonly contractValueIncGst: number;
  readonly paymentSchedule: readonly OfferPaymentScheduleRow[];
  readonly deposit: OfferPaymentScheduleRow | null;
};

type TenderPaymentTermsInput = {
  readonly customerPrice: { readonly selectedContractValueIncGst: number };
  readonly paymentSchedule: readonly OfferPaymentScheduleRow[];
};

export function buildTenderPaymentTerms(
  input: TenderPaymentTermsInput,
): TenderPaymentTerms {
  const paymentSchedule = input.paymentSchedule.map((row) => ({
    id: row.id,
    stageName: row.stageName,
    percentOfContract: row.percentOfContract,
    trigger: row.trigger,
  }));
  return {
    contractValueIncGst: input.customerPrice.selectedContractValueIncGst,
    paymentSchedule,
    deposit: findDepositRow(paymentSchedule),
  };
}

// What sendTenderForSignature stores as Tender.documentData: the render input
// the Tender was printed from, plus `paymentTerms`. The render input's shape
// belongs to the renderers; paymentTerms is the contract path's own record of
// the terms the customer signed. Written only from now on; older Tenders are
// read through their render input (see resolveContractPaymentSource).
export function withTenderPaymentTerms<T extends TenderPaymentTermsInput>(
  input: T,
): T & { readonly paymentTerms: TenderPaymentTerms } {
  return { ...input, paymentTerms: buildTenderPaymentTerms(input) };
}

// Where the terms came from, logged at every contract send and handoff:
// - "tender-terms": the block stamped at send.
// - "tender-document": a Tender sent before the stamp. Its stored render input
//   carries the schedule and price it printed, so that is still the signed copy.
// - "agreed-snapshot": nothing usable on the Tender row.
export type ContractPaymentSourceKind =
  | "tender-terms"
  | "tender-document"
  | "agreed-snapshot";

export type ContractPaymentSource = {
  readonly paymentSchedule: readonly OfferPaymentScheduleRow[];
  readonly deposit: OfferPaymentScheduleRow | null;
  readonly source: ContractPaymentSourceKind;
  // The contract price the Tender printed, or null when it cannot be read.
  readonly tenderContractValueIncGst: number | null;
};

export function resolveContractPaymentSource(input: {
  readonly tenderDocumentData: unknown;
  readonly agreedPaymentSchedule: readonly OfferPaymentScheduleRow[];
}): ContractPaymentSource {
  const data = asRecord(input.tenderDocumentData);

  const terms = asRecord(data?.paymentTerms);
  const stamped = parseRows(terms?.paymentSchedule);
  if (terms && stamped) {
    return {
      paymentSchedule: stamped,
      deposit: parseRow(terms.deposit) ?? findDepositRow(stamped),
      source: "tender-terms",
      tenderContractValueIncGst: finiteNumber(terms.contractValueIncGst),
    };
  }

  const rendered = parseRows(data?.paymentSchedule);
  if (data && rendered) {
    return {
      paymentSchedule: rendered,
      deposit: findDepositRow(rendered),
      source: "tender-document",
      tenderContractValueIncGst: finiteNumber(
        asRecord(data.customerPrice)?.selectedContractValueIncGst,
      ),
    };
  }

  return {
    paymentSchedule: input.agreedPaymentSchedule,
    deposit: findDepositRow(input.agreedPaymentSchedule),
    source: "agreed-snapshot",
    tenderContractValueIncGst: null,
  };
}

// Compared in whole cents: the two prices come through different JSON and
// float paths, and 651234.57 must equal 651234.5700000001.
export function describeTenderPriceMismatch(input: {
  readonly tenderContractValueIncGst: number | null;
  readonly agreedContractValueIncGst: number;
}): string | null {
  const tender = input.tenderContractValueIncGst;
  if (tender === null) {
    return null;
  }
  const agreed = input.agreedContractValueIncGst;
  if (Math.round(tender * 100) === Math.round(agreed * 100)) {
    return null;
  }
  return `The signed Tender's contract price is ${formatContractMoney(tender)}, but the agreed offer's price is ${formatContractMoney(agreed)}. The Contract was not sent. Check which is right, then create a revision so the Tender and the Contract carry the same price.`;
}

// A Contract sent before this change records no paymentScheduleSource, and its
// BC4 printed agreedSnapshot's first 7 stages. The project follows the signed
// Tender, so where the two differ its payment stages disagree with the executed
// Contract. The handoff warns rather than choosing: which schedule governs those
// Contracts is the owner's call.
export function describeLegacyContractScheduleDrift(input: {
  readonly contractDocumentData: unknown;
  readonly agreedPaymentSchedule: readonly OfferPaymentScheduleRow[];
  readonly resolved: Pick<ContractPaymentSource, "paymentSchedule" | "source">;
  readonly contractValueIncGst: number;
}): string | null {
  const data = asRecord(input.contractDocumentData);
  if (!data || !asRecord(data.tabs) || "paymentScheduleSource" in data) {
    return null;
  }
  if (input.resolved.source === "agreed-snapshot") {
    return null;
  }
  const contractRows = input.agreedPaymentSchedule.slice(0, 7);
  if (sameStages(contractRows, input.resolved.paymentSchedule)) {
    return null;
  }
  const line = (rows: readonly OfferPaymentScheduleRow[]) =>
    paymentScheduleLine(rows, input.contractValueIncGst);
  return `The executed Contract was sent before contracts took their payment schedule from the signed Tender, and the two differ. Contract: ${line(contractRows)}. Signed Tender: ${line(input.resolved.paymentSchedule)}. The project's payment stages follow the signed Tender; check them against the executed Contract.`;
}

// Stage by stage, by name and by percent in basis points, the precision the
// schedule is stored to.
function sameStages(
  a: readonly OfferPaymentScheduleRow[],
  b: readonly OfferPaymentScheduleRow[],
): boolean {
  const basisPoints = (row: OfferPaymentScheduleRow) =>
    Math.round(row.percentOfContract * 10000);
  return (
    a.length === b.length &&
    a.every(
      (row, index) =>
        row.stageName === b[index].stageName &&
        basisPoints(row) === basisPoints(b[index]),
    )
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseRow(value: unknown): OfferPaymentScheduleRow | null {
  const row = asRecord(value);
  const percentOfContract = finiteNumber(row?.percentOfContract);
  if (!row || typeof row.stageName !== "string" || percentOfContract === null) {
    return null;
  }
  return {
    id: typeof row.id === "string" ? row.id : "",
    stageName: row.stageName,
    percentOfContract,
    trigger: typeof row.trigger === "string" ? row.trigger : "",
  };
}

// Every row must parse. A partly readable schedule is not the one that was
// signed, so it is skipped rather than trimmed.
function parseRows(value: unknown): OfferPaymentScheduleRow[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const rows = value.map(parseRow);
  return rows.every((row): row is OfferPaymentScheduleRow => row !== null)
    ? rows
    : null;
}
