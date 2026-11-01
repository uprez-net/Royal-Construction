import {
  MilestoneStatus,
  Prisma,
  ProjectStage,
  VariationKind,
  VariationStatus,
} from "@prisma/client";

import { PROJECT_STAGE_LABELS } from "@/types/project";

import { authorizeProject } from "../access/projects";
import type { DomainDb } from "../db";
import { DomainNotFoundError, DomainValidationError } from "../errors";
import type { VariationDocumentData } from "../ports/variation";
import {
  attributionUserId,
  requireAdminPrincipal,
  type DomainPrincipal,
} from "../principal";
import { toCents, type Cents } from "../tradies/billing-rules";
import { billingContactName } from "./billing-contact";
import {
  activityClientPriceCents,
  formatVariationNumber,
  variationCharge,
} from "./variation-rules";

// Raising a variation: repricing one activity, for the client to pay or for
// the builder to absorb.
//
// The wizard previews exactly what this writes. `draftVariation` and
// `raiseVariation` share one validation and one document builder, so the
// document the office approved on screen is the one the client receives.
//
// A variation is raised APPROVED. The office decides it before raising it —
// the client is being told, not asked — so there is no pending state for an
// approval to apply a schedule delay from. `decideVariation` remains for a
// variation raised the old way and still pending.

/** What the office enters on the wizard's first step. */
export type VariationDraftInput = {
  readonly projectId: string;
  readonly milestoneId: string;
  /** The activity's new price to the client, in dollars ex GST. */
  readonly newPrice: number;
  readonly kind: VariationKind;
  readonly reason: string;
  /** Defaults to today. */
  readonly raisedDate?: Date | null;
};

export type VariationActivityOption = {
  readonly id: string;
  readonly name: string;
  /** "Frame › Roof framing": where it sits, for the picker. */
  readonly path: string;
  readonly stage: ProjectStage;
  readonly status: MilestoneStatus;
  /** What the client pays for it today, ex GST. */
  readonly currentPriceCents: Cents;
};

export type VariationRecipient = {
  readonly name: string;
  readonly email: string;
};

export type VariationOptions = {
  readonly projectId: string;
  readonly projectName: string;
  readonly activities: readonly VariationActivityOption[];
  /** Every owner on the contract with an email, in contract order. */
  readonly recipients: readonly VariationRecipient[];
  readonly nextNumber: string;
};

type ContextMilestone = {
  readonly id: string;
  readonly name: string;
  readonly order: number;
  readonly parentId: string | null;
  readonly projectStage: ProjectStage;
  readonly status: MilestoneStatus;
  readonly budgetCents: Cents;
};

type ContextVariation = {
  readonly id: string;
  readonly milestoneId: string | null;
  readonly kind: VariationKind;
  readonly status: VariationStatus;
  readonly costCents: Cents;
  readonly number: number | null;
};

export type VariationProjectContext = {
  readonly project: { id: string; name: string; location: string };
  readonly owners: readonly VariationRecipient[];
  readonly clientNames: string;
  readonly milestones: ReadonlyMap<string, ContextMilestone>;
  readonly variations: readonly ContextVariation[];
};

