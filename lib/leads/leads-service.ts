import type { ApiSuccessResponse } from '@/utils/validators';
import { HistoryItem, Lead, LeadsStats } from './types';
import { fetchJson } from '@/utils/fetch';
import { PaginatedLeadsResult } from '../data/leads';

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

export async function fetchLeads(): Promise<PaginatedLeadsResult> {
  const data = await fetchJson<PaginatedLeadsResult>(
    `/api/leads?q=&limit=100`, // Fetch all leads without filtering
    { method: "GET", cache: 'no-store' },
    "Failed to fetch leads",
  )

  if (!data.success) {
    throw new Error('Failed to fetch leads');
  }

  return data.data;
}

export async function fetchLead(id: number): Promise<Lead | null> {

  const { items: leads } = await fetchLeads();
  return leads.find(lead => lead.id === id) || null;
}

export async function fetchLeadsStats(): Promise<LeadsStats> {
  // TODO: Replace with actual API call
  // const response = await fetch('/api/leads/stats');
  // return response.json();

  const { items: leads } = await fetchLeads();

  const isConverted = (stage: string) => stage === 'Won' || stage === 'Converted';
  const isLost = (stage: string) => stage === 'Lost' || stage === 'Cancelled' || stage === 'Disqualified';

  const stats: LeadsStats = {
    total: leads.length,
    new: leads.filter(l => l.stage === 'New').length,
    contacted: leads.filter(l => l.stage === 'Contacted').length,
    qualified: leads.filter(l => l.stage === 'Qualified').length,
    conversion: leads.filter(l => isConverted(l.stage)).length,
    pendingFollowup: leads.filter(l => l.stage == 'In Follow-up').length,
    lost: leads.filter(l => isLost(l.stage)).length,
  };

  return Promise.resolve(stats);
}

export async function createLead(leadData: LeadCreatePayload): Promise<Lead> {
  const response = await fetchJson<Lead>(
    '/api/leads',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(leadData),
    },
    'Failed to create lead'
  );

  const payload = response.data;

  return payload;
}

export async function updateLead(id: number, updates: Partial<Lead>): Promise<Lead | null> {
  const response = await fetchJson<Lead>(
    `/api/leads/${id}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    },
    'Failed to update lead'
  );

  const payload = response.data;

  return payload;
}

export async function deleteLead(id: number): Promise<{ success: boolean; message: string }> {
  const response = await fetchJson<{ success: boolean; message: string }>(
    `/api/leads/${id}`,
    {
      method: 'DELETE',
    },
    'Failed to delete lead'
  );

  const payload = response.data;

  return payload;
}


export async function sendEmailToLead(to: string, subject: string, body: string): Promise<boolean> {
  try {

    //  const headers: Record<string, string> = {
    //   'Content-Type': 'application/json',
    // };

    // const token = process.env.NEXT_PUBLIC_GRAPH_ADMIN_TOKEN;
    //  console.log('Graph admin token for sending email:', token);
    // ✅ Add the token to Authorization header
    // if (token) {
    //   headers['x-graph-admin-token'] = token;
    // }

    const response = await fetchJson(
      '/api/graph/send',
      {
        method: 'POST',
        // headers,
        body: JSON.stringify({ to, subject, body }),
      },
      'Failed to send email via Graph API'
    );

    return response.success;
  } catch (error) {
    console.error('Failed to send email via Graph API', error);
    return false;
  }
}
