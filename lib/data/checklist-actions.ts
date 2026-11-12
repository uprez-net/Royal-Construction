"use server";

import { auth } from "@clerk/nextjs/server";
import { ChecklistIssueStatus, ChecklistItemState } from "@prisma/client";
import { z } from "zod";

import {
  DomainAuthorizationError,
  DomainValidationError,
  isDomainError,
} from "@/lib/domain/errors";
import { userPrincipal, type DomainPrincipal } from "@/lib/domain/principal";
import {
  closeChecklist,
  reopenChecklist,
} from "@/lib/domain/projects/checklist-closure";
import { sendChecklistIssueEmail } from "@/lib/domain/projects/checklist-issue-email";
import {
  assignChecklistIssue,
  changeChecklistIssueStatus,
  commentOnChecklistIssue,
  verifyChecklistIssue,
} from "@/lib/domain/projects/checklist-issue-lifecycle";
import { raiseChecklistIssue } from "@/lib/domain/projects/checklist-issues";
import {
  attachChecklistPhotos,
  removeChecklistPhoto,
  setChecklistItemState,
  updateChecklistDetails,
} from "@/lib/domain/projects/checklist-review";
import {
  getChecklistDetail,
  listProjectChecklists,
  type ChecklistDetail,
  type ChecklistSummary,
} from "@/lib/domain/projects/checklists";
import {
  domainActionFailure,
  type DomainActionFailure,
} from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";

import { checklistPorts, expireChecklistProject } from "./checklists";
import { getUserByClerkIdCached } from "./user";

// The Checklists tab's door (issue #420). Every export is a Server Action — a
// POST anyone signed in can send with arguments of their choosing — so each
// resolves its caller here and hands the domain a principal; every checklist
// command runs authorizeProject before it reads or writes, so a customer, or
// an id copied from another project, gets nothing.

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

const id = (message: string) => z.string().trim().min(1, message).max(100);
const projectId = id("Project ID is required");
const checklistId = id("Checklist ID is required");
const issueId = id("Issue ID is required");
const signature = z.string().max(300_000);

