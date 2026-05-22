'use client';

import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Bell, Check, Clock, Globe, Mail, Phone, Users, Wallet, X } from 'lucide-react';
import { Lead, LeadStage } from '@/lib/leads/types';
import { EmailTemplate } from '@/lib/leads/types';
import { EMAIL_TEMPLATES } from '@/lib/leads/variables';
import { sendEmailToLead } from '@/lib/leads/leads-service';

interface PipelineViewProps {
  leads: Lead[];
  onLeadUpdate: (lead: Lead) => Promise<boolean>;
  onLeadDelete: (leadId: number) => void;
}

const STAGES: LeadStage[] = [
  'New',
  'Contacted',
  'Meeting Scheduled',
  'In Follow-up',
  'Qualified',
  'Quoted',
  'Negotiating',
  'Won',
  'Converted',
  'No Response',
  'Cancelled',
  'Disqualified',
  'Lost',
];
const MOVABLE_STAGES: LeadStage[] = [...STAGES];

const stageColors: Record<LeadStage, { bg: string; text: string }> = {
  New: { bg: '#CCFBF1', text: '#0D9488' },
  Contacted: { bg: '#FEF9C3', text: '#D97706' },
  Qualified: { bg: '#E9D5FF', text: '#7C3AED' },
  Quoted: { bg: '#FFF3E0', text: '#E8730C' },
  Negotiating: { bg: '#F5E6FF', text: '#A855F7' },
  Won: { bg: '#DCFCE7', text: '#16A34A' },
  Lost: { bg: '#FEE2E2', text: '#DC2626' },
  'Meeting Scheduled': { bg: '#DBEAFE', text: '#2563EB' },
  'In Follow-up': { bg: '#E0F2FE', text: '#0284C7' },
  'No Response': { bg: '#FFE4E6', text: '#E11D48' },
  Converted: { bg: '#DCFCE7', text: '#16A34A' },
  Cancelled: { bg: '#FEE2E2', text: '#DC2626' },
  Disqualified: { bg: '#FDE2E4', text: '#B91C1C' },
};

const PLACEHOLDER_PATTERN = /\{([^}]+)\}/g;

function formatShortDate(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function formatFollowup(date: string | null, time?: string | null): string {
  if (!date) return '';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return time ? `${date} ${time}` : date;
  }
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[parsed.getMonth()];
  const timeStr = time || '';
  return `${parsed.getDate()} ${month} ${parsed.getFullYear()}${timeStr ? ` ${timeStr}` : ''}`;
}

function formatCreatedAgo(value?: string | null): string {
  if (!value) return 'Created date unavailable';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Created date unavailable';
  const diffMs = Date.now() - parsed.getTime();
  const days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  return `Created ${days} days ago`;
}

