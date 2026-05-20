import { EmailTemplate } from './types';

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 1,
    subject: 'Welcome to BuildPro - Your Home Building Journey Starts Here',
    category: 'Welcome',
    body: `Dear {name},

Thank you for choosing BuildPro for your home building project in NSW. We are excited to partner with you on this journey.

Here is what happens next:
1. We will schedule a detailed consultation to understand your requirements
2. Our team will prepare a personalized quotation
3. You will receive access to our client portal for real-time updates

Our team will be in touch within 24 hours to arrange your first consultation.

Warm regards,
Guri Singh
BuildPro NSW`,
  },
  {
    id: 2,
    subject: 'Your Personalized Quotation - {project}',
    category: 'Quotation',
    body: `Dear {name},

Please find attached your personalized quotation for {project} at {location}.

Quote Summary:
- Project Type: {type}
- Total Cost: {amount}
- Estimated Duration: {duration}

To proceed, please:
1. Review the attached quotation
2. Click the APPROVE button in the email
3. Upload the signed copy using the upload link

This quote is valid for 14 days from the date of this email.

Kind regards,
Guri Singh
BuildPro NSW`,
  },
  {
    id: 3,
    subject: 'Follow-up: Next Steps for Your {type} Project',
    category: 'Follow-up',
    body: `Dear {name},

I wanted to follow up on our recent conversation regarding your {type} project at {location}.

During our last call, we discussed:
{notes}

I would love to answer any questions you might have and help move things forward. Would you be available for a quick call this week?

Best regards,
Guri Singh
BuildPro NSW
{phone}`,
  },
  {
    id: 4,
    subject: 'Material Catalogue - Choose Your Finishes',
    category: 'Catalogue',
    body: `Dear {name},

As discussed, please find below the link to our material catalogue where you can select your preferred finishes:

- Bricks and External Cladding
- Slab and Foundation Options
- Roofing Materials
- Internal Fixtures and Fittings
- Kitchen and Bathroom Selections

Please make your selections and we will update your quotation if any variations apply.

Kind regards,
Guri Singh
BuildPro NSW`,
  },
  {
    id: 5,
    subject: 'Variation Quote - {project} Update',
    category: 'Variation',
    body: `Dear {name},

Following your recent selections from our catalogue, there are some variations to the original quotation for {project}.

Variation Summary:
- Original Quote: {originalAmount}
- Variation Amount: {variationAmount}
- Revised Total: {revisedAmount}

Please review and approve by clicking the button below. As before, a signed copy is required.

Kind regards,
Guri Singh
BuildPro NSW`,
  },
  {
    id: 6,
    subject: 'Special Offer - Exclusive Discount for BuildPro Clients',
    category: 'Promotion',
    body: `Dear {name},

As a valued BuildPro enquiry, we are pleased to offer you an exclusive upgrade package:

- FREE premium kitchen upgrade (value $8,500)
- Complimentary landscaping consultation
- Priority scheduling for your project

This offer is available if you confirm within the next 7 days.

Let's discuss how we can make your dream home even better.

Warm regards,
Guri Singh
BuildPro NSW`,
  },
  {
    id: 7,
    subject: 'Site Visit Confirmation - {location}',
    category: 'Meeting',
    body: `Dear {name},

This confirms your site visit scheduled for:

Date: {date}
Time: {time}
Location: {location}

What to expect:
- Site assessment by our team
- Measurement taking
- Initial design discussion
- Q and A session

Please ensure someone is available at the site during the scheduled time.

Kind regards,
Guri Singh
BuildPro NSW`,
  },
  {
    id: 8,
    subject: 'Project Update - Milestone Completed at {location}',
    category: 'Update',
    body: `Dear {name},

Great news! Your project at {location} has reached an important milestone:

Milestone: {milestone}
Completion Date: {date}

Photo updates are available on your client portal. The next milestone is scheduled for {nextMilestone}.

If you have any questions, do not hesitate to reach out.

Kind regards,
Guri Singh
BuildPro NSW`,
  },
];