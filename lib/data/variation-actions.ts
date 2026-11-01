"use server";

import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import {
  DomainAuthorizationError,
  DomainValidationError,
  isDomainError,
} from "@/lib/domain/errors";
import { userPrincipal, type DomainPrincipal } from "@/lib/domain/principal";
import {
  issueVariation,
  variationEmailSubject,
  type IssuedVariation,
} from "@/lib/domain/projects/variation-issue";
import {
  getProjectVariations,
  type ProjectVariations,
} from "@/lib/domain/projects/variation-queries";
import {
  draftVariation,
  getVariationOptions,
  raiseVariation,
  type VariationOptions,
  type VariationRecipient,
} from "@/lib/domain/projects/variation-raise";
import {
  domainActionFailure,
  type DomainActionFailure,
} from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { buildVariationDocumentHtml } from "@/lib/projects/variation-document-html";

import { getUserByClerkIdCached } from "./user";
import {
  afterVariationRaised,
  expireVariationProject,
  renderVariationEmailHtml,
  variationIssuePorts,
} from "./variations";

// The variation wizard's and the Variations tab's door. Every export is a
// Server Action — a POST anyone signed in can send with arguments of their
// choosing — so each resolves its caller here and hands the domain a
// principal; the domain refuses anyone who is not an admin before it reads a
// price.

async function caller(): Promise<DomainPrincipal> {
  const { userId } = await auth();
  if (!userId) throw new DomainAuthorizationError("Sign in to continue.");
  const user = await getUserByClerkIdCached(userId);
  if (!user) throw new DomainAuthorizationError("Sign in to continue.");
  return userPrincipal(user);
}

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new DomainValidationError(
      issue?.message ?? "Some details are missing.",
      issue?.path[0]?.toString(),
    );
  }
  return result.data;
}

function failure(error: unknown): DomainActionFailure {
  const refused = domainActionFailure(error);
  if (refused) return refused;
  throw error;
}

const id = (message: string) => z.string().trim().min(1, message);

const draftSchema = z.object({
  kind: z.enum(["CHARGEABLE", "PROMOTIONAL"]),
  milestoneId: id("Choose the activity this variation reprices"),
  newPrice: z.number({ error: "Enter the activity's new price" }),
  projectId: id("Project ID is required"),
  raisedDate: z.iso.date("Enter the date the variation was raised").optional(),
  reason: z.string().max(2000, "Keep the reason under 2,000 characters"),
});

export type VariationDraftForm = z.input<typeof draftSchema>;

/** `YYYY-MM-DD` as the calendar day it names, at UTC midnight. */
function day(value: string | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

export type VariationOptionsResult =
  | { readonly ok: true; readonly options: VariationOptions }
  | DomainActionFailure;

export async function fetchVariationOptions(
  projectId: string,
): Promise<VariationOptionsResult> {
  try {
    const principal = await caller();
    return {
      ok: true,
      options: await getVariationOptions(principal, { projectId }, prisma),
    };
  } catch (error) {
    return failure(error);
  }
}

export type VariationPreviewResult =
  | {
      readonly ok: true;
      readonly documentHtml: string;
      readonly emailHtml: string;
      readonly subject: string;
      readonly recipients: readonly VariationRecipient[];
      readonly chargeIncGstCents: number;
    }
  | DomainActionFailure;

/** The document and the email exactly as they would go, nothing written. */
export async function previewVariationAction(
  raw: VariationDraftForm,
): Promise<VariationPreviewResult> {
  try {
    const principal = await caller();
    const input = parse(draftSchema, raw);
    const draft = await draftVariation(
      principal,
      { ...input, raisedDate: day(input.raisedDate) },
      prisma,
    );
    return {
      chargeIncGstCents: draft.document.chargeIncGstCents,
      documentHtml: buildVariationDocumentHtml(draft.document),
      emailHtml: await renderVariationEmailHtml(draft.document),
      ok: true,
      recipients: draft.recipients,
      subject: variationEmailSubject(draft.document),
    };
  } catch (error) {
    return failure(error);
  }
}

const raiseSchema = draftSchema.extend({
  recipients: z.array(z.string().trim().min(1)).max(20),
  requestKey: id("A request key is required"),
});

export type RaiseVariationResult =
  | { readonly ok: true; readonly issued: IssuedVariation }
  | (DomainActionFailure & {
      /** Set when the variation was written but not fully issued. */
      readonly variationId?: string;
    });

/**
 * Raise the variation, then issue it: the Xero invoice, the document, the
 * email. Two commands, not one transaction — the external effects cannot roll
 * back — so a failure while issuing answers with the variation's id, and the
 * Variations tab carries the retry.
 */
export async function raiseVariationAction(
  raw: z.input<typeof raiseSchema>,
): Promise<RaiseVariationResult> {
  let principal: DomainPrincipal;
  let input: z.output<typeof raiseSchema>;
  let variationId: string;
  try {
    principal = await caller();
    input = parse(raiseSchema, raw);
    const raised = await raiseVariation(
      principal,
      { ...input, raisedDate: day(input.raisedDate) },
      prisma,
    );
    variationId = raised.id;
    afterVariationRaised(principal, raised);
  } catch (error) {
    return failure(error);
  }

  try {
    const issued = await issueVariation(
      principal,
      {
        emailAttemptKey: input.requestKey,
        projectId: input.projectId,
        recipients: input.recipients,
        variationId,
      },
      prisma,
      variationIssuePorts,
    );
    return { issued, ok: true };
  } catch (error) {
    if (!isDomainError(error)) {
      console.error("[variation] issuing failed", error);
    }
    const refused: DomainActionFailure = domainActionFailure(error) ?? {
      code: "variation_issue_failed",
      error:
        "The variation was saved, but sending it failed. Retry from the Variations tab.",
      ok: false,
      status: 500,
    };
    return { ...refused, variationId };
  } finally {
    expireVariationProject(input.projectId);
  }
}

const issueSchema = z.object({
  attemptKey: id("An attempt key is required"),
  projectId: id("Project ID is required"),
  resend: z.boolean().optional(),
  variationId: id("Variation ID is required"),
});

export type IssueVariationResult =
  | { readonly ok: true; readonly issued: IssuedVariation }
  | DomainActionFailure;

/** Finish issuing a variation a step failed on, or email it again. */
export async function issueVariationAction(
  raw: z.input<typeof issueSchema>,
): Promise<IssueVariationResult> {
  try {
    const principal = await caller();
    const input = parse(issueSchema, raw);
    try {
      const issued = await issueVariation(
        principal,
        {
          emailAttemptKey: input.attemptKey,
          projectId: input.projectId,
          resend: input.resend,
          variationId: input.variationId,
        },
        prisma,
        variationIssuePorts,
      );
      return { issued, ok: true };
    } finally {
      expireVariationProject(input.projectId);
    }
  } catch (error) {
    if (!isDomainError(error)) {
      console.error("[variation] issuing failed", error);
    }
    return failure(error);
  }
}

export type ProjectVariationsResult =
  | { readonly ok: true; readonly report: ProjectVariations }
  | DomainActionFailure;

export async function fetchProjectVariations(
  projectId: string,
): Promise<ProjectVariationsResult> {
  try {
    const principal = await caller();
    return {
      ok: true,
      report: await getProjectVariations(principal, { projectId }, prisma),
    };
  } catch (error) {
    return failure(error);
  }
}
