"use server";

import { revalidateTag } from "next/cache";

import { auth } from "@clerk/nextjs/server";
import { sendEmail } from "@/lib/azureClient";
import { blobStoreIdFromToken } from "@/lib/blob-url";
import {
  DomainAuthorizationError,
  DomainValidationError,
} from "@/lib/domain/errors";
import { userPrincipal, type DomainPrincipal } from "@/lib/domain/principal";
import {
  getProjectFinancials,
  type ProjectFinancials,
} from "@/lib/domain/projects/financials";
import {
  prepareTradieInvoiceRecheck,
  requestTradieInvoiceRecheck,
  type TradieInvoiceRecheck,
} from "@/lib/domain/tradies/invoice-recheck";
import {
  readTradieInvoiceDocument,
  type TradieInvoiceDocumentFields,
} from "@/lib/domain/tradies/invoice-document";
import {
  confirmEmailedTradieInvoice,
  dismissEmailedTradieInvoice,
} from "@/lib/domain/tradies/invoice-inbox";
import {
  allocateTradieInvoice,
  recordTradieInvoice,
  voidTradieInvoice,
} from "@/lib/domain/tradies/invoices";
import {
  domainActionFailure,
  type DomainActionFailure,
} from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import {
  allocateTradieInvoiceSchema,
  dismissEmailedInvoiceSchema,
  previewInvoiceRecheckSchema,
  readTradieInvoiceDocumentSchema,
  recordTradieInvoiceSchema,
  sendInvoiceRecheckSchema,
  voidTradieInvoiceSchema,
  type RecordTradieInvoiceFormInput,
} from "@/utils/validators/tradie-invoices";

import { getUserByClerkIdCached } from "./user";

// The Financials tab's door. Every export is a Server Action — a POST anyone
// signed in can send with arguments of their choosing — so each resolves its
// caller here and hands the domain a principal; the domain commands refuse
// anyone who is not an admin before they read a figure.

export type ProjectFinancialsResult =
  | { readonly ok: true; readonly report: ProjectFinancials }
  | DomainActionFailure;

/**
 * The signed-in caller. No session is refused outright rather than mapped to
 * the system principal `currentPrincipal` gives a request without one: that
 * is right for a cron, and would be full access here.
 */
async function caller(): Promise<DomainPrincipal> {
  const { userId } = await auth();
  if (!userId) throw new DomainAuthorizationError("Sign in to continue.");
  const user = await getUserByClerkIdCached(userId);
  if (!user) throw new DomainAuthorizationError("Sign in to continue.");
  return userPrincipal(user);
}

function parse<T>(
  result:
    | { success: true; data: T }
    | { success: false; error: { issues: { message: string }[] } },
): T {
  if (!result.success) {
    throw new DomainValidationError(
      result.error.issues[0]?.message ?? "Some details are missing.",
    );
  }
  return result.data;
}

/** `YYYY-MM-DD` as the calendar day it names, at UTC midnight. */
function day(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** The project page reads milestone spend and tradie lists from its cache. */
function expireProject(projectId: string) {
  revalidateTag("projects", CACHE_PROFILES.MEDIUM);
  revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);
}

async function answer(
  run: (principal: DomainPrincipal) => Promise<string>,
): Promise<ProjectFinancialsResult> {
  try {
    const principal = await caller();
    const projectId = await run(principal);
    return {
      ok: true,
      report: await getProjectFinancials(principal, { projectId }, prisma),
    };
  } catch (error) {
    const failure = domainActionFailure(error);
    if (failure) return failure;
    throw error;
  }
}

export async function fetchProjectFinancials(
  projectId: string,
): Promise<ProjectFinancialsResult> {
  return answer(async () => projectId);
}

export async function recordTradieInvoiceAction(
  raw: RecordTradieInvoiceFormInput,
): Promise<ProjectFinancialsResult> {
  return answer(async (principal) => {
    const input = parse(recordTradieInvoiceSchema.safeParse(raw));
    const recorded = await prisma.$transaction(async (tx) => {
      const result = await recordTradieInvoice(
        principal,
        {
          document: input.document ?? null,
          documentStoreId: blobStoreIdFromToken(
            process.env.BLOB_READ_WRITE_TOKEN,
          ),
          dueDate: input.dueDate ? day(input.dueDate) : null,
          invoiceNumber: input.invoiceNumber,
          issuedDate: day(input.issuedDate),
          notes: input.notes,
          projectId: input.projectId,
          scheduleId: input.scheduleId,
          subTotal: input.subTotal,
          totalTax: input.totalTax,
        },
        tx,
      );
      // Confirming an emailed invoice: the entry settles with the invoice in
      // one transaction, so it can never be both recorded and still waiting.
      if (input.inboxId) {
        await confirmEmailedTradieInvoice(
          principal,
          {
            inboxId: input.inboxId,
            invoiceId: result.invoiceId,
            projectId: input.projectId,
          },
          tx,
        );
      }
      return result;
    });
    expireProject(recorded.projectId);
    return recorded.projectId;
  });
}

