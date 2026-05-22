import React, { useMemo, useState } from 'react';
import { Calendar, Phone, Mail, CheckCircle, X, Check, Bell, Clock, User, AlertCircle } from 'lucide-react';
import { EmailTemplate, Lead } from '@/lib/leads/types';
import { EMAIL_TEMPLATES } from '@/lib/leads/variables';
import { sendEmailToLead } from '@/lib/leads/leads-service';

interface FollowupsViewProps {
  leads: Lead[];
  onLeadUpdate: (lead: Lead) => void;
  onLeadDelete: (leadId: number) => void;
}

function dialablePhone(phone: string) {
  return phone.replace(/[^0-9+]/g, '');
}

const STAGE_CONFIG: Record<string, { bg: string; color: string; dot: string }> = {
  New: { bg: 'rgba(59, 166, 241, 0.08)', color: '#0D9488', dot: '#0D9488' },
  Contacted: { bg: 'rgba(245, 158, 11, 0.08)', color: '#D97706', dot: '#F59E0B' },
  Qualified: { bg: 'rgba(22, 163, 74, 0.08)', color: '#16A34A', dot: '#16A34A' },
  Quoted: { bg: 'rgba(124, 58, 237, 0.08)', color: '#7C3AED', dot: '#7C3AED' },
  Negotiating: { bg: 'rgba(236, 72, 153, 0.08)', color: '#EC4899', dot: '#EC4899' },
  Won: { bg: 'rgba(22, 163, 74, 0.08)', color: '#16A34A', dot: '#16A34A' },
  Lost: { bg: 'rgba(220, 38, 38, 0.08)', color: '#DC2626', dot: '#DC2626' },
};

function getStageConfig(stage: string) {
  return STAGE_CONFIG[stage] || { bg: 'rgba(100,116,139,0.08)', color: '#64748B', dot: '#64748B' };
}

