'use client';

import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Bell, Check, Mail, Phone, X } from 'lucide-react';
import { Lead, LeadStage } from '@/lib/types';
import { EmailTemplate } from '@/lib/types';
import { EMAIL_TEMPLATES } from '@/lib/variables';
import { sendEmailToLead } from '@/lib/leads-service';

interface PipelineViewProps {
  leads: Lead[];
  onLeadUpdate: (lead: Lead) => void;
  onLeadDelete: (leadId: number) => void;
}

const STAGES: LeadStage[] = ['New', 'Contacted', 'Qualified', 'Quoted', 'Negotiating', 'Won', 'Lost'];
const MOVABLE_STAGES: LeadStage[] = ['New', 'Contacted', 'Qualified', 'Quoted', 'Negotiating', 'Won'];

const stageColors: Record<LeadStage, { bg: string; text: string }> = {
  New: { bg: '#c1e1f7', text: '#3ba6f1' },
  Contacted: { bg: '#FEF9C3', text: '#D97706' },
  Qualified: { bg: '#E9D5FF', text: '#7C3AED' },
  Quoted: { bg: '#FFF3E0', text: '#E8730C' },
  Negotiating: { bg: '#F5E6FF', text: '#A855F7' },
  Won: { bg: '#DCFCE7', text: '#16A34A' },
  Lost: { bg: '#FEE2E2', text: '#DC2626' },
};

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

function buildEmailDraft(template: EmailTemplate, lead: Lead) {
  return {
    subject: hydrateTemplate(template.subject, lead),
    body: hydrateTemplate(template.body, lead),
  };
}

function previewTemplateText(text: string) {
  return text.replace(PLACEHOLDER_PATTERN, '...');
}

