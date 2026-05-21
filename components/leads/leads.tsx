'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  UserPlus,
  CircleCheckBig,
  Clock,
  CircleX,
  Mail,
  Zap,
  Plus,
  Columns3,
  Table2,
  BarChart3,
  X,
  TrendingUp,
  TrendingDown,
  Check,
  Bell,
  Save,
} from 'lucide-react';
import { HistoryItem, Lead, LeadStage, LeadSource, BudgetRange, ProjectType, LeadsStats } from '@/lib/leads/types';
import { createLead, fetchLeads, fetchLeadsStats, sendEmailToLead, updateLead } from '@/lib/leads/leads-service';
import PipelineView from './views/pipeline-view';
import TableView from './views/table-view';
import FollowupsView from './views/followups-view';
import AnalyticsView from './views/analytics-view';
import { EmailTemplate } from '@/lib/leads/types';
import { EMAIL_TEMPLATES } from '@/lib/leads/variables';

type TabType = 'pipeline' | 'table' | 'followups' | 'analytics';

/* ── Simulate lead data ────────────────────── */
const simNames = [
  'Sunita Kaur', 'Andrew Nguyen', 'Gurpreet Nagra', 'Kuldeep Johal',
  'Sarah Mitchell', 'Harjit Bains', 'David Park', 'Amandeep Sidhu',
  'Tom Bradley', 'Navjot Grewal',
];
const simLocations = [
  'Blacktown, NSW', 'Parramatta, NSW', 'Campbelltown, NSW', 'Castle Hill, NSW',
  'Epping, NSW', 'Penrith, NSW', 'Liverpool, NSW', 'Bankstown, NSW',
];
const simKeywords = [
  'builder near me', 'home builder NSW', 'custom home builder',
  'duplex builder Sydney', 'affordable home builder', 'new home construction',
];
let simIndex = 0;
let nextId = 100;

const PLACEHOLDER_PATTERN = /\{([^}]+)\}/g;

function formatShortDate(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function hydrateTemplate(text: string, lead: Lead): string {
  const values: Record<string, string> = {
    name: lead.name,
    location: lead.location,
    type: lead.type,
    phone: lead.phone,
    project: `${lead.type} at ${lead.location}`,
    notes: lead.notes || 'Previous discussion details',
    amount: lead.budget !== 'Not Discussed' ? lead.budget : 'TBD',
    duration: '6-8 months',
    date: formatShortDate(new Date()),
    time: '10:00 AM',
    milestone: 'Foundation Complete',
    nextMilestone: 'Frame Stage',
    originalAmount: '$480,000',
    variationAmount: '$4,500',
    revisedAmount: '$484,500',
  };

  return text.replace(PLACEHOLDER_PATTERN, (_, key) => values[key] ?? `{${key}}`);
}

function buildEmailDraft(template: EmailTemplate) {
  return {
    subject: template.subject,
    body: getTemplateHtml(template),
  };
}

function getTemplateHtml(template: EmailTemplate) {
  const html = template.content?.trim();
  return html ? html : template.body;
}

function previewTemplateText(text: string) {
  return text.replace(PLACEHOLDER_PATTERN, '...');
}

function getTemplateDescription(template: EmailTemplate): string {
  switch (template.category) {
    case 'Welcome':
      return 'Welcome new clients to Royal Constructions. Outlines the initial phases of the home building project, first steps, consultation details, and client portal setup.';
    case 'Quotation':
      return 'Send a professional and customized project quotation. Details the scope of work, budget, itemized breakdowns, and easy next steps for client approval.';
    case 'Follow-up':
      return 'Keep the momentum going with qualified leads. Recaps previous consultations, addresses open questions, and prompts for scheduling next steps.';
    case 'Catalogue':
      return 'Provide clients with our comprehensive finishes and material catalogue. Designed to let clients browse exterior cladding, finishes, and paint selections.';
    case 'Variation':
      return 'Formal project variation summary. Details requested changes, contract adjustments, revised pricing, and options for sign-off.';
    case 'Promotion':
      return 'Offer a special limited-time promotional discount or upgrade bundle to incentivize hot leads to move forward with signing.';
    case 'Meeting':
      return 'Confirm a site meeting or consultant visit details. Includes appointment date, time, location maps, and contact information.';
    case 'Update':
      return 'Auto-generated construction milestone progress update. Informs the client about current status, completed tasks, and upcoming milestones.';
    default:
      return 'Curated and professionally designed email template adhering to brand standards to streamline client communications.';
  }
}

interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  maxWidthClass?: string;
  titleClassName?: string;
  children: React.ReactNode;
}

