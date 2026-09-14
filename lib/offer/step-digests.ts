import type { OfferImageMap } from "@/lib/offer/workspace-images";
import { OFFER_IMAGE_SLOTS } from "@/lib/offer/workspace-images";
import type { OfferSendBlocker } from "@/lib/offer/offer-readiness";
import {
  OFFER_STATUS_LABEL,
  type OfferWorkspaceCostLine,
  type OfferWorkspaceJob,
  type OfferWorkspaceScopeItem,
  type OfferWorkspaceStatus,
} from "@/lib/offer/workspace-model";
import type { EffectiveMargin } from "@/lib/offer/workspace-pricing";
import type { TenderGateStatus } from "@/lib/offer/workspace-persistence";
import { formatArea } from "@/lib/offer/workspace-print-template";
import { formatPercent } from "@/lib/offer/format";

// One line per workflow step, answering "what does this step currently say?"
// without opening it.
//
// The old page put ten collapsed headers on screen with nothing but a
// Complete/Incomplete chip, so finding a number meant opening a section and
// hunting. The rail shows the number itself.
//
// Pure on purpose: the shell renders these, and this is the only part of the
// new chrome that can carry a unit test.

export type OfferStepId =
  | "job-setup"
  | "cost-schedule"
  | "pricing"
  | "scope"
  | "offer-document"
  | "send"
  | "tender-gate"
  | "tender"
  | "contract"
  | "project";

export type OfferStepDigestInput = {
  readonly job: OfferWorkspaceJob;
  readonly totalAreaSqm: number;
  readonly lines: readonly OfferWorkspaceCostLine[];
  readonly directTotal: number;
  readonly contractValueIncGst: number;
  readonly effectiveMargin: EffectiveMargin;
  readonly allowances: readonly OfferWorkspaceScopeItem[];
  readonly exclusions: readonly OfferWorkspaceScopeItem[];
  readonly images: OfferImageMap;
  readonly status: OfferWorkspaceStatus;
  readonly sendBlockers: readonly OfferSendBlocker[];
  // Whether each gated phase has opened. Without this the four later rows were
  // literal strings, so an AGREED offer's own current row read "Unlocks once
  // the offer is agreed".
  readonly phaseUnlocked: Readonly<
    Record<"tender-gate" | "tender" | "contract" | "project", boolean>
  >;
  // The Tender access answers, so an agreed offer's gate row can say whether
  // access has been granted yet.
  readonly tenderGateStatus: TenderGateStatus;
};

// Compact money for a 240px rail: no cents, and thousands shortened past $10k so
// a seven-figure contract value cannot push the row into an ellipsis.
export function compactMoney(value: number): string {
  if (!Number.isFinite(value) || value === 0) {
    return "$0";
  }
  const abs = Math.abs(value);
  // 999,500 and up round to a million; below this the k branch would print
  // "$1000k".
  if (abs >= 999_500) {
    return `$${(value / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}m`;
  }
  if (abs >= 10_000) {
    return `$${Math.round(value / 1000)}k`;
  }
  return `$${Math.round(value).toLocaleString("en-AU")}`;
}


function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

// The room counts an estimator scans for. Falls back to the area alone when no
// counts have been entered, rather than printing "0 bed · 0 bath".
function jobDigest(job: OfferWorkspaceJob, totalAreaSqm: number): string {
  // Formatted: the area is a sum of entered floats, and 180.1 + 20.2 printed
  // "200.29999999999998 m²".
  const area = totalAreaSqm > 0 ? formatArea(totalAreaSqm) : null;
  const rooms =
    job.bedrooms > 0 || job.bathrooms > 0
      ? `${job.bedrooms} bed · ${job.bathrooms} bath`
      : null;
  const parts = [rooms, area].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Not started";
}

function sendDigest(
  status: OfferWorkspaceStatus,
  blockers: readonly OfferSendBlocker[],
): string {
  switch (status) {
    case "pending":
      return blockers.length === 0
        ? "Ready to send"
        : `${plural(blockers.length, "blocker", "blockers")}`;
    case "sent":
      return "Sent, awaiting reply";
    case "offer_sent":
      return "Out for signature";
    case "offer_signed":
      return "Accepted";
    case "offer_declined":
      return "Acceptance declined";
    case "rejected":
      return "Rejected";
    case "superseded":
      return "Superseded";
    default:
      return "Agreed";
  }
}

// The gate only holds the Tender while the offer is AGREED; once a Tender has
// been drafted, access was granted.
function tenderGateDigest(
  status: OfferWorkspaceStatus,
  gate: TenderGateStatus,
): string {
  return status === "agreed" && gate !== "unlocked"
    ? "Awaiting tender access"
    : "Tender access granted";
}

// Only reached once the Tender phase is open, so anything past a declined
// Tender has a signed one.
function tenderDigest(status: OfferWorkspaceStatus): string {
  switch (status) {
    case "agreed":
      return "Ready to draft";
    case "tender_draft":
    case "tender_sent":
    case "tender_declined":
      return OFFER_STATUS_LABEL[status];
    default:
      return "Tender signed";
  }
}

// Only reached once the Contract phase is open (the Tender is signed).
function contractDigest(status: OfferWorkspaceStatus): string {
  switch (status) {
    case "tender_signed":
      return "Ready to draft";
    case "contract_draft":
    case "contract_sent":
    case "contract_declined":
      return OFFER_STATUS_LABEL[status];
    default:
      return "Contract signed";
  }
}

export function buildOfferStepDigests(
  input: OfferStepDigestInput,
): Readonly<Record<OfferStepId, string>> {
  const includedLines = input.lines.filter((line) => line.includedInContract);
  const imagesSet = OFFER_IMAGE_SLOTS.filter(
    (slot) => input.images[slot.key],
  ).length;

  return {
    "job-setup": jobDigest(input.job, input.totalAreaSqm),
    "cost-schedule":
      input.lines.length === 0
        ? "No lines yet"
        : `${plural(includedLines.length, "line", "lines")} · ${compactMoney(input.directTotal)}`,
    pricing:
      input.contractValueIncGst > 0
        ? `${formatPercent(input.effectiveMargin.effectiveMarkupPct)} margin · ${compactMoney(input.contractValueIncGst)}`
        : "Not priced",
    scope: `${plural(input.allowances.length, "allowance", "allowances")} · ${input.exclusions.length} excluded`,
    "offer-document": `${imagesSet} of ${OFFER_IMAGE_SLOTS.length} images set`,
    send: sendDigest(input.status, input.sendBlockers),
    // A gated phase describes its gate only while the gate is shut. Once open,
    // each row says where its own step stands. They all used to print the
    // offer's status, so a Contract out for signature read "Contract sent" on
    // the gate, Tender and Contract rows alike.
    "tender-gate": input.phaseUnlocked["tender-gate"]
      ? tenderGateDigest(input.status, input.tenderGateStatus)
      : "Unlocks once the offer is agreed",
    tender: input.phaseUnlocked.tender
      ? tenderDigest(input.status)
      : "Unlocks after tender access",
    contract: input.phaseUnlocked.contract
      ? contractDigest(input.status)
      : "Unlocks when the tender is signed",
    project: input.phaseUnlocked.project
      ? input.status === "project"
        ? "Project created"
        : "Ready to create"
      : "Unlocks when the contract is signed",
  };
}
