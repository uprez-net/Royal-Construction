import React, { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  Phone,
  Mail,
  CheckCircle,
  X,
  Check,
  Bell,
  Clock,
  User,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { EmailTemplate, Lead } from "@/lib/leads/types";
import { EMAIL_TEMPLATES } from "@/lib/leads/variables";
import { sendEmailToLead } from "@/lib/leads/leads-service";
import { renderEmailHtml } from "@/lib/leads/render-email-html";
import { Button } from "@/components/ui/button";

interface FollowupsViewProps {
  loading: boolean;
  leads: Lead[];
  onLeadUpdate: (lead: Lead) => void;
  onLeadDelete: (leadId: number) => void;
}

interface ReactEmailPreviewProps {
  category: string;
  lead: Lead | null;
}

function dialablePhone(phone: string) {
  return phone.replace(/[^0-9+]/g, "");
}

function ReactEmailIframe({ category, lead }: ReactEmailPreviewProps) {
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    renderEmailHtml(category, lead)
      .then((result) => {
        if (!cancelled) {
          setHtml(result || "");
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [category, lead]);

  if (loading) {
    return (
      <div className="flex h-[480px] items-center justify-center rounded-lg border border-border bg-muted/10">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-teal-600" />
      </div>
    );
  }

  if (!html) {
    return (
      <div className="py-8 text-center text-xs text-muted-foreground">
        No preview available
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-lg border border-border"
      style={{ height: 480 }}
    >
      <iframe
        title={`${category} Email Preview`}
        srcDoc={html}
        className="w-full h-full"
        sandbox="allow-same-origin allow-scripts"
        style={{ border: "none" }}
      />
    </div>
  );
}

const STAGE_CONFIG: Record<string, { bg: string; color: string; dot: string }> =
  {
    New: { bg: "rgba(59, 166, 241, 0.08)", color: "#0D9488", dot: "#0D9488" },
    Contacted: {
      bg: "rgba(245, 158, 11, 0.08)",
      color: "#D97706",
      dot: "#F59E0B",
    },
    Qualified: {
      bg: "rgba(22, 163, 74, 0.08)",
      color: "#16A34A",
      dot: "#16A34A",
    },
    Quoted: {
      bg: "rgba(124, 58, 237, 0.08)",
      color: "#7C3AED",
      dot: "#7C3AED",
    },
    Negotiating: {
      bg: "rgba(236, 72, 153, 0.08)",
      color: "#EC4899",
      dot: "#EC4899",
    },
    Won: { bg: "rgba(22, 163, 74, 0.08)", color: "#16A34A", dot: "#16A34A" },
    Lost: { bg: "rgba(220, 38, 38, 0.08)", color: "#DC2626", dot: "#DC2626" },
  };

function getStageConfig(stage: string) {
  return (
    STAGE_CONFIG[stage] || {
      bg: "rgba(100,116,139,0.08)",
      color: "#64748B",
      dot: "#64748B",
    }
  );
}

// ── Hydrate Subject Placeholders ────────────────────────────────────────────
const PLACEHOLDER_PATTERN = /\{([^}]+)\}/g;

function formatShortDate(date: Date): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function hydrateSubject(text: string, lead: Lead): string {
  const typeStr = Array.isArray(lead.type)
    ? (lead.type[0] ?? "New Home Build")
    : lead.type;
  const values: Record<string, string> = {
    name: lead.name,
    location: lead.location,
    type: typeStr,
    phone: lead.phone,
    project: `${typeStr} at ${lead.location}`,
    notes: lead.notes || "Previous discussion details",
    amount: lead.budget !== "Not Discussed" ? lead.budget : "TBD",
    duration: "6-8 months",
    date: formatShortDate(new Date()),
    time: "10:00 AM",
    milestone: "Foundation Complete",
    nextMilestone: "Frame Stage",
    originalAmount: "$480,000",
    variationAmount: "$4,500",
    revisedAmount: "$484,500",
  };

  return text.replace(
    PLACEHOLDER_PATTERN,
    (_, key) => values[key] ?? `{${key}}`,
  );
}

function previewTemplateText(text: string) {
  return text.replace(PLACEHOLDER_PATTERN, "...");
}

function getTemplateDescription(template: EmailTemplate): string {
  switch (template.category) {
    case "Welcome":
      return "Welcome new clients to Royal Constructions. Makes the builder appointment booking the first action, then requests land information, project priorities, build type, location, timeline, existing documents, and design ideas.";
    case "Quotation":
      return "Send a professional and customized project quotation. Details the scope of work, budget, itemized breakdowns, and easy next steps for client approval.";
    case "Follow-up":
      return "Keep the momentum going with qualified leads. Recaps previous consultations, addresses open questions, and prompts for scheduling next steps.";
    case "Catalogue":
      return "Provide clients with our comprehensive finishes and material catalogue. Designed to let clients browse exterior cladding, finishes, and paint selections.";
    case "Variation":
      return "Formal project variation summary. Details requested changes, contract adjustments, revised pricing, and options for sign-off.";
    case "Promotion":
      return "Offer a special limited-time promotional discount or upgrade bundle to incentivize hot leads to move forward with signing.";
    case "Meeting":
      return "Confirm a site meeting or consultant visit details. Includes appointment date, time, location maps, and contact information.";
    case "Update":
      return "Auto-generated construction milestone progress update. Informs the client about current status, completed tasks, and upcoming milestones.";
    default:
      return "Curated and professionally designed email template adhering to brand standards to streamline client communications.";
  }
}

export default function FollowupsView({
  loading,
  leads,
  onLeadUpdate,
  onLeadDelete,
}: FollowupsViewProps) {
  const upcomingFollowups = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    return leads
      .filter(
        (lead) =>
          lead.followupDate &&
          lead.followupDate > today &&
          lead.stage !== "Won" &&
          lead.stage !== "Lost",
      )
      .sort((a, b) =>
        (a.followupDate || "").localeCompare(b.followupDate || ""),
      )
      .slice(0, 10);
  }, [leads]);

  const pendingFollowups = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    return leads.filter(
      (lead) =>
        lead.followupDate &&
        lead.followupDate <= today &&
        lead.stage !== "Won" &&
        lead.stage !== "Lost",
    );
  }, [leads]);

  const stats = useMemo(() => {
    return {
      pending: pendingFollowups.length,
      upcoming: upcomingFollowups.length,
      byStage: {
        new: leads.filter((l) => l.stage === "New").length,
        contacted: leads.filter((l) => l.stage === "Contacted").length,
        qualified: leads.filter((l) => l.stage === "Qualified").length,
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
                  <p className="fu-empty-desc">
                    No pending follow-ups at the moment.
                  </p>
                </div>
              ) : (
                pendingFollowups.map((lead, index) => (
                  <FollowupItem
                    key={lead.id}
                    lead={lead}
                    index={index}
                    onLeadUpdate={onLeadUpdate}
                    onLeadDelete={onLeadDelete}
                  />
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
            {!loading ? (
              <div className="fu-reminders">
                {upcomingFollowups.slice(0, 5).map((lead) => {
                  const sc = getStageConfig(lead.stage);
                  return (
                    <div
                      key={lead.id}
                      className="fu-reminder-item"
                      style={
                        { "--reminder-accent": sc.dot } as React.CSSProperties
                      }
                    >
                      <div className="fu-reminder-date-col">
                        <span className="fu-reminder-day-label">
                          {formatDate(lead.followupDate)}
                        </span>
                      </div>
                      <div className="fu-reminder-info">
                        <span className="fu-reminder-name">{lead.name}</span>
                        <span className="fu-reminder-time">
                          {lead.followupTime}
                        </span>
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
            ) : (
              <div className="flex flex-col items-center justify-center gap-3">
                <div className="flex size-12 items-center justify-center">
                  <RefreshCw className="animate-spin size-5 text-muted-foreground" />
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    Loading leads...
                  </p>

                  <p className="text-xs text-muted-foreground">
                    Your leads will appear here.
                  </p>
                </div>
              </div>
            )}
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
              <StatItem
                label="Pending Follow-ups"
                value={stats.pending}
                color="#DC2626"
              />
              <StatItem
                label="Upcoming"
                value={stats.upcoming}
                color="#0D9488"
              />
              <StatItem
                label="New Leads"
                value={stats.byStage.new}
                color="#0D9488"
              />
              <StatItem
                label="Contacted"
                value={stats.byStage.contacted}
                color="#F59E0B"
              />
              <StatItem
                label="Qualified"
                value={stats.byStage.qualified}
                color="#16A34A"
              />
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

function FollowupItem({
  lead,
  index,
  onLeadUpdate,
  onLeadDelete,
}: FollowupItemProps) {
  const [emailLead, setEmailLead] = useState<Lead | null>(null);
  const [showEmailTemplates, setShowEmailTemplates] = useState(false);
  const [showSendEmail, setShowSendEmail] = useState(false);
  const [selectedTemplate, setSelectedTemplate] =
    useState<EmailTemplate | null>(null);
  const [emailSubject, setEmailSubject] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);

  // Toast state
  const [toasts, setToasts] = useState<
    { id: number; message: string; type: "success" | "info" }[]
  >([]);

  const showToast = (message: string, type: "success" | "info" = "success") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
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
    setEmailSubject("");
  };

  const closeEmailTemplates = () => {
    setShowEmailTemplates(false);
  };

  const handleTemplateSelect = (template: EmailTemplate) => {
    if (!emailLead) return;
    setSelectedTemplate(template);
    setEmailSubject(hydrateSubject(template.subject, emailLead));
    setShowEmailTemplates(false);
    setShowSendEmail(true);
  };

  const handleSendEmail = async () => {
    if (!emailLead || !selectedTemplate) return;
    setSendingEmail(true);

    try {
      const finalHtmlBody = await renderEmailHtml(
        selectedTemplate.category,
        emailLead,
      );

      if (!finalHtmlBody) {
        showToast("Failed to generate email content", "info");
        setSendingEmail(false);
        return;
      }

      const sendCampaign = await sendEmailToLead(
        emailLead.email,
        emailSubject,
        finalHtmlBody,
      );

      if (sendCampaign) {
        showToast(`Email sent to ${emailLead.name} Successfully`, "success");
        const now = new Date();
        const historyEntry: Lead["history"][number] = {
          date: now.toISOString().slice(0, 10),
          time: now.toTimeString().slice(0, 5),
          action: "Email sent",
          detail: `Subject: ${emailSubject}`,
          type: "email",
        };
        const updatedLead: Lead = {
          ...emailLead,
          history: [...emailLead.history, historyEntry],
        };
        onLeadUpdate(updatedLead);
      } else {
        showToast(`Failed to send email to ${emailLead.name}`, "info");
      }
    } catch (error) {
      console.error("Error sending email:", error);
      showToast("An unexpected error occurred", "info");
    } finally {
      setSendingEmail(false);
      closeSendEmail();
    }
  };

  const closeSendEmail = () => {
    setShowSendEmail(false);
    setSelectedTemplate(null);
  };

  const stageConfig = getStageConfig(lead.stage);
  const todayStr = new Date().toISOString().split("T")[0];
  const isToday = lead.followupDate === todayStr;

  return (
    <div className={`fu-item ${isToday ? "fu-item-today" : ""}`}>
      {/* ═══ TOAST NOTIFICATIONS ═══ */}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast-item toast-${toast.type}`}>
              <div
                className="toast-icon-wrapper"
                style={{
                  background:
                    toast.type === "success"
                      ? "rgba(22,163,74,0.1)"
                      : "rgba(37,99,235,0.1)",
                  color: toast.type === "success" ? "#16A34A" : "#2563EB",
                }}
              >
                {toast.type === "success" ? (
                  <Check size={15} />
                ) : (
                  <Bell size={15} />
                )}
              </div>
              <span className="toast-msg">{toast.message}</span>
              <button
                className="toast-close"
                onClick={() =>
                  setToasts((prev) => prev.filter((t) => t.id !== toast.id))
                }
              >
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
              Sending to: <span className="font-medium">{emailLead.name}</span>{" "}
              - {emailLead.email || "No email"}
            </div>
          ) : (
            <div className="rounded-[10px] border border-[#e5e7eb] bg-[#fafaf9] px-4 py-3 text-sm text-[#78716c]">
              Select a template, then choose a lead to send it to.
            </div>
          )}
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {EMAIL_TEMPLATES.map((template) => (
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
        subtitle={
          emailLead
            ? `To: ${emailLead.name} (${emailLead.email || "No email"})`
            : undefined
        }
        maxWidthClass="max-w-[600px]"
      >
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              To
            </label>
            <input
              className="mt-1 w-full rounded-[4px] border border-[#d6d3d1] bg-[#fafaf9] px-3 py-2 text-sm text-[#78716c]"
              value={emailLead?.email || emailLead?.name || ""}
              readOnly
            />
          </div>
          {selectedTemplate ? (
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <span>Template</span>
              <span className="font-medium text-foreground">
                {selectedTemplate.category}
              </span>
            </div>
          ) : null}
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Subject
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground transition-all focus:border-teal-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/10"
              value={emailSubject}
              readOnly
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Email Preview
            </label>
            {selectedTemplate ? (
              <div className="mt-2">
                <ReactEmailIframe
                  category={selectedTemplate.category}
                  lead={emailLead ?? null}
                />
              </div>
            ) : (
              <div className="mt-2 flex h-32 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                Select a template to preview
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[#0D9488] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#2b8fd6] disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleSendEmail}
              disabled={!emailSubject.trim() || sendingEmail}
            >
              {sendingEmail ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail size={14} />
                  Send Email
                </>
              )}
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-full border border-[#e5e7eb] px-4 py-2 text-xs font-medium text-[#78716c] transition hover:border-[#c9c5c2] hover:bg-[#fafaf9]"
              onClick={closeSendEmail}
              disabled={sendingEmail}
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
          style={{ background: isToday ? "#F59E0B" : stageConfig.dot }}
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
                background: isToday
                  ? "rgba(245, 158, 11, 0.15)"
                  : stageConfig.bg,
                color: isToday ? "#F59E0B" : stageConfig.color,
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
          <div className="fu-notes-block">{lead.followupNotes}</div>
        )}

        <div className="fu-item-actions">
          <button
            type="button"
            className="fu-action-btn fu-action-call"
            title="Call"
            onClick={(event) => {
              event.stopPropagation();
              handleCall(lead);
            }}
          >
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
  maxWidthClass = "max-w-[520px]",
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={handleBackdropMouseDown}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`flex max-h-[90vh] w-full flex-col ${maxWidthClass} rounded-xl bg-background shadow-lg ring-1 ring-border`}
      >
        <div className="shrink-0 flex items-start justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <h4
              className={`text-base font-bold tracking-tight text-foreground ${titleClassName ?? ""}`}
            >
              {title}
            </h4>
            {subtitle ? (
              <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
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
      <div
        className="fu-stat-indicator"
        style={{ background: `${color}18`, border: `1.5px solid ${color}40` }}
      >
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
  if (!dateStr) return "";
  const date = new Date(dateStr + "T00:00:00");
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todayStr = today.toISOString().split("T")[0];
  const tomorrowStr = tomorrow.toISOString().split("T")[0];

  if (dateStr === todayStr) return "Today";
  if (dateStr === tomorrowStr) return "Tomorrow";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    weekday: "short",
  });
}
