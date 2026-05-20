import type { ApiSuccessResponse } from '@/utils/validators';
import { HistoryItem, Lead, LeadsStats } from './types';

export interface LeadHistoryInput extends Pick<HistoryItem, 'action' | 'detail' | 'type'> {
  actionDate: string;
}

export type LeadCreatePayload = Omit<Lead, 'id' | 'created' | 'history' | 'type'> & {
  type?: string | string[];
  history?: LeadHistoryInput[];
};

/**
 * Service for fetching and managing leads data
 * This is structured to easily swap dummy data with backend API calls
 * Just replace the function bodies with API calls when backend is ready
 */

// ── Fetch all leads ──

export async function fetchLeads(): Promise<Lead[]> {
  const response = await fetch('/api/leads', {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch leads');
  }

  const payload = (await response.json()) as
    | ApiSuccessResponse<Lead[]>
    | { success: false; error?: string };

  if (!payload.success) {
    throw new Error(payload.error ?? 'Failed to fetch leads');
  }

  return payload.data;
}

export async function fetchLead(id: number): Promise<Lead | null> {

  const leads = await fetchLeads();
  return leads.find(lead => lead.id === id) || null;
}

export async function fetchLeadsStats(): Promise<LeadsStats> {
  // TODO: Replace with actual API call
  // const response = await fetch('/api/leads/stats');
  // return response.json();

  const leads = await fetchLeads();

  const isConverted = (stage: string) => stage === 'Won' || stage === 'Converted';
  const isLost = (stage: string) => stage === 'Lost' || stage === 'Cancelled' || stage === 'Disqualified';

  const stats: LeadsStats = {
    total: leads.length,
    new: leads.filter(l => l.stage === 'New').length,
    contacted: leads.filter(l => l.stage === 'Contacted').length,
    qualified: leads.filter(l => l.stage === 'Qualified').length,
    conversion: leads.filter(l => isConverted(l.stage)).length,
    pendingFollowup: leads.filter(l => !isConverted(l.stage) && !isLost(l.stage)).length,
    lost: leads.filter(l => isLost(l.stage)).length,
  };

  return Promise.resolve(stats);
}

export async function createLead(leadData: LeadCreatePayload): Promise<Lead> {
  const response = await fetch('/api/leads', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(leadData),
  });

  if (!response.ok) {
    throw new Error('Failed to create lead');
  }

  const payload = (await response.json()) as
    | ApiSuccessResponse<Lead>
    | { success: false; error?: string };

  if (!payload.success) {
    throw new Error(payload.error ?? 'Failed to create lead');
  }

  return payload.data;
}

export async function updateLead(id: number, updates: Partial<Lead>): Promise<Lead | null> {
  const response = await fetch(`/api/leads/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    throw new Error('Failed to update lead');
  }

  const payload = (await response.json()) as
    | ApiSuccessResponse<Lead>
    | { success: false; error?: string };

  if (!payload.success) {
    throw new Error(payload.error ?? 'Failed to update lead');
  }

  return payload.data;
}

export async function deleteLead(id: number): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`/api/leads/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error('Failed to delete lead');
  }

  const payload = (await response.json()) as
    | ApiSuccessResponse<{ success: boolean; message: string }>
    | { success: false; error?: string };

  if (!payload.success) {
    throw new Error(payload.error ?? 'Failed to delete lead');
  }

  return payload.data;
}

export async function sendEmailToLead(to: string, subject: string, body: string): Promise<boolean> {
  try {
    const response = await fetch('/api/graph/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, subject, body }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      console.error('Failed to send email via Graph API', data ?? response.statusText);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Failed to send email via Graph API', error);
    return false;
  }
}
