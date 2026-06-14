import { EmailTemplate } from './types';

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 1, //welcome-email.tsx
    subject: 'Welcome {name} - next step for your {type} in {location}',
    category: 'Welcome',
  },
  {
    id: 2, //quotation-email.tsx
    subject: 'Quotation next steps for {name} - {project} ({amount})',
    category: 'Quotation',
  },
  {
    id: 3, //follow-up-email.tsx
    subject: 'Following up on your {type} in {location} - {followup}',
    category: 'Follow-up',
  },
  {
    id: 4, //material-catalogue-email.tsx
    subject: 'Finishes catalogue for your {type} in {location}',
    category: 'Catalogue',
  },
  {
    id: 5, //variation-quote-email.tsx
    subject: 'Variation update for {name} - {project}',
    category: 'Variation',
  },
  {
    id: 6, //special-offer-email.tsx
    subject: '{name}, a Royal Constructions offer for your {type}',
    category: 'Promotion',
  },
  {
    id: 7,
    subject: 'Site visit for {name} - {location} on {followup}',
    category: 'Meeting',
  },
  {
    id: 8, //project-update-email.tsx
    subject: '{project} update - {milestone}',
    category: 'Update',
  },
  {
    id: 9, //portfolio-email.tsx
    subject: 'Royal Constructions portfolio for your {type} in {location}',
    category: 'Portfolio',
  },
];
