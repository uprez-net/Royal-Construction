"use server";

import { auth } from "@clerk/nextjs/server";
import { findLeadById } from "@/lib/data/leads";
import { assertCanAccessLead } from "@/lib/offer/access";
import { getUserByClerkIdCached } from "@/lib/data/user";
import {
  generateOfferPrefillDraft,
  type OfferPrefillDraft,
} from "@/lib/offer/offer-prefill-ai";
import type {
  OfferDocumentDraft,
  OfferWorkspaceJob,
} from "@/lib/offer/workspace-model";

// Mutable accumulators (the job/draft types are readonly; the returned patch
// is still assignable to Partial<...>).
type WritableJobPatch = {
  -readonly [K in keyof OfferWorkspaceJob]?: OfferWorkspaceJob[K];
};
type WritableDraftPatch = {
  -readonly [K in keyof OfferDocumentDraft]?: OfferDocumentDraft[K];
};

export type OfferPrefillResult =
  | {
      ok: true;
      job: Partial<OfferWorkspaceJob>;
      draft: Partial<OfferDocumentDraft>;
      sources: string[];
      confidence: OfferPrefillDraft["confidence"] | null;
      notes: string;
    }
  | { ok: false; error: string };

// Pre-fill the offer workspace from a lead's context (Phase 0 + Phase 1).
//   Phase 0: deterministically copy the lead's contact + site into the job.
//   Phase 1: AI-draft buildType / buildScope / introText from the lead's
//            sales notes + email conversation (text only — no files/OCR).
// Returns patches to apply via the workspace's existing updateJob/updateDraft;
// every AI value is a reviewable draft, never authoritative.
export async function generateOfferPrefillFromLead(input: {
  leadId: number;
}): Promise<OfferPrefillResult> {
  const { isAuthenticated, userId: clerkId } = await auth();
  if (!isAuthenticated || !clerkId) {
    return { ok: false, error: "Unauthorized" };
  }
  const user = await getUserByClerkIdCached(clerkId);
  if (!user) {
    return { ok: false, error: "No internal user for the signed-in account." };
  }
  try {
    await assertCanAccessLead(user, input.leadId);
  } catch {
    return { ok: false, error: "You do not have access to this lead." };
  }

  const lead = await findLeadById(input.leadId);
  if (!lead) {
    return { ok: false, error: "Lead not found." };
  }

  // ── Phase 0: deterministic contact + site copy ──
  const job: WritableJobPatch = {};
  if (lead.name?.trim()) job.clientNames = lead.name.trim();
  if (lead.email?.trim()) job.clientEmail = lead.email.trim();
  if (lead.phone?.trim()) job.clientPhone = lead.phone.trim();
  // Lead.location is often a suburb, not a full street address — a starting
  // point the estimator refines, not a contract-grade address.
  if (lead.location?.trim()) job.siteAddress = lead.location.trim();

  // ── Build the AI context from the sales conversation ──
  const sources: string[] = [];
  const contextParts: string[] = [];

  contextParts.push(
    `# Lead\nName: ${lead.name}\nLocation/site: ${lead.location || "(not given)"}\nBuild type interest: ${lead.type || "(not given)"}\nBudget: ${lead.budget || "(not given)"}`,
  );

  if (lead.notes?.trim()) {
    sources.push("sales notes");
    contextParts.push(`# Sales notes\n${lead.notes.trim()}`);
  }

  const emails = (lead.emails ?? []).slice(0, 8);
  if (emails.length > 0) {
    sources.push(
      `${emails.length} email${emails.length === 1 ? "" : "s"}`,
    );
    const emailBlock = emails
      .map((email) => {
        const body = stripToText(email.body).slice(0, 1500);
        return `From: ${email.emailFrom}\nSubject: ${email.subject}\n${body}`;
      })
      .join("\n---\n");
    contextParts.push(`# Email conversation (most recent first)\n${emailBlock}`);
  }

  const history = (lead.history ?? [])
    .filter((entry) => entry.detail?.trim())
    .slice(-8);
  if (history.length > 0) {
    sources.push("activity history");
    const historyBlock = history
      .map((entry) => `- ${entry.action}: ${entry.detail}`)
      .join("\n");
    contextParts.push(`# Recent activity\n${historyBlock}`);
  }

  // Nothing to infer from beyond the deterministic contact copy.
  if (sources.length === 0) {
    return {
      ok: true,
      job,
      draft: {},
      sources: ["contact details"],
      confidence: null,
      notes:
        "No sales notes, emails or activity to draft from — filled contact details only.",
    };
  }

  // ── Phase 1: AI draft ──
  const draft: WritableDraftPatch = {};
  let confidence: OfferPrefillDraft["confidence"] | null = null;
  let notes = "";

  const ai = await generateOfferPrefillDraft(contextParts.join("\n\n"));
  if (ai.ok) {
    const d = ai.draft;
    if (d.buildType.trim()) job.buildType = d.buildType.trim();
    // The schema constrains facade to a valid option or "" (no guess).
    if (d.facade) job.facade = d.facade;
    const scope = d.buildScope
      .map((bullet) => bullet.trim())
      .filter(Boolean);
    if (scope.length > 0) job.buildScope = scope;
    if (d.introText.trim()) draft.introText = d.introText.trim();
    confidence = d.confidence;
    notes = d.notesForEstimator?.trim() ?? "";
  } else {
    notes = `AI drafting was skipped (${ai.message}). Filled contact details only.`;
  }

  return { ok: true, job, draft, sources, confidence, notes };
}

// Lead email bodies may be HTML; reduce to readable text for the prompt.
function stripToText(body: string): string {
  return body
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}