export default function FollowupsView({ leads, onLeadUpdate, onLeadDelete }: FollowupsViewProps) {
  const upcomingFollowups = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return leads
      .filter(lead => lead.followupDate && lead.followupDate > today && lead.stage !== 'Won' && lead.stage !== 'Lost')
      .sort((a, b) => (a.followupDate || '').localeCompare(b.followupDate || ''))
      .slice(0, 10);
  }, [leads]);

  const pendingFollowups = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return leads.filter(lead => lead.followupDate && lead.followupDate <= today && lead.stage !== 'Won' && lead.stage !== 'Lost');
  }, [leads]);

  const stats = useMemo(() => {
    return {
      pending: pendingFollowups.length,
      upcoming: upcomingFollowups.length,
      byStage: {
        new: leads.filter(l => l.stage === 'New').length,
        contacted: leads.filter(l => l.stage === 'Contacted').length,
        qualified: leads.filter(l => l.stage === 'Qualified').length,
      },
    };
  }, [leads, pendingFollowups, upcomingFollowups]);

  return (
    <div className="followups-view">
      <div className="followups-grid">
        {/* ─── Main Column ─── */}
        <div className="followups-main">
          <div className="fu-card">
            <div className="fu-card-header">
              <div className="fu-card-header-left">
                <Calendar size={16} className="fu-card-header-icon" />
                <h3 className="fu-card-title">Follow-up Schedule</h3>
              </div>
              <span className="fu-pending-badge">
                <span className="fu-pending-pulse" />
                {stats.pending} pending
              </span>
            </div>
            <div className="fu-list">
              {pendingFollowups.length === 0 ? (
                <div className="fu-empty">
                  <div className="fu-empty-icon">
                    <Calendar size={28} />
                  </div>
                  <p className="fu-empty-title">All caught up!</p>
                  <p className="fu-empty-desc">No pending follow-ups at the moment.</p>
                </div>
              ) : (
                pendingFollowups.map((lead, index) => (
                  <FollowupItem key={lead.id} lead={lead} index={index} onLeadUpdate={onLeadUpdate} onLeadDelete={onLeadDelete} />
                ))
              )}
            </div>
          </div>
        </div>

        {/* ─── Sidebar ─── */}
        <div className="followups-sidebar">
          {/* Upcoming Reminders Card */}
          <div className="fu-card">
            <div className="fu-card-header">
              <div className="fu-card-header-left">
                <Bell size={16} className="fu-card-header-icon" />
                <h3 className="fu-card-title">Upcoming Reminders</h3>
              </div>
            </div>
            <div className="fu-reminders">
              {upcomingFollowups.slice(0, 5).map(lead => {
                const sc = getStageConfig(lead.stage);
                return (
                  <div key={lead.id} className="fu-reminder-item" style={{ '--reminder-accent': sc.dot } as React.CSSProperties}>
                    <div className="fu-reminder-date-col">
                      <span className="fu-reminder-day-label">{formatDate(lead.followupDate)}</span>
                    </div>
                    <div className="fu-reminder-info">
                      <span className="fu-reminder-name">{lead.name}</span>
                      <span className="fu-reminder-time">{lead.followupTime}</span>
                    </div>
                  </div>
                );
              })}
              {upcomingFollowups.length === 0 && (
                <div className="fu-empty-mini">
                  <Clock size={18} />
                  <span>No upcoming reminders</span>
                </div>
              )}
            </div>
          </div>

          {/* Quick Stats Card */}
          <div className="fu-card">
            <div className="fu-card-header">
              <div className="fu-card-header-left">
                <AlertCircle size={16} className="fu-card-header-icon" />
                <h3 className="fu-card-title">Quick Stats</h3>
              </div>
            </div>
            <div className="fu-stats">
              <StatItem label="Pending Follow-ups" value={stats.pending} color="#DC2626" />
              <StatItem label="Upcoming" value={stats.upcoming} color="#0D9488" />
              <StatItem label="New Leads" value={stats.byStage.new} color="#0D9488" />
              <StatItem label="Contacted" value={stats.byStage.contacted} color="#F59E0B" />
              <StatItem label="Qualified" value={stats.byStage.qualified} color="#16A34A" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface FollowupItemProps {
  lead: Lead;
  index: number;
  onLeadUpdate: (lead: Lead) => void;
  onLeadDelete: (leadId: number) => void;
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

function FollowupItem({ lead, index, onLeadUpdate, onLeadDelete }: FollowupItemProps) {


  const PLACEHOLDER_PATTERN = /\{([^}]+)\}/g;

  const [emailLead, setEmailLead] = useState<Lead | null>(null);
  const [showEmailTemplates, setShowEmailTemplates] = useState(false);
  const [showSendEmail, setShowSendEmail] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const emailBodyRef = React.useRef<HTMLDivElement>(null);

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

  const handleCall = (lead: Lead) => {
    const dial = dialablePhone(lead.phone);
    if (!dial) return;
    window.location.href = `tel:${dial}`;
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

  const handleTemplateSelect = (template: EmailTemplate) => {
    if (!emailLead) return;
    const draft = buildEmailDraft(template, emailLead);
    setSelectedTemplate(template);
    setEmailSubject(draft.subject);
    setEmailBody(draft.body);
    setShowEmailTemplates(false);
    setShowSendEmail(true);
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

  const closeSendEmail = () => {
    setShowSendEmail(false);
    setSelectedTemplate(null);
  };

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

  const stageConfig = getStageConfig(lead.stage);
  const todayStr = new Date().toISOString().split('T')[0];
  const isToday = lead.followupDate === todayStr;

  return (
    <div className={`fu-item ${isToday ? 'fu-item-today' : ''}`}>

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

      {/* Timeline connector line */}
      <div className="fu-timeline-track">
        <div
          className="fu-timeline-dot"
          style={{ background: isToday ? '#F59E0B' : stageConfig.dot }}
        >
          {index + 1}
        </div>
      </div>

      {/* Card content */}
      <div className="fu-item-body">
        <div className="fu-item-top">
          <div className="fu-item-name-row">
            <span className="fu-item-name">{lead.name}</span>
            <span
              className="fu-stage-pill"
              style={{
                background: isToday ? 'rgba(245, 158, 11, 0.15)' : stageConfig.bg,
                color: isToday ? '#F59E0B' : stageConfig.color,
              }}
            >
              {lead.stage}
            </span>
          </div>
          <div className="fu-item-meta">
            <span className="fu-meta-chip">
              <Calendar size={12} />
              {formatDate(lead.followupDate)}
            </span>
            <span className="fu-meta-chip">
              <Clock size={12} />
              {lead.followupTime}
            </span>
            <span className="fu-meta-chip">
              <User size={12} />
              {lead.assigned}
            </span>
          </div>
        </div>

        {lead.followupNotes && (
          <div className="fu-notes-block">
            {lead.followupNotes}
          </div>
        )}

        <div className="fu-item-actions">
          <button
            type="button"
            className="fu-action-btn fu-action-call"
            title="Call"
            onClick={(event) => {
              event.stopPropagation();
              handleCall(lead);
            }}>
            <Phone size={14} />
            <span>Call</span>
          </button>
          <button
            className="fu-action-btn fu-action-email"
            title="Follow-up Email"
            onClick={(event) => {
              event.stopPropagation();
              openEmailTemplates(lead);
            }}
          >
            <Mail size={14} />
            <span>Email</span>
          </button>
        </div>
      </div>
    </div>
  );
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

interface StatItemProps {
  label: string;
  value: number;
  color: string;
}

function StatItem({ label, value, color }: StatItemProps) {
  return (
    <div className="fu-stat-row">
      <div className="fu-stat-indicator" style={{ background: `${color}18`, border: `1.5px solid ${color}40` }}>
        <div className="fu-stat-dot" style={{ backgroundColor: color }} />
      </div>
      <div className="fu-stat-text">
        <span className="fu-stat-label">{label}</span>
        <span className="fu-stat-value">{value}</span>
      </div>
    </div>
  );
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todayStr = today.toISOString().split('T')[0];
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  if (dateStr === todayStr) return 'Today';
  if (dateStr === tomorrowStr) return 'Tomorrow';

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  });
}
