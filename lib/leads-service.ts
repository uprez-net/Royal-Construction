import { Lead, LeadsStats } from './types';
import { dummyLeads } from './dummy-data';

/**
 * Service for fetching and managing leads data
 * This is structured to easily swap dummy data with backend API calls
 * Just replace the function bodies with API calls when backend is ready
 */

export async function fetchLeads(): Promise<Lead[]> {
  // TODO: Replace with actual API call
  // const response = await fetch('/api/leads');
  // return response.json();

  return Promise.resolve(dummyLeads);
}

export async function fetchLead(id: number): Promise<Lead | null> {
  // TODO: Replace with actual API call
  // const response = await fetch(`/api/leads/${id}`);
  // return response.json();

  const leads = await fetchLeads();
  return leads.find(lead => lead.id === id) || null;
}

export async function fetchLeadsStats(): Promise<LeadsStats> {
  // TODO: Replace with actual API call
  // const response = await fetch('/api/leads/stats');
  // return response.json();

  const leads = await fetchLeads();
  const today = new Date().toISOString().split('T')[0];

  const stats: LeadsStats = {
    total: leads.length,
    new: leads.filter(l => l.stage === 'New').length,
    contacted: leads.filter(l => l.stage === 'Contacted').length,
    qualified: leads.filter(l => l.stage === 'Qualified').length,
    conversion: leads.filter(l => l.stage === 'Won').length,
    pendingFollowup: leads.filter(l => l.stage !== 'Won' && l.stage !== 'Lost').length,
    lost: leads.filter(l => l.stage === 'Lost').length,
  };

  return Promise.resolve(stats);
}

export async function createLead(leadData: Omit<Lead, 'id' | 'created' | 'history'>): Promise<Lead> {
  // TODO: Replace with actual API call
  // const response = await fetch('/api/leads', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify(leadData),
  // });
  // return response.json();

  const newLead: Lead = {
    ...leadData,
    id: Math.max(...dummyLeads.map(l => l.id)) + 1,
    created: new Date().toISOString().split('T')[0],
    history: [
      {
        date: new Date().toISOString().split('T')[0],
        time: new Date().toTimeString().slice(0, 5),
        action: 'Lead created',
        detail: 'Lead manually created',
        type: 'system',
      },
    ],
  };

  return Promise.resolve(newLead);
}

export async function updateLead(id: number, updates: Partial<Lead>): Promise<Lead | null> {
  // TODO: Replace with actual API call
  // const response = await fetch(`/api/leads/${id}`, {
  //   method: 'PATCH',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify(updates),
  // });
  // return response.json();

  const lead = await fetchLead(id);
  if (!lead) return null;

  return Promise.resolve({ ...lead, ...updates });
}

export async function deleteLead(id: number): Promise<boolean> {
  // TODO: Replace with actual API call
  // const response = await fetch(`/api/leads/${id}`, {
  //   method: 'DELETE',
  // });
  // return response.ok;

  return Promise.resolve(true);
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
