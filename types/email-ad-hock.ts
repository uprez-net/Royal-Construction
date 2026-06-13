export interface LinkItem {
  id: string;
  label: string;
  url: string;
}

export interface AttachmentItem {
  id: string;
  label: string;
  url: string;
  mode: 'url' | 'upload'; // New: toggle between URL input and File upload
  isUploading?: boolean;   // New: loading state for the upload
}

export interface EmailTemplate {
  id: number;
  subject: string;
  category: string;
}

export interface EmailAdHocTemplate {
  id: string;
  name: string;
  emailSubject: string;
  htmlUrl: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface FormErrors {
  description?: string;
  links?: { [id: string]: { label?: string; url?: string } };
  attachments?: { [id: string]: { label?: string; url?: string } };
}

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  { id: 1, subject: 'Welcome {name} - next step for your {projectType} in {location}', category: 'Welcome' },
  { id: 2, subject: 'Quotation next steps for {name} - {project} ({amount})', category: 'Quotation' },
  { id: 3, subject: 'Following up on your {projectType} in {location} - {followup}', category: 'Follow-up' },
  { id: 4, subject: 'Finishes catalogue for your {projectType} in {location}', category: 'Catalogue' },
  { id: 5, subject: 'Variation update for {name} - {project}', category: 'Variation' },
  { id: 6, subject: '{name}, a Royal Constructions offer for your {projectType}', category: 'Promotion' },
  { id: 7, subject: 'Site visit for {name} - {location} on {followup}', category: 'Meeting' },
  { id: 8, subject: '{project} update - {milestone}', category: 'Update' },
  { id: 9, subject: 'Royal Constructions portfolio for your {projectType} in {location}', category: 'Portfolio' },
];

export const STEPS = [
  { id: 1, name: 'Compose' },
  { id: 2, name: 'Preview' },
  { id: 3, name: 'Send' },
];

export const generateId = () => Math.random().toString(36).substring(2, 9);

export interface CampaignLead {
  id: number;
  name: string;
  email: string;
  stage: string;
  phone?: string;
  location?: string;
  source?: string | null;
  sourceDetail?: string | null;
  budget?: string | null;
  type?: string[];
  notes?: string | null;
  followupDate?: string | Date | null;
  assignedUser?: {
    id: string;
    name: string;
    email: string;
  } | null;
}