function buildSnippet(text: string, maxLength = 110) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function dialablePhone(phone: string) {
  return phone.replace(/[^0-9+]/g, '');
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0c0a09]/30 p-4 min-h-screen"
      onMouseDown={handleBackdropMouseDown}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`w-full ${maxWidthClass} rounded-[16px] bg-white shadow-[0_12px_45px_rgba(17,12,46,0.12)] ring-1 ring-[#e5e7eb]`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#e5e7eb] px-5 py-3">
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
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export default function PipelineView({
  leads,
  onLeadUpdate,
}: PipelineViewProps) {
  const [statusLead, setStatusLead] = useState<Lead | null>(null);
  const [statusStage, setStatusStage] = useState<LeadStage>('New');
  const [statusNotes, setStatusNotes] = useState('');
  const [lostLead, setLostLead] = useState<Lead | null>(null);
  const [lostReason, setLostReason] = useState('');
  const [lostNotes, setLostNotes] = useState('');
  const [lostError, setLostError] = useState('');
  const [emailLead, setEmailLead] = useState<Lead | null>(null);
  const [showEmailTemplates, setShowEmailTemplates] = useState(false);
  const [showSendEmail, setShowSendEmail] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  // Toast state
  const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'info' }[]>([]);

  /* ── Toast helper ────────────────────── */
  const showToast = (message: string, type: 'success' | 'info' = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const leadsByStage = useMemo(() => {
    const grouped: Record<LeadStage, Lead[]> = {
      New: [],
      Contacted: [],
      Qualified: [],
      Quoted: [],
      Negotiating: [],
      Won: [],
      Lost: [],
    };

    leads.forEach(lead => {
      grouped[lead.stage].push(lead);
    });

    return grouped;
  }, [leads]);

  const openStatusModal = (lead: Lead) => {
    setStatusLead(lead);
    setStatusStage(lead.stage);
    setStatusNotes('');
  };

  const closeStatusModal = () => {
    setStatusLead(null);
  };

  const openLostModal = (lead: Lead) => {
    setLostLead(lead);
    setLostReason('');
    setLostNotes('');
    setLostError('');
  };

  const closeLostModal = () => {
    setLostLead(null);
    setLostError('');
  };

  const openEmailTemplates = (lead: Lead) => {
    setEmailLead(lead);
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
    if (!emailLead) return;
    const draft = buildEmailDraft(template, emailLead);
    setSelectedTemplate(template);
    setEmailSubject(draft.subject);
    setEmailBody(draft.body);
    setShowEmailTemplates(false);
    setShowSendEmail(true);
  };

  const handleMoveStage = () => {
    if (!statusLead) return;
    if (statusStage === statusLead.stage) {
      closeStatusModal();
      return;
    }

    const now = new Date();
    const historyEntry: Lead['history'][number] = {
      date: now.toISOString().slice(0, 10),
      time: now.toTimeString().slice(0, 5),
      action: 'Stage changed',
      detail: `Moved from "${statusLead.stage}" to "${statusStage}".${statusNotes ? ` ${statusNotes}` : ''}`,
      type: 'system',
    };

    const updatedLead: Lead = {
      ...statusLead,
      stage: statusStage,
      history: [...statusLead.history, historyEntry],
      followupDate: statusStage === 'Won' ? '' : statusLead.followupDate,
      followupTime: statusStage === 'Won' ? '' : statusLead.followupTime,
      followupNotes: statusStage === 'Won' ? '' : statusLead.followupNotes,
      urgent: statusStage === 'Won' ? false : statusLead.urgent,
    };

    onLeadUpdate(updatedLead);
    closeStatusModal();
  };

  const handleConfirmLost = () => {
    if (!lostLead) return;
    if (!lostReason) {
      setLostError('Please select a reason for marking this lead as lost.');
      return;
    }

    const now = new Date();
    const noteText = lostNotes.trim();
    const updatedNotes = noteText
      ? `${lostLead.notes ? `${lostLead.notes}\n\n` : ''}Lost notes: ${noteText}`
      : lostLead.notes;
    const historyEntry: Lead['history'][number] = {
      date: now.toISOString().slice(0, 10),
      time: now.toTimeString().slice(0, 5),
      action: 'Lost',
      detail: `Reason: ${lostReason}${noteText ? ` - ${noteText}` : ''}`,
      type: 'system',
    };

    const updatedLead: Lead = {
      ...lostLead,
      stage: 'Lost',
      lostReason,
      notes: updatedNotes,
      followupDate: '',
      followupTime: '',
      followupNotes: '',
      urgent: false,
      history: [...lostLead.history, historyEntry],
    };

    onLeadUpdate(updatedLead);
    closeLostModal();
  };

  const handleSendEmail = async () => {
    if (!emailLead) return;
    const now = new Date();
    const historyEntry: Lead['history'][number] = {
      date: now.toISOString().slice(0, 10),
      time: now.toTimeString().slice(0, 5),
      action: 'Email sent',
      detail: `Subject: ${emailSubject}`,
      type: 'email',
    };
    console.log('Sending email to:', emailLead.email);
    console.log('Email subject:', emailSubject);
    console.log('Email body:', emailBody);

    const sendCampaign = await sendEmailToLead(
      emailLead.email,
      emailSubject,
      hydrateTemplate(emailBody, emailLead)
    );

    if (sendCampaign) {
      showToast(`Email sent to ${emailLead.name} Successfully`, 'success');
      const updatedLead: Lead = {
        ...emailLead,
        history: [...emailLead.history, historyEntry],
      };
      onLeadUpdate(updatedLead);
    }else{
      showToast(`Failed to send email to ${emailLead.name}`, 'info');
    }

    closeSendEmail();
  };

  const handleCall = (lead: Lead) => {
    const dial = dialablePhone(lead.phone);
    if (!dial) return;
    window.location.href = `tel:${dial}`;
  };

  return (
    <div className="pipeline-view">
      <div className="pipeline-columns">
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
        {STAGES.map(stage => (
          <div key={stage} className="pipeline-col">
            <div className="pipeline-header" style={{ backgroundColor: stageColors[stage].bg, color: stageColors[stage].text }}>
              <span className="pipeline-stage-name">{stage}</span>
              <span className="pipeline-count">{leadsByStage[stage].length}</span>
            </div>
            <div className="pipeline-body">
              {leadsByStage[stage].length === 0 ? (
                <div className="pipeline-empty">No leads</div>
              ) : (
                leadsByStage[stage].map(lead => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    onMoveStage={openStatusModal}
                    onMarkLost={openLostModal}
                    onEmail={openEmailTemplates}
                    onCall={handleCall}
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      <ModalShell
        open={!!statusLead}
        onClose={closeStatusModal}
        title={statusLead ? `Move: ${statusLead.name}` : 'Change Stage'}
        maxWidthClass="max-w-[420px]"
      >
        {statusLead && (
          <div className="space-y-4">
            <div>
              <div className="text-xs font-medium text-[#a8a29e]">Current Stage</div>
              <div className="mt-2 flex flex-wrap gap-1">
                {MOVABLE_STAGES.map(stage => (
                  <span
                    key={stage}
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${stage === statusLead.stage
                      ? 'border-[#c1e1f7] bg-[#c1e1f7]/30 text-[#3ba6f1] font-medium'
                      : 'border-[#e5e7eb] bg-[#fafaf9] text-[#78716c]'
                      }`}
                  >
                    {stage}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-[#78716c]">Move to Stage</label>
              <select
                className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#3ba6f1] focus:outline-none focus:ring-2 focus:ring-[#c1e1f7]"
                value={statusStage}
                onChange={event => setStatusStage(event.target.value as LeadStage)}
              >
                {MOVABLE_STAGES.map(stage => (
                  <option key={stage} value={stage} disabled={stage === statusLead.stage}>
                    {stage} {stage === statusLead.stage ? '(current)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-[#78716c]">Notes (optional)</label>
              <textarea
                className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#3ba6f1] focus:outline-none focus:ring-2 focus:ring-[#c1e1f7]"
                rows={3}
                placeholder="Why are you moving this lead?"
                value={statusNotes}
                onChange={event => setStatusNotes(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#3ba6f1] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#2b8fd6]"
                onClick={handleMoveStage}
              >
                <ArrowRight size={14} />
                Move Lead
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full border border-[#e5e7eb] px-4 py-2 text-xs font-medium text-[#78716c] transition hover:border-[#c9c5c2] hover:bg-[#fafaf9]"
                onClick={closeStatusModal}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </ModalShell>

      <ModalShell
        open={!!lostLead}
        onClose={closeLostModal}
        title="Mark Lead as Lost"
        titleClassName="text-rose-600"
        maxWidthClass="max-w-[460px]"
      >
        {lostLead && (
          <div className="space-y-4">
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 text-rose-500" />
                <span>
                  This will mark <span className="font-semibold">{lostLead.name}</span> as lost.
                  This action helps track why leads do not convert.
                </span>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-[#78716c]">Reason for Loss *</label>
              <select
                className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-100"
                value={lostReason}
                onChange={event => {
                  setLostReason(event.target.value);
                  setLostError('');
                }}
              >
                <option value="">Select a reason...</option>
                <option value="Budget Constraints">Budget Constraints</option>
                <option value="Chose Competitor">Chose Competitor</option>
                <option value="Delayed Decision">Delayed Decision</option>
                <option value="Location Changed">Location Changed</option>
                <option value="Not Ready">Not Ready</option>
                <option value="Communication Issues">Communication Issues</option>
                <option value="Other">Other</option>
              </select>
              {lostError ? <p className="mt-2 text-xs text-rose-600">{lostError}</p> : null}
            </div>
            <div>
              <label className="text-xs font-medium text-[#78716c]">Additional Notes</label>
              <textarea
                className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-100"
                rows={3}
                placeholder="Any additional context..."
                value={lostNotes}
                onChange={event => setLostNotes(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-rose-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-rose-700"
                onClick={handleConfirmLost}
              >
                <X size={14} />
                Confirm - Mark as Lost
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full border border-[#e5e7eb] px-4 py-2 text-xs font-medium text-[#78716c] transition hover:border-[#c9c5c2] hover:bg-[#fafaf9]"
                onClick={closeLostModal}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </ModalShell>

      <ModalShell
        open={showEmailTemplates}
        onClose={closeEmailTemplates}
        title="Email Templates"
        subtitle="Select a template to send to the lead"
        maxWidthClass="max-w-[720px]"
      >
        <div className="space-y-4">
          {emailLead ? (
            <div className="rounded-[10px] border border-[#c1e1f7] bg-[#c1e1f7]/30 px-4 py-3 text-sm text-[#0c0a09]">
              Sending to: <span className="font-medium">{emailLead.name}</span> -{' '}
              {emailLead.email || 'No email'}
            </div>
          ) : (
            <div className="rounded-[10px] border border-[#e5e7eb] bg-[#fafaf9] px-4 py-3 text-sm text-[#78716c]">
              Select a template, then choose a lead to send it to.
            </div>
          )}
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
                    {buildSnippet(template.body)}
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
        subtitle={emailLead ? `To: ${emailLead.name} (${emailLead.email || 'No email'})` : undefined}
        maxWidthClass="max-w-[600px]"
      >
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-[#78716c]">To</label>
            <input
              className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-[#fafaf9] px-3 py-2 text-sm text-[#78716c]"
              value={emailLead?.email || emailLead?.name || ''}
              readOnly
            />
          </div>
          {selectedTemplate ? (
            <div className="flex items-center justify-between rounded-[4px] border border-[#e5e7eb] bg-[#fafaf9] px-3 py-2 text-xs text-[#78716c]">
              <span>Template</span>
              <span className="font-medium text-[#0c0a09]">{selectedTemplate.category}</span>
            </div>
          ) : null}
          <div>
            <label className="text-xs font-medium text-[#78716c]">Subject</label>
            <input
              className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#3ba6f1] focus:outline-none focus:ring-2 focus:ring-[#c1e1f7]"
              value={emailSubject}
              onChange={event => setEmailSubject(event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#78716c]">Body</label>
            <textarea
              className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#3ba6f1] focus:outline-none focus:ring-2 focus:ring-[#c1e1f7]"
              rows={8}
              value={emailBody}
              onChange={event => setEmailBody(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[#3ba6f1] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#2b8fd6]"
              onClick={handleSendEmail}
              disabled={!emailSubject.trim()}
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
    </div>
  );
}

interface LeadCardProps {
  lead: Lead;
  onMoveStage: (lead: Lead) => void;
  onMarkLost: (lead: Lead) => void;
  onEmail: (lead: Lead) => void;
  onCall: (lead: Lead) => void;
}

function LeadCard({ lead, onMoveStage, onMarkLost, onEmail, onCall }: LeadCardProps) {
  const isClosed = lead.stage === 'Won' || lead.stage === 'Lost';
  const canMove = !isClosed;
  const canCall = !isClosed;
  const canEmail = Boolean(lead.email);
  const canMarkLost = !isClosed;

  return (
    <div className={`lead-card ${lead.urgent ? 'urgent' : ''}`}>
      {lead.urgent && <div className="urgent-indicator"></div>}

      <div className="lead-card-header">
        <h4 className="lead-card-name">
          {lead.name}
          {lead.urgent && <span className="urgent-badge">!</span>}
        </h4>
        <p className="lead-card-subtitle">{lead.phone}</p>
      </div>

      <div className="lead-card-meta">
        <span className="lead-card-location">{lead.location}</span>
        <span className="lead-card-source">{lead.source}</span>
      </div>

      <div className="lead-card-assigned">{lead.assigned}</div>

      <div className="lead-card-actions">
        {canMove && (
          <button
            type="button"
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-[#c1e1f7] bg-[#c1e1f7]/30 px-2 py-1 text-[11px] font-medium text-[#3ba6f1] transition hover:border-[#3ba6f1] hover:bg-[#c1e1f7]/50"
            title="Move stage"
            onClick={() => onMoveStage(lead)}
          >
            <ArrowRight size={13} />
            Move
          </button>
        )}
        {canCall && (
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#e5e7eb] bg-white text-[#78716c] transition hover:border-[#c9c5c2] hover:bg-[#fafaf9]"
            title="Call"
            onClick={() => onCall(lead)}
            aria-label="Call"
          >
            <Phone size={14} />
          </button>
        )}
        {canEmail && (
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#e5e7eb] bg-white text-[#3ba6f1] transition hover:border-[#c1e1f7] hover:bg-[#c1e1f7]/20"
            title="Email"
            onClick={() => onEmail(lead)}
            aria-label="Email"
          >
            <Mail size={14} />
          </button>
        )}
        {canMarkLost && (
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-rose-200 bg-white text-rose-600 transition hover:border-rose-300 hover:bg-rose-50"
            title="Mark lost"
            onClick={() => onMarkLost(lead)}
            aria-label="Mark lost"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
