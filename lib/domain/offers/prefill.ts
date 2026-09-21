import { authorizeLead } from "../access/leads";
import type { DomainDb } from "../db";
import { DomainNotFoundError } from "../errors";
import type { OfferPrefillAiPort } from "../ports/offer-prefill-ai";
import type { DomainPrincipal } from "../principal";
import { resolveLeadNotesText } from "@/lib/leads/notes-text";
import {
  deriveOwnerProjection,
  ownersFromLegacyClientFields,
  type OfferDocumentDraft,
  type OfferWorkspaceJob,
} from "@/lib/offer/workspace-model";
import type { OfferPrefillDraft } from "@/lib/offer/offer-prefill-ai";

type WritableJobPatch = {
  -readonly [K in keyof OfferWorkspaceJob]?: OfferWorkspaceJob[K];
};
type WritableDraftPatch = {
  -readonly [K in keyof OfferDocumentDraft]?: OfferDocumentDraft[K];
};

export type OfferPrefillResult =
  | {
      readonly ok: true;
      readonly job: Partial<OfferWorkspaceJob>;
      readonly draft: Partial<OfferDocumentDraft>;
      readonly sources: string[];
      readonly confidence: OfferPrefillDraft["confidence"] | null;
      readonly notes: string;
    }
  | { readonly ok: false; readonly error: string };

export async function generateOfferPrefill(
  principal: DomainPrincipal,
  leadId: number,
  db: DomainDb,
  ai: OfferPrefillAiPort,
): Promise<OfferPrefillResult> {
  await authorizeLead(principal, leadId, db);
  const lead = await db.lead.findUnique({
    select: {
      budget: true,
      email: true,
      emails: {
        orderBy: { sentAt: "desc" },
        select: { body: true, emailFrom: true, subject: true },
        take: 8,
      },
      history: {
        orderBy: { actionDate: "asc" },
        select: { action: true, detail: true },
      },
      location: true,
      name: true,
      notes: true,
      notesDoc: true,
      phone: true,
      secondaryEmail: true,
      secondaryName: true,
      type: true,
    },
    where: { id: leadId },
  });
  if (!lead) throw new DomainNotFoundError("Lead not found.");

  const job: WritableJobPatch = {};
  const owners = ownersFromLegacyClientFields({
    clientEmail: lead.email?.trim() ?? "",
    clientNames: lead.name.trim(),
    clientPhone: lead.phone?.trim() ?? "",
    secondaryCustomerEmail: lead.secondaryEmail?.trim() ?? "",
    secondaryCustomerName: lead.secondaryName?.trim() ?? "",
  });
  const projection = deriveOwnerProjection(owners);
  Object.assign(job, projection, { owners });
  if (lead.location?.trim()) job.siteAddress = lead.location.trim();

  const sources: string[] = [];
  const contextParts = [
    `# Lead\nName: ${lead.name}${lead.secondaryName ? ` & ${lead.secondaryName}` : ""}\nLocation/site: ${lead.location || "(not given)"}\nBuild type interest: ${lead.type.join(", ") || "(not given)"}\nBudget: ${lead.budget || "(not given)"}`,
  ];
  const salesNotes = resolveLeadNotesText(lead);
  if (salesNotes) {
    sources.push("sales notes");
    contextParts.push(`# Sales notes\n${salesNotes}`);
  }
  if (lead.emails.length > 0) {
    sources.push(
      `${lead.emails.length} email${lead.emails.length === 1 ? "" : "s"}`,
    );
    contextParts.push(
      `# Email conversation (most recent first)\n${lead.emails
        .map(
          (email) =>
            `From: ${email.emailFrom}\nSubject: ${email.subject}\n${stripToText(email.body).slice(0, 1500)}`,
        )
        .join("\n---\n")}`,
    );
  }
  const recentHistory = lead.history
    .filter((entry) => entry.detail.trim())
    .slice(-8);
  if (recentHistory.length > 0) {
    sources.push("activity history");
    contextParts.push(
      `# Recent activity\n${recentHistory
        .map((entry) => `- ${entry.action}: ${entry.detail}`)
        .join("\n")}`,
    );
  }
  if (sources.length === 0) {
    return {
      confidence: null,
      draft: {},
      job,
      notes:
        "No sales notes, emails or activity to draft from — filled contact details only.",
      ok: true,
      sources: ["contact details"],
    };
  }

  const draft: WritableDraftPatch = {};
  let confidence: OfferPrefillDraft["confidence"] | null = null;
  let notes = "";
  const generated = await ai(contextParts.join("\n\n"));
  if (generated.ok) {
    const value = generated.draft;
    if (value.buildType.trim()) job.buildType = value.buildType.trim();
    if (value.facade) job.facade = value.facade;
    const scope = value.buildScope.map((line) => line.trim()).filter(Boolean);
    if (scope.length > 0) job.buildScope = scope;
    if (value.introText.trim()) draft.introText = value.introText.trim();
    job.bathrooms = value.numberOfBathrooms;
    job.bedrooms = value.numberOfBedrooms;
    job.garageSpaces = value.numberOfGarageSpaces;
    job.showerCount = value.numberOfShowers;
    confidence = value.confidence;
    notes = value.notesForEstimator?.trim() ?? "";
  } else {
    notes = `AI drafting was skipped (${generated.message}). Filled contact details only.`;
  }
  return { confidence, draft, job, notes, ok: true, sources };
}

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
