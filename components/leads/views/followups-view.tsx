import React, { useMemo, useState } from "react";
import {
  Calendar,
  Phone,
  Mail,
  Bell,
  Clock,
  User,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Lead } from "@/lib/leads/types";
import { EmailFlowModal } from "@/components/leads/modal-ui/email-flow-modal";
import { dialablePhone } from "@/lib/leads/lead-helpers";

interface FollowupsViewProps {
  loading: boolean;
  leads: Lead[];
  onLeadUpdate: (lead: Lead) => void;
  onLeadDelete: (leadId: number) => void;
  showToast: (message: string, type?: "success" | "info") => void;
}

const STAGE_CONFIG: Record<string, { bg: string; color: string; dot: string }> = {
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

/**
 * Helper to get date string in YYYY-MM-DD format for Australia/Sydney timezone.
 * Supports adding offset days (e.g. 1 for tomorrow).
 */
function getAustralianDateString(offsetDays = 0): string {
  const date = new Date();
  if (offsetDays !== 0) {
    date.setDate(date.getDate() + offsetDays);
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;

  return `${year}-${month}-${day}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr + "T00:00:00");

  const todayStr = getAustralianDateString(0);
  const tomorrowStr = getAustralianDateString(1);

  if (dateStr === todayStr) return "Today";
  if (dateStr === tomorrowStr) return "Tomorrow";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    weekday: "short",
  });
}


/* ══════════════════════════════════════════════
   FOLLOWUP ITEM
   ══════════════════════════════════════════════ */

interface FollowupItemProps {
  lead: Lead;
  index: number;
  onLeadUpdate: (lead: Lead) => void;
  onLeadDelete: (leadId: number) => void;
  showToast: (message: string, type?: "success" | "info") => void;
}

function FollowupItem({
  lead,
  index,
  onLeadUpdate,
  // onLeadDelete, // available if needed later
  showToast,
}: FollowupItemProps) {
  const [showEmailModal, setShowEmailModal] = useState(false);

  const handleCall = () => {
    const dial = dialablePhone(lead.phone);
    if (dial) window.location.href = `tel:${dial}`;
  };

  const stageConfig = getStageConfig(lead.stage);
  const todayStr = getAustralianDateString(0);
  const isToday = lead.followupDate === todayStr;


  return (
    <div className={`fu-item ${isToday ? "fu-item-today" : ""}`}>
      {showEmailModal && (
        <EmailFlowModal
          lead={lead}
          onClose={() => setShowEmailModal(false)}
          onLeadUpdate={onLeadUpdate}
          showToast={showToast}
        />
      )}

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
              {lead.assignedUser?.name || "Unassigned"}
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
            title={`Call ${lead.name}`}
            aria-label={`Call ${lead.name}`}
            onClick={(event) => {
              event.stopPropagation();
              handleCall();
            }}
          >
            <Phone size={14} />
            <span>Call</span>
          </button>
          <button
            type="button"
            className="fu-action-btn fu-action-email"
            title={`Send follow-up email to ${lead.name}`}
            aria-label={`Send follow-up email to ${lead.name}`}
            onClick={(event) => {
              event.stopPropagation();
              setShowEmailModal(true);
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

/* ══════════════════════════════════════════════
   STAT ITEM
   ══════════════════════════════════════════════ */

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

/* ══════════════════════════════════════════════
   MAIN VIEW
   ══════════════════════════════════════════════ */

export default function FollowupsView({
  loading,
  leads,
  onLeadUpdate,
  onLeadDelete,
  showToast,
}: FollowupsViewProps) {
  const upcomingFollowups = useMemo(() => {
    const today = getAustralianDateString(0);
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
    const today = getAustralianDateString(0);
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
                    showToast={showToast}
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
