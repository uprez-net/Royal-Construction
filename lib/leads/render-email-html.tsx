'use server';

import { render } from '@react-email/components';
import FollowUpEmail from '@/lib/graph/Email/follow-up-email';
import WelcomeEmail from '@/lib/graph/Email/welcome-email';
import QuotationEmail from '@/lib/graph/Email/quotation-email';
import SiteVisitEmail from '@/lib/graph/Email/site-visit-email';
import SpecialOfferEmail from '@/lib/graph/Email/special-offer-email';
import VariationQuoteEmail from '@/lib/graph/Email/variation-quote-email';
import ProjectUpdateEmail from '@/lib/graph/Email/project-update-email';
import MaterialCatalogueEmail from '@/lib/graph/Email/material-catalogue-email';
import PortfolioEmail from '@/lib/graph/Email/portfolio-email';

interface LeadPreview {
  name?: string;
  type?: string | string[];
  location?: string;
  notes?: string;
  budget?: string;
  email?: string;
}

export async function renderEmailHtml(category: string, lead: LeadPreview | null) {
  const name = lead?.name ?? 'Homeowner';
  const type = Array.isArray(lead?.type) ? lead.type[0] ?? 'New Home Build' : lead?.type ?? 'New Home Build';
  const location = lead?.location ?? 'NSW';
  const notes = lead?.notes ?? 'Discussed initial design preferences and project scope.';
  const project = `${type} at ${location}`;
  const amount = (lead?.budget && lead.budget !== 'Not Discussed') ? lead.budget : 'TBD';
  const today = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');

  let component: React.ReactElement | null = null;

  switch (category) {
    case 'Follow-up':
      component = <FollowUpEmail name={name} type={type} location={location} notes={notes} />;
      break;
        case 'Welcome':
      {
        // Point to the frontend page instead of the API route
        let bookingUrl = `${baseUrl}/book-consultation`;
        if (lead?.email) {
          const params = new URLSearchParams({
            name: lead.name ?? name,
            email: lead.email,
          });
          bookingUrl += `?${params.toString()}`;
        } else {
          bookingUrl = `${baseUrl}/contact`; // Fallback
        }

        component = <WelcomeEmail name={name} bookingUrl={bookingUrl} />;
        break;
      }
    case 'Quotation':
      component = <QuotationEmail name={name} project={project} location={location} type={type} amount={amount} duration="6-8 months" />;
      break;
    case 'Meeting':
      component = <SiteVisitEmail name={name} date={today} time="10:00 AM" location={location} />;
      break;
    case 'Promotion':
      component = <SpecialOfferEmail name={name} savingsAmount="$15,000" />;
      break;
    case 'Variation':
      component = <VariationQuoteEmail name={name} project={project} originalAmount="$480,000" variationAmount="$4,500" revisedAmount="$484,500" />;
      break;
    case 'Update':
      component = <ProjectUpdateEmail name={name} location={location} milestone="Foundation Complete" date={today} nextMilestone="Frame Stage" />;
      break;
    case 'Catalogue':
      component = <MaterialCatalogueEmail name={name} />;
      break;
    case 'Portfolio':
      component = <PortfolioEmail name={name} />;
      break;
    default:
      return '';
  }

  if (!component) return '';

  try {
    // This runs securely on the server where react-dom/server is available
    return render(component, { pretty: true });
  } catch (error) {
    console.error('Failed to render email template:', error);
    return `<!DOCTYPE html><html><body style="color:red;padding:20px;">Error rendering email preview.</body></html>`;
  }
}