function getHistoryTimestamp(entry: Lead['history'][number]): number {
  const timeValue = entry.time || '00:00';
  const parsed = new Date(`${entry.date}T${timeValue}`);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function LeadSourceIcon({ source }: { source: string }) {
  if (source === 'Google Ads') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="shrink-0">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
      </svg>
    );
  }
  if (source === 'Referral') {
    return <Users size={12} className="text-[#78716c] shrink-0" />;
  }
  if (source === 'Facebook Ads') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="shrink-0">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.469h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.469h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" fill="#1877F2" />
      </svg>
    );
  }
  return <Globe size={12} className="text-[#78716c] shrink-0" />;
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
    body: hydrateTemplate(getTemplateHtml(template), lead),
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
  const emailBodyRef = React.useRef<HTMLDivElement>(null);
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const [logFollowupLead, setLogFollowupLead] = useState<Lead | null>(null);
  const [logActionType, setLogActionType] = useState<Lead['history'][number]['type']>('call');
  const [logAction, setLogAction] = useState('');
  const [logDetail, setLogDetail] = useState('');
  const [logNextDate, setLogNextDate] = useState('');
  const [logNextTime, setLogNextTime] = useState('10:00');
  const [logUrgent, setLogUrgent] = useState(false);
  const [logSaving, setLogSaving] = useState(false);
  // Toast state
  const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'info' }[]>([]);

  const [moveStatusConfirmed, setMoveStatusConfirmed] = useState(false);
  const [lostConfirmed, setLostConfirmed] = useState(false);

  /* ── Toast helper ────────────────────── */
  const showToast = (message: string, type: 'success' | 'info' = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const leadsByStage = useMemo(() => {
    const grouped = STAGES.reduce((acc, stage) => {
      acc[stage] = [];
      return acc;
    }, {} as Record<LeadStage, Lead[]>);

    leads.forEach(lead => {
      grouped[lead.stage].push(lead);
    });

    return grouped;
  }, [leads]);

  const openStatusModal = (lead: Lead) => {
    setStatusLead(lead);
    setStatusStage(lead.stage);
    setStatusNotes(lead.notes);
  };

  const closeStatusModal = () => {
    setStatusLead(null);
  };

  const openLostModal = (lead: Lead) => {
    setLostLead(lead);
    setLostReason('');
    setLostNotes(lead.notes);
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

  const openDetailModal = (lead: Lead) => {
    setDetailLead(lead);
  };

  const closeDetailModal = () => {
    setDetailLead(null);
  };

  const openLogFollowupModal = (lead: Lead) => {
    setLogFollowupLead(lead);
    setLogActionType('call');
    setLogAction('');
    setLogDetail('');
    setLogNextDate(lead.followupDate || '');
    setLogNextTime(lead.followupTime || '10:00');
    setLogUrgent(Boolean(lead.urgent));
  };

  const closeLogFollowupModal = () => {
    setLogFollowupLead(null);
    setLogSaving(false);
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

  const handleMoveStage = async () => {
    if (!statusLead) return;
    if (statusStage === statusLead.stage) {
      closeStatusModal();
      return;
    }

    setMoveStatusConfirmed(true);

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
      notes: statusNotes,
      // followupDate: statusStage === 'Won' ? '' : statusLead.followupDate,
      // followupTime: statusStage === 'Won' ? '' : statusLead.followupTime,
      // followupNotes: statusStage === 'Won' ? '' : statusLead.followupNotes,
      // urgent: statusStage === 'Won' ? false : statusLead.urgent,
    };

    const leadUpdated = await onLeadUpdate(updatedLead);
    setMoveStatusConfirmed(false);
    closeStatusModal();
    if (leadUpdated) {
      showToast(`Lead "${statusLead.name}" moved to "${statusStage}".`, 'success');
    } else {
      showToast(`Failed to update lead "${statusLead.name}". Please try again.`, 'info');
    }
  };

  const handleConfirmLost = async () => {
    if (!lostLead) return;
    if (!lostReason) {
      setLostError('Please select a reason for marking this lead as lost.');
      return;
    }

    setLostConfirmed(true);

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
      history: [...lostLead.history, historyEntry],
    };

    const leadUpdated = await onLeadUpdate(updatedLead);
    if (leadUpdated) {
      showToast(`Lead "${lostLead.name}" marked as lost.`, 'info');
    } else {
      showToast(`Failed to update lead "${lostLead.name}". Please try again.`, 'info');
    }
    setLostConfirmed(false);
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

    const finalBody = emailBodyRef.current ? emailBodyRef.current.innerHTML : emailBody;
    const sendCampaign = await sendEmailToLead(
      emailLead.email,
      emailSubject,
      hydrateTemplate(finalBody, emailLead)
    );

    if (sendCampaign) {
      showToast(`Email sent to ${emailLead.name} Successfully`, 'success');
      const updatedLead: Lead = {
        ...emailLead,
        history: [...emailLead.history, historyEntry],
      };
      onLeadUpdate(updatedLead);
    } else {
      showToast(`Failed to send email to ${emailLead.name}`, 'info');
    }

    closeSendEmail();
  };

  const handleCall = (lead: Lead) => {
    const dial = dialablePhone(lead.phone);
    if (!dial) return;
    window.location.href = `tel:${dial}`;
  };

  const handleSaveFollowup = async () => {
    if (!logFollowupLead) return;
    if (!logAction.trim() && !logDetail.trim()) {
      showToast('Please add an action or detail.', 'info');
      return;
    }
    if (!logNextDate) {
      showToast('Please select a follow-up date.', 'info');
      return;
    }

    setLogSaving(true);
    const now = new Date();
    const historyEntry: Lead['history'][number] = {
      date: now.toISOString().slice(0, 10),
      time: now.toTimeString().slice(0, 5),
      action: logAction.trim() || 'Follow-up',
      detail: logDetail.trim(),
      type: logActionType,
    };

    const updatedLead: Lead = {
      ...logFollowupLead,
      followupDate: logNextDate,
      followupTime: logNextTime,
      followupNotes: logDetail.trim() || logFollowupLead.followupNotes,
      urgent: logUrgent,
      history: [...logFollowupLead.history, historyEntry],
    };

    const leadUpdated = await onLeadUpdate(updatedLead);
    setLogSaving(false);

    if (leadUpdated) {
      showToast(`Follow-up saved for ${logFollowupLead.name}.`, 'success');
      closeLogFollowupModal();
      setDetailLead(null);
    } else {
      showToast(`Failed to update ${logFollowupLead.name}. Please try again.`, 'info');
    }
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
        {STAGES
          .map(stage => (
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
                      onOpenDetail={openDetailModal}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
      </div>

      <ModalShell
        open={!!detailLead}
        onClose={closeDetailModal}
        title={detailLead ? detailLead.name : 'Lead Details'}
        subtitle={detailLead ? `${detailLead.location} - ${detailLead.stage}` : undefined}
        maxWidthClass="max-w-[680px]"
      >
        {detailLead && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span
                className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase"
                style={{
                  backgroundColor: stageColors[detailLead.stage].bg,
                  color: stageColors[detailLead.stage].text,
                }}
              >
                {detailLead.stage}
              </span>
              <span className="text-xs text-[#a8a29e]">{formatCreatedAgo(detailLead.created)}</span>
            </div>

            <div className="h-px w-full bg-[#e5e7eb]" />

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="text-[11px] text-[#a8a29e]">Phone</div>
                <div className="text-sm font-medium text-[#0c0a09]">{detailLead.phone || '-'}</div>
              </div>
              <div>
                <div className="text-[11px] text-[#a8a29e]">Email</div>
                <div className="text-sm font-medium text-[#0c0a09]">{detailLead.email || '-'}</div>
              </div>
              <div>
                <div className="text-[11px] text-[#a8a29e]">Location</div>
                <div className="text-sm font-medium text-[#0c0a09]">{detailLead.location || '-'}</div>
              </div>
              <div>
                <div className="text-[11px] text-[#a8a29e]">Source Detail</div>
                <div className="inline-flex items-center gap-2 text-sm font-medium text-[#0c0a09]">
                  <LeadSourceIcon source={detailLead.source} />
                  <span>
                    {detailLead.source}
                    {detailLead.sourceDetail ? ` — ${detailLead.sourceDetail}` : ''}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#a8a29e]">Budget</div>
                <div className="text-sm font-medium text-[#0c0a09]">{detailLead.budget || 'Not Discussed'}</div>
              </div>
              <div>
                <div className="text-[11px] text-[#a8a29e]">Assigned</div>
                <div className="text-sm font-medium text-[#0c0a09]">{detailLead.assigned || 'Unassigned'}</div>
              </div>
              <div>
                <div className="text-[11px] text-[#a8a29e]">Project Type</div>
                <div className="text-sm font-medium text-[#0c0a09]">{detailLead.type || 'Not Specified'}</div>
              </div>
              <div>
                <div className="text-[11px] text-[#a8a29e]">Follow-up</div>
                <div className="text-sm font-medium text-[#0c0a09]">
                  {detailLead.followupDate
                    ? formatFollowup(detailLead.followupDate, detailLead.followupTime)
                    : '-'}
                </div>
              </div>
            </div>

            <div>
              <div className="text-[11px] text-[#a8a29e]">Notes</div>
              <div className="mt-2 rounded-[10px] border border-[#e5e7eb] bg-[#f8fafc] px-3 py-3 text-sm text-[#0c0a09]">
                {detailLead.notes || 'No notes available.'}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-[#78716c]">Activity History</label>
              {detailLead.history.length === 0 ? (
                <div className="mt-2 text-xs text-[#a8a29e]">No history recorded yet.</div>
              ) : (
                <div className="mt-3 space-y-4">
                  {[...detailLead.history]
                    .sort((a, b) => getHistoryTimestamp(b) - getHistoryTimestamp(a))
                    .map((entry, index) => (
                      <div key={`${entry.date}-${entry.time}-${index}`} className="relative pl-6">
                        <span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[#22c55e] bg-white" />
                        <div className="text-sm font-medium text-[#0c0a09]">{entry.action}</div>
                        <div className="text-sm text-[#475569]">{entry.detail}</div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-[#94a3b8]">
                          <span className="inline-flex items-center rounded-full border border-[#e5e7eb] px-2 py-0.5 text-[10px] font-semibold uppercase">
                            {entry.type}
                          </span>
                          <span>{entry.date} {entry.time}</span>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#0f766e] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#0d5f59]"
                onClick={() => openLogFollowupModal(detailLead)}
              >
                <Phone size={14} />
                Log Follow-up
              </button>
              {detailLead.email ? (
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-[#e5e7eb] bg-white px-4 py-2 text-xs font-medium text-[#0c0a09] transition hover:border-[#CCFBF1] hover:bg-[#CCFBF1]/20"
                  onClick={() => openEmailTemplates(detailLead)}
                >
                  <Mail size={14} />
                  Send Email
                </button>
              ) : null}
              <button
                type="button"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-[#e5e7eb] bg-white px-4 py-2 text-xs font-medium text-[#0c0a09] transition hover:border-[#CCFBF1] hover:bg-[#CCFBF1]/20"
                onClick={() => openStatusModal(detailLead)}
              >
                <ArrowRight size={14} />
                Change Stage
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-rose-200 bg-white px-4 py-2 text-xs font-medium text-rose-600 transition hover:border-rose-300 hover:bg-rose-50"
                onClick={() => openLostModal(detailLead)}
              >
                <X size={14} />
                Mark Lost
              </button>
            </div>
          </div>
        )}
      </ModalShell>

      <ModalShell
        open={!!logFollowupLead}
        onClose={closeLogFollowupModal}
        title={logFollowupLead ? `Log Follow-up — ${logFollowupLead.name}` : 'Log Follow-up'}
        maxWidthClass="max-w-[600px]"
      >
        {logFollowupLead && (
          <div className="space-y-4">
            {/* <div className="h-px w-full bg-[#e5e7eb]" /> */}

            <div>
              <div className="text-xs font-semibold text-[#0c0a09]">Previous History</div>
              {logFollowupLead.history.length === 0 ? (
                <div className="mt-2 text-xs text-[#a8a29e]">No history recorded yet.</div>
              ) : (
                <div className="history-list mt-3">
                  {[...logFollowupLead.history]
                    .sort((a, b) => getHistoryTimestamp(b) - getHistoryTimestamp(a))
                    .map((entry, index) => (
                      <div key={`${entry.date}-${entry.time}-${index}`} className="history-entry">
                        <div className="history-entry-meta">
                          <div className="history-entry-title">{entry.action}</div>
                          <div className="history-entry-detail">{entry.detail}</div>
                          <div className="history-entry-date">{entry.date} {entry.time}</div>
                        </div>
                        <div className="history-entry-actions">
                          <span className="history-entry-badge">{entry.type}</span>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-[#78716c]">Action Type</label>
                <select
                  className="mt-1 w-full rounded-[6px] border border-[#e5e7eb] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
                  value={logActionType}
                  onChange={event => setLogActionType(event.target.value as Lead['history'][number]['type'])}
                >
                  <option value="call">Call</option>
                  <option value="email">Email</option>
                  <option value="referral">Referral</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-[#78716c]">Action</label>
                <input
                  className="mt-1 w-full rounded-[6px] border border-[#e5e7eb] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
                  placeholder="e.g. Phone call"
                  value={logAction}
                  onChange={event => setLogAction(event.target.value)}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-[#78716c]">Details</label>
                <textarea
                  className="mt-1 w-full rounded-[6px] border border-[#e5e7eb] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
                  rows={3}
                  placeholder="Notes from this interaction"
                  value={logDetail}
                  onChange={event => setLogDetail(event.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-[#78716c]">Next Follow-up Date</label>
                <input
                  type="date"
                  className="mt-1 w-full rounded-[6px] border border-[#e5e7eb] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
                  value={logNextDate}
                  onChange={event => setLogNextDate(event.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[#78716c]">Next Follow-up Time</label>
                <input
                  type="time"
                  className="mt-1 w-full rounded-[6px] border border-[#e5e7eb] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
                  value={logNextTime}
                  onChange={event => setLogNextTime(event.target.value)}
                />
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-xs font-medium text-[#78716c]">
              <input
                type="checkbox"
                checked={logUrgent}
                onChange={event => setLogUrgent(event.target.checked)}
              />
              Mark as Urgent
            </label>

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#0f766e] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#0d5f59] disabled:opacity-60"
                onClick={handleSaveFollowup}
                disabled={logSaving}
              >
                <Check size={14} />
                {logSaving ? 'Saving...' : 'Save & Set Next Follow-up'}
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full border border-[#e5e7eb] px-4 py-2 text-xs font-medium text-[#78716c] transition hover:border-[#c9c5c2] hover:bg-[#fafaf9]"
                onClick={closeLogFollowupModal}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </ModalShell>

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
                {MOVABLE_STAGES
                  // .filter(stage => stage !== 'Lost')
                  .map(stage => (
                    <span
                      key={stage}
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${stage === statusLead.stage
                        ? 'border-[#CCFBF1] bg-[#CCFBF1]/30 text-[#0D9488] font-medium'
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
                className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
                value={statusStage}
                onChange={event => setStatusStage(event.target.value as LeadStage)}
              >
                {MOVABLE_STAGES
                  .filter(stage => stage !== 'Lost')
                  .map(stage => (
                    <option key={stage} value={stage} disabled={stage === statusLead.stage}>
                      {stage} {stage === statusLead.stage ? '(current)' : ''}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-[#78716c]">Notes (optional)</label>
              <textarea
                className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
                rows={3}
                placeholder="Why are you moving this lead?"
                value={statusNotes}
                onChange={event => setStatusNotes(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#0D9488] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#2b8fd6]"
                onClick={handleMoveStage}
              >
                {moveStatusConfirmed ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Moving Lead ...
                  </>
                )
                  :
                  <>
                    <ArrowRight size={14} />
                    Move Lead
                  </>
                }

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
                {lostConfirmed ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Marking as Lost ...
                  </>
                ) : (
                  <>
                    <X size={14} />
                    Confirm - Mark as Lost
                  </>
                )}
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
            <div className="rounded-[10px] border border-[#CCFBF1] bg-[#CCFBF1]/30 px-4 py-3 text-sm text-[#0c0a09]">
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
                  className="group rounded-[10px] border border-[#e5e7eb] bg-white p-4 text-left shadow-[rgba(0,0,0,0.05)_0px_1px_2px_0px] transition hover:-translate-y-0.5 hover:border-[#0D9488] hover:shadow-[rgba(0,0,0,0.05)_0px_4px_16px_0px]"
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
              className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-white px-3 py-2 text-sm text-[#0c0a09] focus:border-[#0D9488] focus:outline-none focus:ring-2 focus:ring-[#CCFBF1]"
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
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[#0D9488] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#2b8fd6]"
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
  onOpenDetail: (lead: Lead) => void;
}

function LeadCard({ lead, onMoveStage, onMarkLost, onEmail, onCall, onOpenDetail }: LeadCardProps) {
  const isClosed = lead.stage === 'Won' || lead.stage === 'Lost';
  const canMove = !isClosed;
  const canCall = !isClosed;
  const canEmail = Boolean(lead.email);
  const canMarkLost = !isClosed;
  const showBudget = lead.budget && lead.budget !== 'Not Discussed';
  const showType = lead.type && lead.type !== 'Not Specified';

  return (
    <div
      className={`lead-card ${lead.urgent ? 'urgent' : ''}`}
      onClick={() => onOpenDetail(lead)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenDetail(lead);
        }
      }}
    >
      <div className="lead-card-name">
        {lead.urgent && <span className="urgent-dot" />}
        <span>{lead.name}</span>
      </div>
      <div className="lead-card-sub">
        {lead.phone} &bull; {lead.location}
      </div>
      {(showBudget || showType) && (
        <div className="lead-card-sub">
          {showBudget && (
            <span className="inline-flex items-center gap-1">
              <Wallet size={12} />
              {lead.budget}
            </span>
          )}
          {showBudget && showType && <span className="mx-1">&bull;</span>}
          {showType ? <span>{lead.type}</span> : null}
        </div>
      )}
      <div className="lead-card-source">
        <LeadSourceIcon source={lead.source} />
        <span>
          {lead.source}
          {lead.sourceDetail ? ` — ${lead.sourceDetail}` : ''}
        </span>
      </div>
      {lead.followupDate && !isClosed ? (
        <div
          className="mt-1 text-[10.5px]"
          style={{
            color: lead.urgent ? 'var(--danger)' : 'var(--text-tertiary)',
            fontWeight: lead.urgent ? 700 : 500,
          }}
        >
          <span className="inline-flex items-center gap-1">
            <Clock size={12} />
            Follow-up: {formatFollowup(lead.followupDate, lead.followupTime)}
          </span>
        </div>
      ) : null}

      <div className="lead-card-actions">
        {canMove && (
          <button
            type="button"
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-[#CCFBF1] bg-[#CCFBF1]/30 px-2 py-1 text-[11px] font-medium text-[#0D9488] transition hover:border-[#0D9488] hover:bg-[#CCFBF1]/50"
            title="Move stage"
            onClick={(event) => {
              event.stopPropagation();
              onMoveStage(lead);
            }}
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
            onClick={(event) => {
              event.stopPropagation();
              onCall(lead);
            }}
            aria-label="Call"
          >
            <Phone size={14} />
          </button>
        )}
        {canEmail && (
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#e5e7eb] bg-white text-[#0D9488] transition hover:border-[#CCFBF1] hover:bg-[#CCFBF1]/20"
            title="Email"
            onClick={(event) => {
              event.stopPropagation();
              onEmail(lead);
            }}
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
            onClick={(event) => {
              event.stopPropagation();
              onMarkLost(lead);
            }}
            aria-label="Mark lost"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
