"use server";

import { render } from "@react-email/components";
import FollowUpEmail from "@/lib/graph/Email/follow-up-email";
import WelcomeEmail from "@/lib/graph/Email/welcome-email";
import QuotationEmail from "@/lib/graph/Email/quotation-email";
import SiteVisitEmail from "@/lib/graph/Email/site-visit-email";
import SpecialOfferEmail from "@/lib/graph/Email/special-offer-email";
import VariationQuoteEmail from "@/lib/graph/Email/variation-quote-email";
import ProjectUpdateEmail from "@/lib/graph/Email/project-update-email";
import MaterialCatalogueEmail from "@/lib/graph/Email/material-catalogue-email";
import PortfolioEmail from "@/lib/graph/Email/portfolio-email";
import { LeadEmailContext } from "@/lib/graph/Email/email-lead-context";
import { resolveLeadNotesTextOr } from "@/lib/leads/notes-text";
import { signBookConsultationToken } from "@/lib/leads/book-consultation-token";
import { authorizeLeadAccess } from "@/lib/data/offer-access";

interface LeadPreview {
  id: number;
  name?: string;
  type?: string | string[];
  location?: string;
  notes?: string;
  budget?: string;
  email?: string;
  source?: string;
  sourceDetail?: string;
  stage?: string;
  followupDate?: string | null;
  followupTime?: string | null;
  assignedUser?: { name?: string | null } | null;
}

function formatLeadDate(date: string | null | undefined) {
  if (!date) return undefined;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export async function renderEmailHtml(
  category: string,
  lead: LeadPreview | null,
  /**
   * A booking token the caller already minted, for server-side senders that
   * have no Clerk session. See where it is used below for why passing one in
   * is safe. Omit it from the browser: the action will authorise and mint.
   */
  bookingToken?: string | null,
) {
  const name = lead?.name ?? "Homeowner";
  const type = Array.isArray(lead?.type)
    ? (lead.type[0] ?? "New Home Build")
    : (lead?.type ?? "New Home Build");
  const location = lead?.location ?? "NSW";
  const notes = resolveLeadNotesTextOr(
    lead,
    "Discussed initial design preferences and project scope.",
  );
  const project = `${type} at ${location}`;
  const amount =
    lead?.budget && lead.budget !== "Not Discussed" ? lead.budget : "TBD";
  const today = new Date().toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const followupDate = formatLeadDate(lead?.followupDate);
  const followup = followupDate
    ? followupDate + (lead?.followupTime ? ` at ${lead.followupTime}` : "")
    : undefined;
  const leadContext: LeadEmailContext = {
    projectType: type,
    location,
    source: lead?.sourceDetail || lead?.source,
    stage: lead?.stage,
    budget: lead?.budget,
    followup,
    assignee: lead?.assignedUser?.name ?? undefined,
    notes,
  };
  let component: React.ReactElement | null = null;

  let bookingUrl =
    "https://royal-construction-chi.vercel.app/book-consultation";
  if (lead?.email) {
    const params = new URLSearchParams({
      name: lead.name ?? name,
      email: lead.email,
      id: String(lead.id),
    });
    // A token supplied by the caller is used as given; otherwise this mints
    // one, and only for a lead the caller is allowed to open.
    //
    // The authorisation matters because this is a Server Action: every export
    // of a "use server" module is a POST endpoint that runs with whatever
    // arguments the sender chooses, and `LeadPreview` is a bare interface
    // erased at runtime, so `lead` is unvalidated caller input. Minting
    // unconditionally turned this into an oracle for a 60-day credential the
    // public booking route accepts as proof of ownership — the exact guard it
    // was added to support. tests/security/use-server-auth.test.ts had exempted
    // this export as one that "reads no stored data"; minting made that untrue,
    // so the exemption is gone.
    //
    // Accepting a token as an argument is NOT a hole: a caller can only pass a
    // token it already holds, and holding one is what the check would grant.
    // It exists for the senders that legitimately have no session — the
    // inbound-lead webhook and createLead's welcome email both run with no
    // Clerk user, so authorising there would silently strip the token and the
    // client would meet a 403 on the booking link in their own welcome email.
    const token =
      bookingToken ??
      ((await authorizeLeadAccess(lead.id)).ok
        ? signBookConsultationToken(lead.id)
        : null);
    if (token) {
      params.set("bookingToken", token);
    }
    bookingUrl += `?${params.toString()}`;
  }

  switch (category) {
    case "Follow-up":
      component = (
        <FollowUpEmail
          name={name}
          type={type}
          location={location}
          notes={notes}
          scheduleCallUrl={bookingUrl}
          leadContext={leadContext}
        />
      );
      break;
    case "Welcome":
      component = (
        <WelcomeEmail
          name={name}
          bookingUrl={bookingUrl}
          leadContext={leadContext}
        />
      );
      break;
    case "Quotation":
      component = (
        <QuotationEmail
          clientName={name}
          projectName={project}
          location={location}
          totalAmount={amount}
          validityPeriod="6-8 months"
          leadContext={leadContext}
        />
      );
      break;
    case "Meeting":
      component = (
        <SiteVisitEmail
          name={name}
          date={followupDate ?? today}
          time={lead?.followupTime || "10:00 AM"}
          location={location}
          leadContext={leadContext}
        />
      );
      break;
    case "Promotion":
      component = (
        <SpecialOfferEmail
          name={name}
          savingsAmount="$15,000"
          leadContext={leadContext}
        />
      );
      break;
    case "Variation":
      component = (
        <VariationQuoteEmail
          name={name}
          project={project}
          originalAmount="$480,000"
          variationAmount="$4,500"
          revisedAmount="$484,500"
          leadContext={leadContext}
        />
      );
      break;
    case "Update":
      component = (
        <ProjectUpdateEmail
          name={name}
          location={location}
          milestone="Foundation Complete"
          date={today}
          nextMilestone="Frame Stage"
          leadContext={leadContext}
        />
      );
      break;
    case "Catalogue":
      component = (
        <MaterialCatalogueEmail name={name} leadContext={leadContext} />
      );
      break;
    case "Portfolio":
      component = <PortfolioEmail name={name} leadContext={leadContext} />;
      break;
    default:
      return "";
  }

  if (!component) return "";

  try {
    // This runs securely on the server where react-dom/server is available
    return render(component, { pretty: true });
  } catch (error) {
    console.error("Failed to render email template:", error);
    return `<!DOCTYPE html><html><body style="color:red;padding:20px;">Error rendering email preview.</body></html>`;
  }
}
