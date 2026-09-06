import type { OfferImageMap } from "@/lib/offer/workspace-images";
import { OFFER_IMAGE_SLOTS } from "@/lib/offer/workspace-images";
import type { OfferSendBlocker } from "@/lib/offer/offer-readiness";
import type {
  OfferWorkspaceCostLine,
  OfferWorkspaceJob,
  OfferWorkspaceScopeItem,
  OfferWorkspaceStatus,
} from "@/lib/offer/workspace-model";
import type { EffectiveMargin } from "@/lib/offer/workspace-pricing";

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
};

// Compact money for a 240px rail: no cents, and thousands shortened past $10k so
// a seven-figure contract value cannot push the row into an ellipsis.
export function compactMoney(value: number): string {
  if (!Number.isFinite(value) || value === 0) {
    return "$0";
  }
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
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
  const area = totalAreaSqm > 0 ? `${totalAreaSqm} m²` : null;
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
        ? `${Math.round(input.effectiveMargin.effectiveMarkupPct * 100)}% margin · ${compactMoney(input.contractValueIncGst)}`
        : "Not priced",
    scope: `${plural(input.allowances.length, "allowance", "allowances")} · ${input.exclusions.length} excluded`,
    "offer-document": `${imagesSet} of ${OFFER_IMAGE_SLOTS.length} images set`,
    send: sendDigest(input.status, input.sendBlockers),
    // The gated phases describe their own gate rather than their contents: until
    // they unlock there is nothing in them to summarise.
    "tender-gate": "Unlocks once the offer is agreed",
    tender: "Unlocks after tender access",
    contract: "Unlocks when the tender is signed",
    project: "Unlocks when the contract is signed",
  };
}
