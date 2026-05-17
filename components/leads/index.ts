export { default as Leads } from './leads';
export type { Lead, LeadStage, LeadSource, BudgetRange, ProjectType, LeadsStats, HistoryItem } from '@/lib/types';
export { dummyLeads } from '@/lib/dummy-data';
export { fetchLeads, fetchLead, fetchLeadsStats, createLead, updateLead, deleteLead } from '@/lib/leads-service';
