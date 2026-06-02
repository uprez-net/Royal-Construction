import { EmailTemplate } from './types';

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 1, //welcome-email.tsx
    subject: 'Welcome to Royal Constructions - Book Your Builder Appointment',
    category: 'Welcome',
  },
  {
    id: 2, //quotation-email.tsx
    subject: 'Your Personalized Quotation - {project}',
    category: 'Quotation',
  },
  {
    id: 3, //follow-up-email.tsx
    subject: 'Follow-up: Next Steps for Your {type} Project',
    category: 'Follow-up',
  },
  {
    id: 4, //material-catalogue-email.tsx
    subject: 'Material Catalogue - Choose Your Finishes',
    category: 'Catalogue',
  },
  {
    id: 5, //variation-quote-email.tsx
    subject: 'Variation Quote - {project} Update',
    category: 'Variation',
  },
  {
    id: 6, //special-offer-email.tsx
    subject: 'Special Offer - Exclusive Discount for BuildPro Clients',
    category: 'Promotion',
  },
  {
    id: 7,
    subject: 'Site Visit Confirmation - {location}',
    category: 'Meeting',
  },
  {
    id: 8, //project-update-email.tsx
    subject: 'Project Update - Milestone Completed at {location}',
    category: 'Update',
  },
  {
    id: 9, //portfolio-email.tsx
    subject: 'Royal Constructions - Our Builder Profile & Project Portfolio',
    category: 'Portfolio',
  },
];