function ModalShell({
  open,
  onClose,
  title,
  subtitle,
  maxWidthClass = 'max-w-[520px]',
  titleClassName,
  children,
}: ModalShellProps) {
  if (!open) return null;

  const handleBackdropMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0c0a09]/30 p-4"
      onMouseDown={handleBackdropMouseDown}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`flex max-h-[90vh] flex-col w-full ${maxWidthClass} rounded-[16px] bg-white shadow-[0_12px_45px_rgba(17,12,46,0.12)] ring-1 ring-[#e5e7eb]`}
      >
        <div className="shrink-0 flex items-start justify-between gap-3 border-b border-[#e5e7eb] px-5 py-3">
          <div>
            <h4 className={`text-[18px] font-medium tracking-[-0.016px] text-[#0c0a09] ${titleClassName ?? ''}`}>{title}</h4>
            {subtitle ? <p className="mt-1 text-[13px] text-[#a8a29e]">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            className="rounded-full p-1.5 text-[#a8a29e] transition hover:bg-[#fafaf9] hover:text-[#78716c]"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export default function Leads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<LeadsStats | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('pipeline');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [showAddLeadModal, setShowAddLeadModal] = useState(false);
  const [showEmailTemplates, setShowEmailTemplates] = useState(false);
  const [showSendEmail, setShowSendEmail] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const emailBodyRef = React.useRef<HTMLDivElement>(null);

  const [adding, setAdding] = useState(false);
  const [addingWithReminder, setAddingWithReminder] = useState(false);

  // Toast state
  const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'info' }[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [leadsData, statsData] = await Promise.all([
        fetchLeads(),
        fetchLeadsStats(),
      ]);
      setLeads(leadsData);
      setStats(statsData);
      setError(null);
    } catch (err) {
      setError('Failed to load leads data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const recalcStats = useCallback((currentLeads: Lead[]) => {
    const isConverted = (stage: string) => stage === 'Won' || stage === 'Converted';
    const isLost = (stage: string) => stage === 'Lost' || stage === 'Cancelled' || stage === 'Disqualified';

    setStats({
      total: currentLeads.length,
      new: currentLeads.filter(l => l.stage === 'New').length,
      contacted: currentLeads.filter(l => l.stage === 'Contacted').length,
      qualified: currentLeads.filter(l => l.stage === 'Qualified').length,
      conversion: currentLeads.filter(l => isConverted(l.stage)).length,
      pendingFollowup: currentLeads.filter(l => !isConverted(l.stage) && !isLost(l.stage)).length,
      lost: currentLeads.filter(l => isLost(l.stage)).length,
    });
  }, []);

  const handleLeadUpdate = async (
    updatedLead: Lead
  ): Promise<boolean> => {
    const updatedLeadData = await updateLead(updatedLead.id, updatedLead)
    if (updatedLeadData) {
      setLeads(prev => {
        const updated = prev.map(lead => (lead.id === updatedLead.id ? updatedLead : lead));
        recalcStats(updated);
        return updated;
      });
      return true;
    } else {
      return false
    }
  };

  const handleLeadDelete = (leadId: number) => {
    setLeads(prev => {
      const updated = prev.filter(lead => lead.id !== leadId);
      recalcStats(updated);
      return updated;
    });
  };

  const handleNewLead = (newLead: Lead) => {
    setLeads(prev => {
      const updated = [newLead, ...prev];
      recalcStats(updated);
      return updated;
    });
  };

  /* ── Toast helper ────────────────────── */
  const showToast = (message: string, type: 'success' | 'info' = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const openEmailTemplates = () => {
    setShowEmailTemplates(true);
    setSelectedTemplate(null);
    setEmailSubject('');
    setEmailBody('');
  };

  const closeEmailTemplates = () => {
    setShowEmailTemplates(false);
  };

  const closeSendEmail = () => {
    setShowSendEmail(false);
    setSelectedTemplate(null);
  };

  const handleTemplateSelect = (template: EmailTemplate) => {
    const draft = buildEmailDraft(template);
    setSelectedTemplate(template);
    setEmailSubject(draft.subject);
    setEmailBody(draft.body);
    setShowEmailTemplates(false);
    setShowSendEmail(true);
  };

  const handleSendEmail = () => {
    console.log('Sending email with subject:', emailSubject);
    const targets = leads.filter(lead => lead.email);
    if (targets.length === 0) {
      showToast('No leads with email found', 'info');
      return;
    }
    console.log(`Email will be sent to ${targets.length} leads:`, targets.map(t => t.email));
    const now = new Date();
    void (async () => {
      const updated = await Promise.all(
        leads.map(async (lead) => {
          if (!lead.email) return lead;

          const subject = hydrateTemplate(emailSubject, lead);

          const historyEntry: Lead["history"][number] = {
            date: now.toISOString().slice(0, 10),
            time: now.toTimeString().slice(0, 5),
            action: "Email sent",
            detail: `Subject: ${subject}`,
            type: "email",
          };

          console.log(
            `Sending email to ${lead.email} with subject: ${subject}`
          );

          const finalBody = emailBodyRef.current ? emailBodyRef.current.innerHTML : emailBody;
          const sendCampaign = await sendEmailToLead(
            lead.email,
            subject,
            hydrateTemplate(finalBody, lead)
          );

          if (sendCampaign) {
            return {
              ...lead,
              history: [...lead.history, historyEntry],
            };
          }

          console.error(`Failed to send email to ${lead.email}`);

          return lead;
        })
      );

      recalcStats(updated);
      setLeads(updated);
    })();

    showToast(`Email sent to ${targets.length} leads`, 'success');
    closeSendEmail();
  };

  /* ── Simulate New Lead ────────────────── */
  // const simulateNewLead = () => {
  //   const name = simNames[simIndex % simNames.length];
  //   const loc = simLocations[simIndex % simLocations.length];
  //   const kw = simKeywords[simIndex % simKeywords.length];
  //   simIndex++;

  //   const phone = '04' + Math.floor(10000000 + Math.random() * 90000000).toString().replace(/(\d{2})(\d{3})(\d{3})/, '$1 $2 $3');
  //   const today = new Date().toISOString().split('T')[0];

  //   const newLead: Lead = {
  //     id: nextId++,
  //     name,
  //     phone,
  //     email: name.toLowerCase().replace(' ', '.') + '@email.com',
  //     location: loc,
  //     source: 'Google Ads',
  //     sourceDetail: kw,
  //     stage: 'New',
  //     assigned: 'Guri Singh',
  //     budget: 'Not Discussed',
  //     type: 'Not Specified',
  //     notes: `Auto-captured from Google Ads — keyword: "${kw}". Awaiting initial contact.`,
  //     followupDate: today,
  //     followupTime: '10:00',
  //     followupNotes: '',
  //     history: [
  //       {
  //         date: today,
  //         time: new Date().toTimeString().slice(0, 5),
  //         action: 'Lead captured',
  //         detail: `Auto-captured from Google Ads — keyword: ${kw}`,
  //         type: 'system',
  //       },
  //     ],
  //     created: today,
  //     urgent: false,
  //   };

  //   handleNewLead(newLead);
  //   showToast(`New lead auto-captured from Google Ads: ${name}`, 'success');
  //   showToast(`Notification sent: ${name} — ${loc}`, 'info');
  // };

  /* ── Add Lead Submit ────────────────── */
  const submitNewLead = async (formData: AddLeadFormData, setReminder: boolean, sectionRunning: string) => {
    if (sectionRunning === "addingsection") {
      setAdding(true);
    } else if (sectionRunning === "addingwithRemindersection") {
      setAddingWithReminder(true);
    }
    const today = new Date();
    const todayDate = today.toISOString().split('T')[0];
    const historyEntries = formData.historyEntries.map(entry => ({
      action: entry.action.trim() || 'Note',
      detail: entry.detail.trim(),
      type: entry.type,
      actionDate: entry.actionDate || today.toISOString(),
    }));

    const payload = {
      name: formData.name,
      phone: formData.phone,
      email: formData.email,
      location: formData.location,
      source: formData.sourceDetail as LeadSource,
      sourceDetail: formData.sourceDetail,
      stage: formData.stage as LeadStage,
      assigned: formData.assigned,
      budget: formData.budget as BudgetRange,
      type: formData.type.length > 0 ? formData.type : ['Not Specified'],
      notes: formData.notes,
      followupDate: formData.followupDate || null,
      followupTime: formData.followupTime || null,
      followupNotes: '',
      urgent: formData.urgent,
      history: historyEntries,
    };

    try {
      const createdLead = await createLead(payload);
      handleNewLead(createdLead);
      setShowAddLeadModal(false);
      showToast(`Lead added: ${formData.name}`, 'success');
      if (setReminder) {
        showToast(
          `Reminder set for ${formData.followupDate || todayDate} at ${formData.followupTime || '10:00'}`,
          'info'
        );
      }
    } catch (error) {
      console.error(error);
      showToast('Failed to create lead. Please try again.', 'info');
    }
    setAdding(false);
    setAddingWithReminder(false);
  };

  if (error) {
    return (
      <div className="leads-error-container">
        <div className="leads-error-message">{error}</div>
        <button className="btn-primary-custom" onClick={loadData}>
          Try Again
        </button>
      </div>
    );
  }

  const conversionRate = stats && stats.total > 0
    ? ((stats.conversion / stats.total) * 100).toFixed(1)
    : '0.0';
  const emailTargets = leads.filter(lead => lead.email);
  const emailTargetList = emailTargets.map(lead => lead.email).filter(Boolean).join(', ');

  return (
    <div className="leads-container">
      {/* Header */}
      <div className="leads-header">
        <div>
          <h2 className="leads-title">Lead Pipeline</h2>
          <p className="leads-subtitle">
            Google Ads auto-capture • Follow-up automation • Email templates
          </p>
        </div>
        <div className="leads-header-actions">
          <button className="btn-outline-custom" onClick={openEmailTemplates}>
            <Mail size={16} /> Email Templates
          </button>
          {/* <button className="btn-outline-custom" onClick={simulateNewLead}>
            <Zap size={16} /> Simulate New Lead
          </button> */}
          <button className="btn-primary-custom" onClick={() => setShowAddLeadModal(true)}>
            <Plus size={16} /> Add Lead Manually
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      {stats && !loading && (
        <div className="leads-stats-grid">
          <StatsCard
            label="Total Leads"
            value={stats.total}
            icon={UserPlus}
            color="primary"
            trend={18}
            trendDirection="up"
          />
          <StatsCard
            label={`Converted (${conversionRate}%)`}
            value={stats.conversion}
            icon={CircleCheckBig}
            color="success"
            trend={12}
            trendDirection="up"
          />
          <StatsCard
            label="Pending Follow-up"
            value={stats.pendingFollowup}
            icon={Clock}
            color="warning"
          />
          <StatsCard
            label="Lost Leads"
            value={stats.lost}
            icon={CircleX}
            color="danger"
            trend={5}
            trendDirection="down"
          />
        </div>
      )}

      {/* Tab Navigation */}
      <div className="leads-tab-nav">
        <TabButton
          active={activeTab === 'pipeline'}
          onClick={() => setActiveTab('pipeline')}
          icon={Columns3}
        >
          Pipeline View
        </TabButton>
        <TabButton
          active={activeTab === 'table'}
          onClick={() => setActiveTab('table')}
          icon={Table2}
        >
          Table View
        </TabButton>
        <TabButton
          active={activeTab === 'followups'}
          onClick={() => setActiveTab('followups')}
          icon={Clock}
        >
          Follow-ups
        </TabButton>
        <TabButton
          active={activeTab === 'analytics'}
          onClick={() => setActiveTab('analytics')}
          icon={BarChart3}
        >
          Analytics
        </TabButton>
      </div>

      {/* Tab Content */}
      {loading ? (
        <div className="leads-loading">
          <div className="spinner"></div>
          <p>Loading leads...</p>
        </div>
      ) : (
        <>
          {activeTab === 'pipeline' && (
            <PipelineView
              leads={leads}
              onLeadUpdate={handleLeadUpdate}
              onLeadDelete={handleLeadDelete}
            />
          )}
          {activeTab === 'table' && (
            <TableView
              leads={leads}
              onLeadUpdate={handleLeadUpdate}
              onLeadDelete={handleLeadDelete}
            />
          )}
          {activeTab === 'followups' &&
            <FollowupsView
              leads={leads}
              onLeadUpdate={handleLeadUpdate}
              onLeadDelete={handleLeadDelete}
            />}
          {activeTab === 'analytics' && <AnalyticsView leads={leads} />}
        </>
      )}

      {/* ═══ ADD LEAD MODAL ═══ */}
      {showAddLeadModal && (
        <AddLeadModal
          onClose={() => setShowAddLeadModal(false)}
          onSubmit={submitNewLead}
          adding={adding}
          addingwithReminder={addingWithReminder}
        />
      )}

      {/* ═══ EMAIL TEMPLATES MODAL ═══ */}
      <ModalShell
        open={showEmailTemplates}
        onClose={closeEmailTemplates}
        title="Email Templates"
        subtitle="Select a template to send to the leads"
        maxWidthClass="max-w-[720px]"
      >
        <div className="space-y-4">
          <div className="rounded-[10px] border border-[#c1e1f7] bg-[#c1e1f7]/30 px-4 py-3 text-sm text-[#0c0a09]">
            Sending to: <span className="font-medium">{emailTargets.length}</span> leads with email
          </div>
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {EMAIL_TEMPLATES.map(template => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => handleTemplateSelect(template)}
                  className="group rounded-[10px] border border-[#e5e7eb] bg-white p-4 text-left shadow-[rgba(0,0,0,0.05)_0px_1px_2px_0px] transition hover:-translate-y-0.5 hover:border-[#3ba6f1] hover:shadow-[rgba(0,0,0,0.05)_0px_4px_16px_0px]"
                >
                  <div className="text-[11px] font-medium uppercase tracking-[0.048px] text-[#a8a29e]">
                    {template.category}
                  </div>
                  <div className="mt-1 text-[15px] font-medium text-[#0c0a09]">
                    {previewTemplateText(template.subject)}
                  </div>
                  <div className="mt-2 text-xs leading-relaxed text-[#78716c]">
                    {getTemplateDescription(template)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </ModalShell>

      <ModalShell
        open={showSendEmail}
        onClose={closeSendEmail}
        title="Send Email"
        subtitle={`To: ${emailTargets.length} leads with email`}
        maxWidthClass="max-w-[600px]"
      >
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-[#78716c]">To</label>
            <textarea
              className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-[#fafaf9] px-3 py-2 text-sm text-[#78716c]"
              rows={3}
              value={emailTargetList || 'No leads with email'}
              readOnly
            />
          </div>
          {selectedTemplate ? (
            <div className="flex items-center justify-between rounded-[4px] border border-[#e5e7eb] bg-[#fafaf9] px-3 py-2 text-xs text-[#78716c]">
              <span>Template</span>
              <span className="font-medium text-[#0c0a09]">{selectedTemplate.category}</span>
            </div>
          ) : null}
          <p className="text-xs text-[#a8a29e]">
            Placeholders like {'{name}'} and {'{location}'} will be filled per lead.
          </p>
          <div>
            <label className="text-xs font-medium text-[#78716c]">Subject</label>
            <input
              className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#3ba6f1] focus:outline-none focus:ring-2 focus:ring-[#c1e1f7]"
              value={emailSubject}
              onChange={event => setEmailSubject(event.target.value)}
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[#78716c]">Body (HTML Preview)</label>
              <span className="text-[11px] text-[#a8a29e]">Click to edit</span>
            </div>
            <div
              key={selectedTemplate?.id}
              ref={emailBodyRef}
              className="email-html-preview"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              dangerouslySetInnerHTML={{ __html: emailBody }}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[#3ba6f1] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#2b8fd6]"
              onClick={handleSendEmail}
              disabled={!emailSubject.trim() || emailTargets.length === 0}
            >
              <Mail size={14} />
              Send Email
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full border border-[#e5e7eb] px-4 py-2 text-xs font-medium text-[#78716c] transition hover:border-[#c9c5c2] hover:bg-[#fafaf9]"
              onClick={closeSendEmail}
            >
              Cancel
            </button>
          </div>
        </div>
      </ModalShell>

      {/* ═══ TOAST NOTIFICATIONS ═══ */}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map(toast => (
            <div key={toast.id} className={`toast-item toast-${toast.type}`}>
              <div className="toast-icon-wrapper" style={{
                background: toast.type === 'success' ? 'rgba(22,163,74,0.1)' : 'rgba(37,99,235,0.1)',
                color: toast.type === 'success' ? '#16A34A' : '#2563EB',
              }}>
                {toast.type === 'success' ? <Check size={15} /> : <Bell size={15} />}
              </div>
              <span className="toast-msg">{toast.message}</span>
              <button className="toast-close" onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════
   STATS CARD — Redesigned per reference
   ══════════════════════════════════════════════ */
interface StatsCardProps {
  label: string;
  value: number;
  icon: React.ComponentType<{ size: number }>;
  color: 'primary' | 'info' | 'warning' | 'success' | 'danger';
  trend?: number;
  trendDirection?: 'up' | 'down';
}

function StatsCard({ label, value, icon: Icon, color, trend, trendDirection }: StatsCardProps) {
  const colorMap: Record<string, string> = {
    primary: '#3ba6f1',
    info: '#3ba6f1',
    warning: '#F59E0B',
    success: '#16A34A',
    danger: '#DC2626',
  };

  return (
    <div className="stat-card-v2">
      <div className="stat-card-v2-top">
        <div className="stat-card-v2-icon" style={{ backgroundColor: colorMap[color] }}>
          <Icon size={20} />
        </div>
        {trend !== undefined && trendDirection && (
          <span className={`trend-badge trend-${trendDirection}`}>
            {trendDirection === 'up' ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {trend}%
          </span>
        )}
      </div>
      <div className="stat-card-v2-value">{value}</div>
      <div className="stat-card-v2-label">{label}</div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   TAB BUTTON
   ══════════════════════════════════════════════ */
interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ size: number }>;
  children: React.ReactNode;
}

function TabButton({ active, onClick, icon: Icon, children }: TabButtonProps) {
  return (
    <button
      className={`tab-button ${active ? 'active' : ''}`}
      onClick={onClick}
    >
      <Icon size={18} />
      {children}
    </button>
  );
}

/* ══════════════════════════════════════════════
   ADD LEAD MODAL
   ══════════════════════════════════════════════ */
interface AddLeadFormData {
  name: string;
  phone: string;
  email: string;
  location: string;
  sourceDetail: LeadSource;
  stage: LeadStage;
  assigned: string;
  budget: string;
  type: ProjectType[];
  notes: string;
  followupDate: string;
  followupTime: string;
  urgent: boolean;
  historyEntries: HistoryEntryDraft[];
}

interface HistoryEntryDraft {
  action: string;
  detail: string;
  type: HistoryItem['type'];
  actionDate: string;
}

interface AddLeadModalProps {
  onClose: () => void;
  onSubmit: (data: AddLeadFormData, setReminder: boolean, sectionRunning: string) => void;
  adding: boolean;
  addingwithReminder: boolean;
}

const LEAD_SOURCE_OPTIONS: LeadSource[] = [
  'Google Ads',
  'Referral',
  'Facebook Ads',
  'Walk-in',
  'Repeat Client',
  'Website',
  'Personal',
  'Business',
];

const LEAD_STAGE_OPTIONS: LeadStage[] = [
  'New',
  'Contacted',
  'Qualified',
  'Quoted',
  'Negotiating',
  'Won',
  // 'Lost',
  'Meeting Scheduled',
  'In Follow-up',
  'No Response',
  'Converted',
  'Cancelled',
  'Disqualified',
];

const PROJECT_TYPE_OPTIONS: ProjectType[] = [
  'Not Specified',
  'New Home',
  'Duplex',
  'Renovation',
  'Granny Flat',
  'Townhouse',
  'Dual Occupancy',
  'Single Storey',
  'Double Storey',
  'House and Granny',
  'Knockdown and rebuild',
  'House + land package',
];

const HISTORY_TYPE_OPTIONS: HistoryItem['type'][] = [
  'system',
  'call',
  'email',
  'referral',
];

function AddLeadModal({ onClose, onSubmit, adding, addingwithReminder }: AddLeadModalProps) {
  const [form, setForm] = useState<AddLeadFormData>({
    name: '',
    phone: '',
    email: '',
    location: '',
    sourceDetail: 'Google Ads',
    stage: 'New',
    assigned: 'Guri Singh',
    budget: 'Not Discussed',
    type: ['Not Specified'],
    notes: '',
    followupDate: '',
    followupTime: '10:00',
    urgent: false,
    historyEntries: [],
  });

  const [historyDraft, setHistoryDraft] = useState<HistoryEntryDraft>({
    action: '',
    detail: '',
    type: 'system',
    actionDate: '',
  });

  const updateField = (field: keyof AddLeadFormData, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const toggleProjectType = (value: ProjectType) => {
    setForm(prev => {
      const exists = prev.type.includes(value);
      if (value === 'Not Specified') {
        return { ...prev, type: ['Not Specified'] };
      }

      const withoutNotSpecified = prev.type.filter(item => item !== 'Not Specified');
      const next = exists
        ? withoutNotSpecified.filter(item => item !== value)
        : [...withoutNotSpecified, value];

      return { ...prev, type: next.length > 0 ? next : ['Not Specified'] };
    });
  };

  const addHistoryEntry = () => {
    if (!historyDraft.action.trim() && !historyDraft.detail.trim()) {
      return;
    }

    setForm(prev => ({
      ...prev,
      historyEntries: [...prev.historyEntries, { ...historyDraft }],
    }));

    setHistoryDraft({
      action: '',
      detail: '',
      type: 'system',
      actionDate: '',
    });
  };

  const removeHistoryEntry = (index: number) => {
    setForm(prev => ({
      ...prev,
      historyEntries: prev.historyEntries.filter((_, idx) => idx !== index),
    }));
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal-backdrop-custom show" onClick={handleBackdropClick}>
      <div className="modal-content-custom flex max-h-[90vh] flex-col overflow-hidden" style={{ maxWidth: 600 }}>
        <div className="modal-header-custom shrink-0">
          <div>
            <h4 className="modal-title">Add New Lead</h4>
            <p className="modal-subtitle">Manually add a lead to the pipeline</p>
          </div>
          <button className="modal-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body-custom overflow-y-auto">
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Full Name *</label>
              <input
                className="form-input"
                placeholder="e.g. Jaswinder Singh"
                value={form.name}
                onChange={e => updateField('name', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Phone *</label>
              <input
                className="form-input"
                placeholder="e.g. 0412 345 678"
                value={form.phone}
                onChange={e => updateField('phone', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                className="form-input"
                placeholder="e.g. name@email.com"
                type="email"
                value={form.email}
                onChange={e => updateField('email', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Location *</label>
              <input
                className="form-input"
                placeholder="e.g. Blacktown, NSW"
                value={form.location}
                onChange={e => updateField('location', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Source Detail</label>
              <select
                className="form-select-custom"
                value={form.sourceDetail}
                onChange={e => updateField('sourceDetail', e.target.value)}
              >
                {LEAD_SOURCE_OPTIONS.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Stage</label>
              <select
                className="form-select-custom"
                value={form.stage}
                onChange={e => setForm(prev => ({ ...prev, stage: e.target.value as LeadStage }))}
              >
                {LEAD_STAGE_OPTIONS.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Assigned To</label>
              <select
                className="form-select-custom"
                value={form.assigned}
                onChange={e => updateField('assigned', e.target.value)}
              >
                <option>Guri Singh</option>
                <option>Amrit Singh</option>
                <option>Deepak Sharma</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Budget Range</label>
              <select
                className="form-select-custom"
                value={form.budget}
                onChange={e => updateField('budget', e.target.value)}
              >
                <option>Not Discussed</option>
                <option>$200K - $350K</option>
                <option>$350K - $500K</option>
                <option>$500K - $700K</option>
                <option>$700K+</option>
              </select>
            </div>
            <div className="form-group form-group-full">
              <label className="form-label">Project Type</label>
              <div className="checkbox-grid">
                {PROJECT_TYPE_OPTIONS.map(option => (
                  <label
                    key={option}
                    className={`checkbox-item ${form.type.includes(option) ? 'active' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={form.type.includes(option)}
                      onChange={() => toggleProjectType(option)}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="form-group form-group-full">
              <label className="form-label">Notes</label>
              <textarea
                className="form-input form-textarea"
                placeholder="Initial notes about this lead..."
                value={form.notes}
                onChange={e => updateField('notes', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Follow-up Date</label>
              <input
                className="form-input"
                type="date"
                value={form.followupDate}
                onChange={e => updateField('followupDate', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Follow-up Time</label>
              <input
                className="form-input"
                type="time"
                value={form.followupTime}
                onChange={e => updateField('followupTime', e.target.value)}
              />
            </div>
            <div className="form-group form-group-full">
              <label className="form-label">Urgent</label>
              <label className={`checkbox-item urgent-toggle ${form.urgent ? 'active' : ''}`}>
                <input
                  type="checkbox"
                  checked={form.urgent}
                  onChange={event => setForm(prev => ({ ...prev, urgent: event.target.checked }))}
                />
                <span>Mark this lead as urgent</span>
              </label>
            </div>
            <div className="form-group form-group-full">
              <label className="form-label">History</label>
              <div className="history-entry-grid">
                <div className="form-group">
                  <label className="form-label">Action</label>
                  <input
                    className="form-input"
                    placeholder="e.g. Called client"
                    value={historyDraft.action}
                    onChange={e => setHistoryDraft(prev => ({ ...prev, action: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Type</label>
                  <select
                    className="form-select-custom"
                    value={historyDraft.type}
                    onChange={e => setHistoryDraft(prev => ({ ...prev, type: e.target.value as HistoryItem['type'] }))}
                  >
                    {HISTORY_TYPE_OPTIONS.map(option => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Action Date</label>
                  <input
                    className="form-input"
                    type="datetime-local"
                    value={historyDraft.actionDate}
                    onChange={e => setHistoryDraft(prev => ({ ...prev, actionDate: e.target.value }))}
                  />
                </div>
                <div className="form-group form-group-full">
                  <label className="form-label">Detail</label>
                  <textarea
                    className="form-input form-textarea"
                    placeholder="Add details about the action taken..."
                    value={historyDraft.detail}
                    onChange={e => setHistoryDraft(prev => ({ ...prev, detail: e.target.value }))}
                  />
                </div>
              </div>
              <div className="history-actions">
                <button
                  type="button"
                  className="btn-outline-custom"
                  onClick={addHistoryEntry}
                >
                  <Plus size={14} /> Add History Entry
                </button>
              </div>
              {form.historyEntries.length > 0 && (
                <div className="history-list">
                  {form.historyEntries.map((entry, index) => (
                    <div key={`${entry.action}-${index}`} className="history-entry">
                      <div className="history-entry-meta">
                        <span className="history-entry-title">{entry.action || 'Note'}</span>
                        <span className="history-entry-detail">{entry.detail || 'No details provided.'}</span>
                        {entry.actionDate ? (
                          <span className="history-entry-date">{new Date(entry.actionDate).toLocaleString()}</span>
                        ) : (
                          <span className="history-entry-date">No date set</span>
                        )}
                      </div>
                      <div className="history-entry-actions">
                        <span className="history-entry-badge">{entry.type}</span>
                        <button
                          type="button"
                          className="history-remove-btn"
                          onClick={() => removeHistoryEntry(index)}
                          aria-label="Remove history entry"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="modal-actions">
            <button
              className={`btn-primary-custom ${adding ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              onClick={() => onSubmit(form, false, "addingsection")}
              disabled={!form.name.trim() || !form.phone.trim() || adding || addingwithReminder}
            >
              {adding ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Saving Lead ...
                </>
              ) : (
                <><Check size={15} /> Save Lead</>
              )
              }

            </button>
            <button
              className={`btn-outline-custom ${addingwithReminder ? 'cursor-not-allowed' : 'cursor pointer'}`}
              onClick={() => onSubmit(form, true, "addingwithRemindersection")}
              disabled={!form.name.trim() || !form.phone.trim() || adding || addingwithReminder}
            >
              {addingwithReminder ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#3ba6f1] border-t-transparent" />
                  Saving & Setting Reminder ...
                </>
              ) : (
                <><Bell size={15} /> Save & Set Reminder</>
              )}
            </button>
            <button className="btn-outline-custom" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

