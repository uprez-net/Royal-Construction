import { LeadStage as DBLeadStage } from "@prisma/client";

export type LeadStage =
  | 'New'
  | 'Contacted'
  | 'Qualified'
  | 'Quoted'
  | 'Negotiating'
  | 'Won'
  | 'Lost'
  | 'Meeting Scheduled'
  | 'In Follow-up'
  | 'No Response'
  | 'Converted'
  | 'Cancelled'
  | 'Disqualified';
export type LeadSource =
  | 'Google Ads'
  | 'Referral'
  | 'Facebook Ads'
  | 'Walk-in'
  | 'Repeat Client'
  | 'Website'
  | 'Personal'
  | 'Business';
export type BudgetRange = 'Not Discussed' | '$200K - $350K' | '$350K - $500K' | '$500K - $700K' | '$700K+';
export type ProjectType =
  | 'Not Specified'
  | 'New Home'
  | 'Duplex'
  | 'Renovation'
  | 'Granny Flat'
  | 'Townhouse'
  | 'Dual Occupancy'
  | 'Single Storey'
  | 'Double Storey'
  | 'House and Granny'
  | 'Knockdown and rebuild'
  | 'House + land package';

export interface HistoryItem {
  date: string;
  time: string;
  action: string;
  detail: string;
  type: 'system' | 'call' | 'email' | 'referral';
}

export interface Lead {
  id: number;
  name: string;
  phone: string;
  email: string;
  location: string;
  source: LeadSource;
  sourceDetail: string;
  stage: LeadStage;
  assignedId?: string | null;          // <-- NEW: The User ID
  assignedUser?: {                     // <-- NEW: The populated User object from Prisma
    id: string;
    name: string;
    email: string;
  } | null;
  budget: BudgetRange | string;
  type: string;
  notes: string;
  followupDate: string | null;
  followupTime: string | null;
  followupNotes: string;
  lostReason?: string;
  history: HistoryItem[];
  created: string;
  urgent: boolean;
  creatingOffer: boolean;
}

export interface LeadsStats {
  total: number;
  new: number;
  contacted: number;
  qualified: number;
  conversion: number;
  pendingFollowup: number;
  lost: number;
}

export interface EmailTemplate {
  id: number;
  subject: string;
  content?: string;
  category: string;
  body?: string;
}

export const LeadStageToLeadStageDBMapping: Record<LeadStage, DBLeadStage> = {
  New: DBLeadStage.NEW,
  Contacted: DBLeadStage.CONTACTED,
  Qualified: DBLeadStage.QUALIFIED,
  Quoted: DBLeadStage.QUOTED,
  Negotiating: DBLeadStage.NEGOTIATING,
  Won: DBLeadStage.WON,
  Lost: DBLeadStage.LOST,
  "Meeting Scheduled": DBLeadStage.MEETING_SCHEDULED,
  "In Follow-up": DBLeadStage.IN_FOLLOW_UP,
  "No Response": DBLeadStage.NO_RESPONSE,
  Converted: DBLeadStage.CONVERTED,
  Cancelled: DBLeadStage.CANCELLED,
  Disqualified: DBLeadStage.DISQUALIFIED
};