/** Everything a variation is priced and addressed from, for one project. */
export async function loadVariationContext(
  projectId: string,
  db: DomainDb,
): Promise<VariationProjectContext> {
  const project = await db.project.findUnique({
    select: {
      customer: { select: { email: true, name: true } },
      customers: {
        orderBy: { position: "asc" },
        select: { customer: { select: { email: true, name: true } } },
      },
      id: true,
      location: true,
      milestones: {
        select: {
          budget: true,
          id: true,
          name: true,
          order: true,
          parentId: true,
          projectStage: true,
          status: true,
        },
      },
      name: true,
      variations: {
        select: {
          cost: true,
          id: true,
          kind: true,
          milestoneId: true,
          number: true,
          status: true,
        },
      },
    },
    where: { id: projectId },
  });
  if (!project) throw new DomainNotFoundError("Project not found");

  // Every owner is a ProjectCustomer; the primary customer is the fallback
  // only for a row the migration could have missed, as the Xero contact does.
  const ownerRows =
    project.customers.length > 0
      ? project.customers.map((row) => row.customer)
      : [project.customer];
  const seen = new Set<string>();
  const owners: VariationRecipient[] = [];
  for (const owner of ownerRows) {
    const email = owner.email.trim();
    const key = email.toLowerCase();
    if (!email || seen.has(key)) continue;
    seen.add(key);
    owners.push({ email, name: owner.name.trim() });
  }

  return {
    clientNames: billingContactName(ownerRows.map((owner) => owner.name)),
    milestones: new Map(
      project.milestones.map((milestone) => [
        milestone.id,
        {
          budgetCents: toCents(milestone.budget),
          id: milestone.id,
          name: milestone.name,
          order: milestone.order,
          parentId: milestone.parentId,
          projectStage: milestone.projectStage,
          status: milestone.status,
        },
      ]),
    ),
    owners,
    project: {
      id: project.id,
      location: project.location,
      name: project.name,
    },
    variations: project.variations.map((variation) => ({
      costCents: toCents(variation.cost),
      id: variation.id,
      kind: variation.kind,
      milestoneId: variation.milestoneId,
      number: variation.number,
      status: variation.status,
    })),
  };
}

/** What the client pays for this activity today, ex GST. */
export function currentActivityPriceCents(
  context: VariationProjectContext,
  milestoneId: string,
  options: { readonly excludingVariationId?: string } = {},
): Cents {
  const milestone = context.milestones.get(milestoneId);
  if (!milestone) return 0;
  return activityClientPriceCents({
    budgetCents: milestone.budgetCents,
    variations: context.variations.filter(
      (variation) =>
        variation.milestoneId === milestoneId
        && variation.id !== options.excludingVariationId,
    ),
  });
}

function nextNumber(context: VariationProjectContext): number {
  return (
    context.variations.reduce(
      (highest, variation) => Math.max(highest, variation.number ?? 0),
      0,
    ) + 1
  );
}

