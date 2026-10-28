import { notFound } from "next/navigation";
import { NewOfferWorkspace } from "@/components/offers/new-workflow/new-offer-workspace";
import { buildAdminOfferPrefill } from "@/lib/offer/admin-offer-prefill";
import { getAdminOfferContent } from "@/lib/data/admin-offer-content";
import { authorizeLeadAccess } from "@/lib/data/offer-access";
import prisma from "@/lib/prisma";
import type { Metadata } from "next";

const DESCRIPTION =
  "Costing, pricing, tender and contract workspace for a lead's building offer.";

function parseLeadId(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

// Every offer tab used to read "Offer Workspace", so two open offers could not
// be told apart. The client name does that. Reading params and the session
// defers this to request time, so the build never queries for it. The name is
// shown only to a user the workspace itself would let in (loadActiveOfferWorkspace
// runs the same authorizeLeadAccess); anyone else sees just the id in the URL.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ leadId: string }>;
}): Promise<Metadata> {
  const { leadId } = await params;
  const parsedLeadId = parseLeadId(leadId);
  if (parsedLeadId === null) {
    return { title: "Offer not found", description: DESCRIPTION };
  }

  const fallback = `Lead #${parsedLeadId} — Offer`;
  try {
    const access = await authorizeLeadAccess(parsedLeadId);
    if (!access.ok) {
      return { title: fallback, description: DESCRIPTION };
    }
    // Name only: nothing else on this server render reads the lead (the
    // workspace loads from the client), so findLeadById's history, emails and
    // files would be fetched on every open just for a tab title.
    const lead = await prisma.lead.findUnique({
      where: { id: parsedLeadId },
      select: { name: true },
    });
    return {
      title: lead?.name ? `${lead.name} — Offer` : fallback,
      description: DESCRIPTION,
    };
  } catch (error) {
    // A tab title is not worth failing the page over; the workspace reports
    // its own load errors.
    console.error("[offer] tab title lookup failed:", error);
    return { title: fallback, description: DESCRIPTION };
  }
}

// The offer experience for a lead IS the new-workflow workspace (ADR 0002).
// The workspace self-provisions its Offer row via loadActiveOfferWorkspace, so
// no offer needs to exist beforehand. Admin pre-fill content (cost schedule,
// allowances, exclusions, document copy) is fetched server-side and passed as
// the initial state seed; if a saved offer already exists it overrides these
// defaults on load.
export default async function OfferWorkspacePage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;
  const parsedLeadId = parseLeadId(leadId);
  if (parsedLeadId === null) {
    notFound();
  }
  // The admin defaults are read under the system principal, so this page is
  // what decides whether the caller sees them for this lead.
  const access = await authorizeLeadAccess(parsedLeadId);
  if (!access.ok) {
    notFound();
  }

  const adminPrefill = buildAdminOfferPrefill(await getAdminOfferContent());

  return (
    <NewOfferWorkspace leadId={parsedLeadId} adminPrefill={adminPrefill} />
  );
}
