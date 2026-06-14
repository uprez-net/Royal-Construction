import { LeadEmailContext } from "@/lib/graph/Email/email-lead-context";
import FollowUpEmail from "@/lib/graph/Email/follow-up-email";
import MaterialCatalogueEmail from "@/lib/graph/Email/material-catalogue-email";
import PortfolioEmail from "@/lib/graph/Email/portfolio-email";
import ProjectUpdateEmail from "@/lib/graph/Email/project-update-email";
import QuotationEmail from "@/lib/graph/Email/quotation-email";
import SiteVisitEmail from "@/lib/graph/Email/site-visit-email";
import SpecialOfferEmail from "@/lib/graph/Email/special-offer-email";
import VariationQuoteEmail from "@/lib/graph/Email/variation-quote-email";
import WelcomeEmail from "@/lib/graph/Email/welcome-email";
import { EmailTemplate } from "@/lib/leads/types";
import { render } from "@react-email/components";

export async function handleTemplateHtmlSend(category: EmailTemplate['category'] | string):Promise<string>{
      const leadContext: LeadEmailContext = {
            projectType: "{projectType}", location: "{location}", source: "{source}",
            stage: "{stage}", budget: "{budget}", followup: "{followup}",
            assignee: "{assignedUser}", notes: "{notes}",
      };

      const bookingUrl =
            "https://royal-construction-chi.vercel.app/book-consultation?name={name}&email={email}&id={id}";

      let component: React.ReactElement | null = null;

      switch (category) {
            case 'Follow-up':
                  component = <FollowUpEmail name={"{name}"} type={"{projectType}"} location={"{location}"} notes={"{notes}"} scheduleCallUrl={bookingUrl} leadContext={leadContext} />;
                  break;
            case 'Welcome':
                  component = <WelcomeEmail name={"{name}"} bookingUrl={bookingUrl} leadContext={leadContext} />;
                  break;
            case 'Quotation':
                  component = <QuotationEmail clientName={"{name}"} projectName={"{project \\ Enter your Project name}"} location={"{location}"} totalAmount={"{amount}"} validityPeriod="6-8 months" leadContext={leadContext} />;
                  break;
            case 'Meeting':
                  component = <SiteVisitEmail name={"{name}"} date={"{followupDate}"} time={"{followupTime}"} location={"{location}"} leadContext={leadContext} />;
                  break;
            case 'Promotion':
                  component = <SpecialOfferEmail name={"{name}"} savingsAmount={"$15,000"} leadContext={leadContext} />;
                  break;
            case 'Variation':
                  component = <VariationQuoteEmail name={"{name}"} project={"{project \\ Enter your Project Name}"} originalAmount={"{originalAmount \\ Enter your Original Amount}"} variationAmount={"{variationAmount \\ Add Your Variation Amount}"} revisedAmount={"{revisedAmount}"} leadContext={leadContext} />;
                  break;
            case 'Update':
                  component = <ProjectUpdateEmail name={"{name}"} location={"{location}"} milestone={"{milestone \\ Add Your Milestone}"} date={"{date}"} nextMilestone={"{nextMilestone \\ Add Your Next Milestone}"} leadContext={leadContext} />;
                  break;
            case 'Catalogue':
                  component = <MaterialCatalogueEmail name={"{name}"} leadContext={leadContext} />;
                  break;
            case 'Portfolio':
                  component = <PortfolioEmail name={"{name}"} leadContext={leadContext} />;
                  break;
            default:
                  return '';
      }

      const html = await render(component, { pretty: true });

      return html;
}