function activityPath(
  context: VariationProjectContext,
  milestone: ContextMilestone,
): string {
  const names = [milestone.name];
  let parentId = milestone.parentId;
  // Bounded: a malformed tree must not spin.
  for (let depth = 0; parentId && depth < 10; depth += 1) {
    const parent = context.milestones.get(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }
  return names.join(" › ");
}

/** The activities a variation can reprice, with today's price for each. */
export async function getVariationOptions(
  principal: DomainPrincipal,
  input: { readonly projectId: string },
  db: DomainDb,
): Promise<VariationOptions> {
  requireAdminPrincipal(principal);
  await authorizeProject(principal, input.projectId, db);
  const context = await loadVariationContext(input.projectId, db);

  const stageOrder = Object.values(ProjectStage);
  const activities = [...context.milestones.values()]
    .sort(
      (a, b) =>
        stageOrder.indexOf(a.projectStage) - stageOrder.indexOf(b.projectStage)
        || a.order - b.order,
    )
    .map((milestone) => ({
      currentPriceCents: currentActivityPriceCents(context, milestone.id),
      id: milestone.id,
      name: milestone.name,
      path: activityPath(context, milestone),
      stage: milestone.projectStage,
      status: milestone.status,
    }));

  return {
    activities,
    nextNumber: formatVariationNumber(nextNumber(context)),
    projectId: context.project.id,
    projectName: context.project.name,
    recipients: context.owners,
  };
}

type ValidatedDraft = {
  readonly milestone: ContextMilestone;
  readonly previousPriceCents: Cents;
  readonly newPriceCents: Cents;
  readonly reason: string;
  readonly raisedDate: Date;
};

const MAX_REASON_LENGTH = 2000;

function validateDraft(
  context: VariationProjectContext,
  input: VariationDraftInput,
  now: Date,
): ValidatedDraft {
  const milestone = context.milestones.get(input.milestoneId);
  if (!milestone) {
    throw new DomainNotFoundError(
      "That activity does not belong to this project.",
    );
  }

  const reason = input.reason.trim();
  if (!reason) {
    throw new DomainValidationError(
      "Say why the price is changing. The client reads this on the document.",
      "reason",
    );
  }
  if (reason.length > MAX_REASON_LENGTH) {
    throw new DomainValidationError(
      `Keep the reason under ${MAX_REASON_LENGTH} characters.`,
      "reason",
    );
  }

  if (!Number.isFinite(input.newPrice) || input.newPrice < 0) {
    throw new DomainValidationError(
      "Enter the activity's new price in dollars.",
      "newPrice",
    );
  }
  const newPriceCents = Math.round(input.newPrice * 100);
  const previousPriceCents = currentActivityPriceCents(context, milestone.id);
  if (newPriceCents <= previousPriceCents) {
    throw new DomainValidationError(
      `The new price must be more than the activity's current price of $${(previousPriceCents / 100).toFixed(2)} ex GST. A lower price needs a credit note, which a variation does not raise.`,
      "newPrice",
    );
  }

  const raisedDate = input.raisedDate ? new Date(input.raisedDate) : now;
  if (Number.isNaN(raisedDate.getTime())) {
    throw new DomainValidationError(
      "The date raised is not a date.",
      "raisedDate",
    );
  }
  // A day's grace for the browser's clock and time zone.
  if (raisedDate.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
    throw new DomainValidationError(
      "A variation cannot be raised on a future date.",
      "raisedDate",
    );
  }

  return { milestone, newPriceCents, previousPriceCents, raisedDate, reason };
}

/**
 * What the document says, from the row's own stored figures. The draft and
 * the issued document both come through here.
 */
export function variationDocumentData(
  context: VariationProjectContext,
  variation: {
    readonly number: number | null;
    readonly kind: VariationKind;
    readonly milestoneId: string | null;
    readonly description: string;
    readonly requestedDate: Date;
    readonly previousPriceCents: Cents;
    readonly newPriceCents: Cents;
    readonly invoiceNumber: string | null;
    readonly dueDate: Date | null;
  },
): VariationDocumentData {
  const milestone = variation.milestoneId
    ? context.milestones.get(variation.milestoneId)
    : undefined;
  const charge = variationCharge({
    kind: variation.kind,
    newPriceCents: variation.newPriceCents,
    previousPriceCents: variation.previousPriceCents,
  });
  return {
    absorbedCents: charge.absorbedCents,
    activityName: milestone
      ? activityPath(context, milestone)
      : "Project scope",
    chargeExGstCents: charge.chargeExGstCents,
    chargeIncGstCents: charge.chargeIncGstCents,
    clientNames: context.clientNames,
    differenceCents: charge.differenceCents,
    dueDate: variation.dueDate,
    greetingName: context.owners[0]?.name || context.clientNames,
    gstCents: charge.gstCents,
    invoiceNumber: variation.invoiceNumber,
    kind: variation.kind,
    newPriceCents: variation.newPriceCents,
    number: formatVariationNumber(variation.number),
    previousPriceCents: variation.previousPriceCents,
    projectName: context.project.name,
    raisedDate: variation.requestedDate,
    reason: variation.description,
    siteAddress: context.project.location,
    stageLabel: milestone ? PROJECT_STAGE_LABELS[milestone.projectStage] : "",
  };
}

export type VariationDraft = {
  readonly document: VariationDocumentData;
  readonly recipients: readonly VariationRecipient[];
};

/** The variation as it would be raised, without writing anything. */
export async function draftVariation(
  principal: DomainPrincipal,
  input: VariationDraftInput,
  db: DomainDb,
  now: Date = new Date(),
): Promise<VariationDraft> {
  requireAdminPrincipal(principal);
  await authorizeProject(principal, input.projectId, db);
  const context = await loadVariationContext(input.projectId, db);
  const draft = validateDraft(context, input, now);
  return {
    document: variationDocumentData(context, {
      description: draft.reason,
      dueDate: null,
      invoiceNumber: null,
      kind: input.kind,
      milestoneId: draft.milestone.id,
      newPriceCents: draft.newPriceCents,
      number: nextNumber(context),
      previousPriceCents: draft.previousPriceCents,
      requestedDate: draft.raisedDate,
    }),
    recipients: context.owners,
  };
}

export type RaisedVariation = {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly number: number;
  readonly kind: VariationKind;
  readonly description: string;
  readonly costCents: Cents;
  readonly siteManagerId: string | null;
  /** True when this request key had already raised it: nothing new written. */
  readonly replayed: boolean;
};

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "P2002";
}