export type Ok<T> = { readonly ok: true } & T;
type Result<T> = Ok<T> | DomainActionFailure;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function fetchProjectChecklists(
  rawProjectId: string,
): Promise<Result<{ checklists: ChecklistSummary[] }>> {
  try {
    const principal = await caller();
    const input = parse(z.object({ projectId }), { projectId: rawProjectId });
    return {
      checklists: await listProjectChecklists(principal, input, prisma),
      ok: true,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function fetchChecklistDetail(
  rawProjectId: string,
  number: number,
): Promise<Result<{ checklist: ChecklistDetail }>> {
  try {
    const principal = await caller();
    const input = parse(
      z.object({ number: z.number().int().min(1).max(6), projectId }),
      { number, projectId: rawProjectId },
    );
    return {
      checklist: await getChecklistDetail(principal, input, prisma),
      ok: true,
    };
  } catch (error) {
    return failure(error);
  }
}

// ---------------------------------------------------------------------------
// Rows, details and photos
// ---------------------------------------------------------------------------

const itemStateSchema = z.object({
  checklistId,
  itemId: id("Item ID is required"),
  naReason: z.string().max(300).nullable().optional(),
  projectId,
  state: z.enum(ChecklistItemState),
});

export async function setChecklistItemStateAction(
  raw: z.input<typeof itemStateSchema>,
): Promise<Result<{ itemId: string; state: ChecklistItemState }>> {
  try {
    const principal = await caller();
    const input = parse(itemStateSchema, raw);
    const result = await setChecklistItemState(principal, input, prisma);
    return { ok: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

const detailsSchema = z.object({
  checkedBy: z.string().max(120).nullable().optional(),
  checklistId,
  comments: z.string().max(5000).nullable().optional(),
  projectId,
});

export async function updateChecklistDetailsAction(
  raw: z.input<typeof detailsSchema>,
): Promise<Result<{ comments: string | null; checkedBy: string | null }>> {
  try {
    const principal = await caller();
    const input = parse(detailsSchema, raw);
    const result = await updateChecklistDetails(principal, input, prisma);
    return { ok: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

const attachSchema = z.object({
  checklistId,
  fileIds: z.array(z.uuid()).min(1).max(20),
  issueId: issueId.nullable().optional(),
  itemId: id("Item ID is required"),
  projectId,
});

export async function attachChecklistPhotosAction(
  raw: z.input<typeof attachSchema>,
): Promise<Result<{ attached: number }>> {
  try {
    const principal = await caller();
    const input = parse(attachSchema, raw);
    const result = await attachChecklistPhotos(principal, input, prisma);
    expireChecklistProject(input.projectId);
    return { ok: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

const removePhotoSchema = z.object({
  attachmentId: id("Photo ID is required"),
  checklistId,
  projectId,
});

export async function removeChecklistPhotoAction(
  raw: z.input<typeof removePhotoSchema>,
): Promise<Result<{ removed: true }>> {
  try {
    const principal = await caller();
    const input = parse(removePhotoSchema, raw);
    const result = await removeChecklistPhoto(
      principal,
      input,
      prisma,
      checklistPorts.deleteBlob,
    );
    expireChecklistProject(input.projectId);
    return { ok: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

const emailSchema = z.object({
  body: z.string().max(10_000),
  subject: z.string().max(300),
});

const raiseSchema = z.object({
  assignedTradieId: id("Tradie ID is invalid").nullable().optional(),
  checklistId,
  comments: z.string().max(5000).nullable().optional(),
  description: z.string().max(4000),
  /** Present when the reviewer pressed Send email rather than Save issue. */
  email: emailSchema.nullable().optional(),
  evidenceFileIds: z.array(z.uuid()).max(20).optional(),
  itemId: id("Item ID is required"),
  projectId,
  requestKey: id("A request key is required"),
});

export type RaiseChecklistIssueResult =
  | Ok<{
      issueId: string;
      number: number;
      /** Who the email went to; null when none was sent. */
      emailedTo: string | null;
      /** Set when the issue was saved but the email failed. */
      emailError: string | null;
    }>
  | DomainActionFailure;

/**
 * Save the issue, then — if asked — email the tradie. Two commands, not one
 * transaction: an email cannot roll back, and a failed send must leave the
 * issue and its photos saved with the failure showing, never lose them.
 */
export async function raiseChecklistIssueAction(
  raw: z.input<typeof raiseSchema>,
): Promise<RaiseChecklistIssueResult> {
  let principal: DomainPrincipal;
  let input: z.output<typeof raiseSchema>;
  let raised: { id: string; number: number };
  try {
    principal = await caller();
    input = parse(raiseSchema, raw);
    raised = await raiseChecklistIssue(principal, input, prisma);
    expireChecklistProject(input.projectId);
  } catch (error) {
    return failure(error);
  }

  if (!input.email) {
    return {
      emailError: null,
      emailedTo: null,
      issueId: raised.id,
      number: raised.number,
      ok: true,
    };
  }
  try {
    const sent = await sendChecklistIssueEmail(
      principal,
      {
        attemptKey: input.requestKey,
        body: input.email.body,
        issueId: raised.id,
        projectId: input.projectId,
        subject: input.email.subject,
      },
      prisma,
      checklistPorts.sendIssueEmail,
    );
    return {
      emailError: null,
      emailedTo: sent.to,
      issueId: raised.id,
      number: raised.number,
      ok: true,
    };
  } catch (error) {
    if (!isDomainError(error))
      console.error("[checklists] email failed", error);
    return {
      emailError:
        domainActionFailure(error)?.error
        ?? "The issue was saved, but the email was not sent. Retry it from the issue register.",
      emailedTo: null,
      issueId: raised.id,
      number: raised.number,
      ok: true,
    };
  }
}

const sendSchema = emailSchema.extend({
  attemptKey: id("An attempt key is required"),
  issueId,
  projectId,
});

export async function sendChecklistIssueEmailAction(
  raw: z.input<typeof sendSchema>,
): Promise<Result<{ to: string; replayed: boolean }>> {
  try {
    const principal = await caller();
    const input = parse(sendSchema, raw);
    const sent = await sendChecklistIssueEmail(
      principal,
      input,
      prisma,
      checklistPorts.sendIssueEmail,
    );
    return { ok: true, replayed: sent.replayed, to: sent.to };
  } catch (error) {
    if (!isDomainError(error))
      console.error("[checklists] email failed", error);
    return failure(error);
  }
}

const statusSchema = z.object({
  issueId,
  note: z.string().max(2000).nullable().optional(),
  projectId,
  to: z.enum([
    ChecklistIssueStatus.OPEN,
    ChecklistIssueStatus.IN_PROGRESS,
    ChecklistIssueStatus.RESOLVED,
  ]),
});

export async function changeChecklistIssueStatusAction(
  raw: z.input<typeof statusSchema>,
): Promise<Result<{ status: ChecklistIssueStatus }>> {
  try {
    const principal = await caller();
    const input = parse(statusSchema, raw);
    const result = await changeChecklistIssueStatus(principal, input, prisma);
    return { ok: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

const verifySchema = z.object({
  issueId,
  note: z.string().max(2000).nullable().optional(),
  projectId,
  reviewerName: z.string().max(120),
  signatureDataUrl: signature,
});

export async function verifyChecklistIssueAction(
  raw: z.input<typeof verifySchema>,
): Promise<Result<{ status: ChecklistIssueStatus }>> {
  try {
    const principal = await caller();
    const input = parse(verifySchema, raw);
    const result = await verifyChecklistIssue(principal, input, prisma);
    return { ok: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

const assignSchema = z.object({
  issueId,
  projectId,
  tradieId: id("Tradie ID is invalid").nullable(),
});

export async function assignChecklistIssueAction(
  raw: z.input<typeof assignSchema>,
): Promise<Result<{ assignedTradieId: string | null }>> {
  try {
    const principal = await caller();
    const input = parse(assignSchema, raw);
    const result = await assignChecklistIssue(principal, input, prisma);
    return { ok: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

const commentSchema = z.object({
  issueId,
  note: z.string().max(2000),
  projectId,
});

export async function commentOnChecklistIssueAction(
  raw: z.input<typeof commentSchema>,
): Promise<Result<{ issueId: string }>> {
  try {
    const principal = await caller();
    const input = parse(commentSchema, raw);
    const result = await commentOnChecklistIssue(principal, input, prisma);
    return { ok: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------

const closeSchema = z.object({
  checklistId,
  expectedVersion: z.number().int().min(1),
  projectId,
  reviewerName: z.string().max(120),
  signatureDataUrl: signature,
});

export async function closeChecklistAction(
  raw: z.input<typeof closeSchema>,
): Promise<Result<{ closedAt: Date; version: number }>> {
  try {
    const principal = await caller();
    const input = parse(closeSchema, raw);
    const result = await closeChecklist(principal, input, prisma);
    expireChecklistProject(input.projectId);
    return { ok: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

const reopenSchema = z.object({
  checklistId,
  projectId,
  reason: z.string().max(2000),
});

export async function reopenChecklistAction(
  raw: z.input<typeof reopenSchema>,
): Promise<Result<{ version: number }>> {
  try {
    const principal = await caller();
    const input = parse(reopenSchema, raw);
    const result = await reopenChecklist(principal, input, prisma);
    expireChecklistProject(input.projectId);
    return { ok: true, ...result };
  } catch (error) {
    return failure(error);
  }
}
