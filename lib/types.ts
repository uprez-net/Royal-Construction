export type LeadStage = 'New' | 'Contacted' | 'Qualified' | 'Quoted' | 'Negotiating' | 'Won' | 'Lost';
export type LeadSource = 'Google Ads' | 'Referral' | 'Facebook Ads' | 'Walk-in' | 'Repeat Client' | 'Website';
export type BudgetRange = 'Not Discussed' | '$200K - $350K' | '$350K - $500K' | '$500K - $700K' | '$700K+';
export type ProjectType = 'Not Specified' | 'New Home' | 'Duplex' | 'Renovation' | 'Granny Flat' | 'Townhouse';

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
  assigned: string | null;
  budget: BudgetRange;
  type: ProjectType;
  notes: string;
  followupDate: string | null;
  followupTime: string | null;
  followupNotes: string;
  lostReason?: string;
  history: HistoryItem[];
  created: string;
  urgent: boolean;
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
  category: string;
  body: string;
}
