"use client";
import { HistoryItem, Lead, LeadNoteAnnotationInput, LeadsStats, LeadStage } from './types';
import { fetchJson } from '@/utils/fetch';
import { findLeadById, getAllLeads, getAnalyticsData, getLeadsStats, handleCalendarFollowup, PaginatedLeadsResult } from '../data/leads';

export interface LeadHistoryInput extends Pick<HistoryItem, 'action' | 'detail' | 'type'> {
  actionDate: string;
}

export interface FetchLeadsParams {
  page?: number;
  limit?: number;
  q?: string;
}

export type LeadCreatePayload = Omit<Lead, 'id' | 'created' | 'history' | 'type' | 'creatingOffer'> & {
  type?: string | string[];
  history?: LeadHistoryInput[];
};

/**
 * Service for fetching and managing leads data
 * This is structured to easily swap dummy data with backend API calls
 * Just replace the function bodies with API calls when backend is ready
 */

// ── Fetch all leads ──
export async function fetchLeadAnalyticsData() {
  return getAnalyticsData();
}

export async function fetchAllLeads(): Promise<Lead[]> {
  const data = await getAllLeads();
  return data;
}

export async function fetchLeads(params: { q?: string; limit?: number; page?: number; status?: LeadStage[] , filterTiming?: string }): Promise<PaginatedLeadsResult> {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.append('q', params.q.trim());
  if (params.limit) query.append('limit', params.limit.toString());
  if (params.page) query.append('page', params.page.toString());
  if (params.status) query.append('status', params.status.join(','));
  if(params.filterTiming) query.append('filterTiming', params.filterTiming);
  const data = await fetchJson<PaginatedLeadsResult>(
    `/api/leads?${query.toString()}`,
    { method: "GET", cache: 'no-store' },
    "Failed to fetch leads",
  )

  if (!data.success) {
    throw new Error('Failed to fetch leads');
  }

  return data.data;
}

export async function fetchLead(id: number): Promise<Lead | null> {
  const lead = await findLeadById(id);
  return lead;
}

export async function fetchLeadsStats(): Promise<LeadsStats> {
  return getLeadsStats();
}

export async function FollowupCalendarCreation(leadName: string, leadEmail: string, followupDate: string, followupTime: string): Promise<string | null> {
  return handleCalendarFollowup({ name: leadName, email: leadEmail } as Lead, followupDate, followupTime);
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

type LeadUpdatePayload = Partial<Lead> & {
  annotationsToCreate?: LeadNoteAnnotationInput[];
};

export async function updateLead(id: number, updates: LeadUpdatePayload): Promise<Lead | null> {
  // console.log('Updating lead with id:', id, 'and updates:', updates);
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
