import { authorizeLead } from "../access/leads";
import type { DomainDb } from "../db";
import type { OfferInclusionAiPort } from "../ports/offer-inclusion-ai";
import type { DomainPrincipal } from "../principal";
import type { ConsistencyCheckInput } from "@/lib/offer/inclusion-consistency-ai";

export async function checkOfferLists(
  principal: DomainPrincipal,
  input: ConsistencyCheckInput & { readonly leadId: number },
  db: DomainDb,
  ai: OfferInclusionAiPort,
) {
  await authorizeLead(principal, input.leadId, db);
  return ai.checkConsistency(input);
}

export async function draftOfferHighlights(
  principal: DomainPrincipal,
  input: { readonly leadId: number; readonly scheduled: readonly string[] },
  db: DomainDb,
  ai: OfferInclusionAiPort,
) {
  await authorizeLead(principal, input.leadId, db);
  return ai.draftHighlights(input.scheduled);
}