export type TradieInvoiceDocumentResult =
  | { readonly ok: true; readonly fields: TradieInvoiceDocumentFields }
  | DomainActionFailure;

/**
 * Read an uploaded tradie invoice to fill in the Record invoice form. Writes
 * nothing: the document is attached when the invoice is recorded.
 */
export async function readTradieInvoiceDocumentAction(raw: {
  projectId: string;
  name: string;
  url: string;
  contentType: string;
}): Promise<TradieInvoiceDocumentResult> {
  try {
    const principal = await caller();
    const input = parse(readTradieInvoiceDocumentSchema.safeParse(raw));
    // Loaded here, not at the top: the model module throws on import without
    // its gateway key, and that must not take every other action down too.
    const { readTradieInvoiceWithAi } =
      await import("@/lib/agent/tradieInvoiceExtractionAgent");
    const fields = await readTradieInvoiceDocument(
      principal,
      {
        contentType: input.contentType,
        document: { name: input.name, url: input.url },
        projectId: input.projectId,
        storeId: blobStoreIdFromToken(process.env.BLOB_READ_WRITE_TOKEN),
      },
      prisma,
      readTradieInvoiceWithAi,
    );
    return { fields, ok: true };
  } catch (error) {
    const failure = domainActionFailure(error);
    if (failure) return failure;
    throw error;
  }
}

/** Set an emailed invoice aside without recording it. */
export async function dismissEmailedInvoiceAction(raw: {
  projectId: string;
  inboxId: string;
}): Promise<ProjectFinancialsResult> {
  return answer(async (principal) => {
    const input = parse(dismissEmailedInvoiceSchema.safeParse(raw));
    const dismissed = await dismissEmailedTradieInvoice(
      principal,
      input,
      prisma,
    );
    return dismissed.projectId;
  });
}

export async function allocateTradieInvoiceAction(raw: {
  projectId: string;
  invoiceId: string;
  scheduleId: string;
}): Promise<ProjectFinancialsResult> {
  return answer(async (principal) => {
    const input = parse(allocateTradieInvoiceSchema.safeParse(raw));
    const allocated = await prisma.$transaction((tx) =>
      allocateTradieInvoice(principal, input, tx),
    );
    expireProject(allocated.projectId);
    return allocated.projectId;
  });
}

export async function voidTradieInvoiceAction(raw: {
  projectId: string;
  invoiceId: string;
  reason: string;
}): Promise<ProjectFinancialsResult> {
  return answer(async (principal) => {
    const input = parse(voidTradieInvoiceSchema.safeParse(raw));
    const voided = await prisma.$transaction((tx) =>
      voidTradieInvoice(principal, input, tx),
    );
    expireProject(voided.projectId);
    return voided.projectId;
  });
}

export type InvoiceRecheckPreviewResult =
  | { readonly ok: true; readonly recheck: TradieInvoiceRecheck }
  | DomainActionFailure;

/** The recheck email exactly as it would go, for the dialog to show first. */
export async function previewInvoiceRecheckAction(raw: {
  projectId: string;
  scheduleId: string;
}): Promise<InvoiceRecheckPreviewResult> {
  try {
    const principal = await caller();
    const input = parse(previewInvoiceRecheckSchema.safeParse(raw));
    const recheck = await prepareTradieInvoiceRecheck(principal, input, prisma);
    return { ok: true, recheck };
  } catch (error) {
    const failure = domainActionFailure(error);
    if (failure) return failure;
    throw error;
  }
}

export type InvoiceRecheckSendResult =
  | {
      readonly ok: true;
      readonly to: string;
      /** This attempt had already gone out; nothing was sent again. */
      readonly alreadySent: boolean;
    }
  | DomainActionFailure;

/**
 * Email the tradie the recheck. The dialog holds `attemptKey` until a send
 * succeeds (`useIdempotencyKey`), so a retry is the same email, not a second.
 */
export async function sendInvoiceRecheckAction(raw: {
  projectId: string;
  scheduleId: string;
  attemptKey: string;
}): Promise<InvoiceRecheckSendResult> {
  try {
    const principal = await caller();
    const input = parse(sendInvoiceRecheckSchema.safeParse(raw));
    const sent = await requestTradieInvoiceRecheck(
      principal,
      input,
      prisma,
      (message) => sendEmail(message),
    );
    revalidateTag(`project-${input.projectId}`, CACHE_PROFILES.MEDIUM);
    return { alreadySent: sent.alreadySent, ok: true, to: sent.to };
  } catch (error) {
    const failure = domainActionFailure(error);
    if (failure) return failure;
    throw error;
  }
}