/**
 * Raise a variation: write it, numbered and APPROVED. Issuing it — the Xero
 * invoice, the document, the email — is `issueVariation`, run straight after
 * by the adapter, so a failure there leaves a variation the tab can show and
 * retry rather than one that silently never existed.
 *
 * `requestKey` is the browser's key for one press of Send. A double-click, or
 * a retry after a timeout, returns the variation already raised instead of
 * raising a second one — which would be a second invoice to the client.
 */
export async function raiseVariation(
  principal: DomainPrincipal,
  input: VariationDraftInput & { readonly requestKey: string },
  db: DomainDb,
  now: Date = new Date(),
): Promise<RaisedVariation> {
  requireAdminPrincipal(principal);
  const project = await authorizeProject(principal, input.projectId, db);
  const requestKey = input.requestKey.trim();
  if (!requestKey) {
    throw new DomainValidationError("A request key is required.");
  }

  const existing = await findByRequestKey(requestKey, db);
  if (existing) {
    if (existing.projectId !== input.projectId) {
      throw new DomainValidationError(
        "That request key belongs to another project.",
      );
    }
    return toRaised(existing, project, true);
  }

  // Two tabs raising at once can both read the same next number; the unique
  // index refuses the second, which then takes the number after.
  for (let attempt = 0; ; attempt += 1) {
    const context = await loadVariationContext(input.projectId, db);
    const draft = validateDraft(context, input, now);
    try {
      const created = await db.variation.create({
        data: {
          approvedDate: now,
          cost: new Prisma.Decimal(
            (draft.newPriceCents - draft.previousPriceCents) / 100,
          ),
          delayDays: 0,
          description: draft.reason,
          kind: input.kind,
          milestoneId: draft.milestone.id,
          newPrice: new Prisma.Decimal(draft.newPriceCents / 100),
          number: nextNumber(context),
          previousPrice: new Prisma.Decimal(draft.previousPriceCents / 100),
          projectId: input.projectId,
          raisedById: attributionUserId(principal),
          requestKey,
          requestedDate: draft.raisedDate,
          status: VariationStatus.APPROVED,
        },
        select: RAISED_SELECT,
      });
      return toRaised(created, project, false);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await findByRequestKey(requestKey, db);
      if (raced) return toRaised(raced, project, true);
      if (attempt >= 2) throw error;
    }
  }
}

const RAISED_SELECT = {
  cost: true,
  description: true,
  id: true,
  kind: true,
  number: true,
  projectId: true,
} as const;

function findByRequestKey(requestKey: string, db: DomainDb) {
  return db.variation.findUnique({
    select: RAISED_SELECT,
    where: { requestKey },
  });
}

function toRaised(
  row: {
    id: string;
    projectId: string;
    number: number | null;
    kind: VariationKind;
    description: string;
    cost: Prisma.Decimal;
  },
  project: { name: string; siteManagerId: string | null },
  replayed: boolean,
): RaisedVariation {
  return {
    costCents: toCents(row.cost),
    description: row.description,
    id: row.id,
    kind: row.kind,
    number: row.number ?? 0,
    projectId: row.projectId,
    projectName: project.name,
    replayed,
    siteManagerId: project.siteManagerId,
  };
}
