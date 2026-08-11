"use client";

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
  CalendarDays,
  CalendarRange,
  TimerReset,
} from "lucide-react";
import { Lead, LeadStage } from "@/lib/leads/types";
import { EmailFlowModal } from "@/components/leads/modal-ui/email-flow-modal";
import { dialablePhone } from "@/lib/leads/lead-helpers";
import { LeadMetricCard } from "@/components/common/lead-onclick-metric-card";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import {
  addDays,
  format,
  parseISO,
  isAfter,
  isBefore,
  isEqual,
  isSameDay,
} from "date-fns";
import { toZonedTime } from "date-fns-tz";

interface FollowupsViewProps {
  loading: boolean;
  leads: Lead[];
  followupStats: {
    totalFollowUps: number;
    pendingFollowUps: number;
    upcomingFollowUps: number;
    totalMeetings: number;
    pendingMeetings: number;
    upcomingMeetings: number;
  } | null;
  onLeadUpdate: (lead: Lead) => void;
  onLeadDelete: (leadId: number) => void;
  showToast: (message: string, type?: "success" | "info" | "error") => void;
}

const STAGE_CONFIG: Record<string, { bg: string; color: string; dot: string }> =
  {
    New: {
      bg: "var(--royal-gold-light)",
      color: "var(--royal-gold)",
      dot: "var(--royal-gold)",
    },
    Contacted: {
      bg: "var(--royal-orange-light)",
      color: "var(--royal-orange)",
      dot: "var(--royal-orange)",
    },
    Qualified: {
      bg: "var(--success-light)",
      color: "var(--success)",
      dot: "var(--success)",
    },
    Quoted: {
      bg: "var(--accent-purple-light)",
      color: "var(--accent-purple)",
      dot: "var(--accent-purple)",
    },
    Negotiating: {
      bg: "var(--info-light)",
      color: "var(--info)",
      dot: "var(--info)",
    },
    Won: {
      bg: "var(--success-light)",
      color: "var(--success)",
      dot: "var(--success)",
    },
    Lost: {
      bg: "var(--destructive-light)",
      color: "var(--destructive)",
      dot: "var(--destructive)",
    },
  };

function getStageConfig(stage: string) {
  return (
    STAGE_CONFIG[stage] || {
      bg: "var(--muted)",
      color: "var(--muted-foreground)",
      dot: "var(--muted-foreground)",
    }
  );
}

function getAustralianDate(offsetDays = 0): Date {
  return addDays(toZonedTime(new Date(), "Australia/Sydney"), offsetDays);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = parseISO(dateStr);
  if (isSameDay(date, getAustralianDate())) {
    return "Today";
  }
  if (isSameDay(date, getAustralianDate(1))) {
    return "Tomorrow";
  }

  return format(date, "EEE, MMM d");
}

interface FollowupItemProps {
  lead: Lead;
  index: number;
  onLeadUpdate: (lead: Lead) => void;
  showToast: (message: string, type?: "success" | "info" | "error") => void;
}

function FollowupItem({
  lead,
  index,
  onLeadUpdate,
  showToast,
}: FollowupItemProps) {
  const [showEmailModal, setShowEmailModal] = useState(false);
  const handleCall = () => {
    const dial = dialablePhone(lead.phone);
    if (dial) window.location.href = `tel:${dial}`;
  };

  const stageConfig = getStageConfig(lead.stage);
  const todayStr = getAustralianDate(0);
  const isToday = isSameDay(parseISO(lead.followupDate || ""), todayStr);

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

      <div className="fu-timeline-track">
        <div
          className="fu-timeline-dot"
          style={{ background: isToday ? "var(--warning)" : stageConfig.dot }}
        >
          {index + 1}
        </div>
      </div>

      <div className="fu-item-body">
        <div className="fu-item-top">
          <div className="fu-item-name-row">
            <span className="fu-item-name">{lead.name}</span>
            <span
              className="fu-stage-pill"
              style={{
                background: isToday ? "var(--warning-light)" : stageConfig.bg,
                color: isToday ? "var(--warning)" : stageConfig.color,
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

function FollowupsView({
  loading,
  leads,
  followupStats,
  onLeadUpdate,
  showToast,
}: FollowupsViewProps) {
  const dispatch = useAppDispatch();

  const relevantLeads = useMemo(
    () =>
      leads.filter(
        (lead) =>
          lead.stage === "Meeting Scheduled" || lead.stage === "In Follow-up",
      ),
    [leads],
  );

  const today = getAustralianDate();

  const pendingFollowups = useMemo(() => {
    return relevantLeads.filter(
      (lead) =>
        lead.stage === "In Follow-up" &&
        lead.followupDate &&
        (isBefore(parseISO(lead.followupDate), today) ||
          isEqual(parseISO(lead.followupDate), today)),
    );
  }, [relevantLeads, today]);

  const upcomingFollowups = useMemo(() => {
    return relevantLeads
      .filter(
        (lead) =>
          lead.stage === "In Follow-up" &&
          lead.followupDate &&
          isAfter(parseISO(lead.followupDate), today),
      )
      .sort(
        (a, b) =>
          parseISO(a.followupDate!).getTime() -
          parseISO(b.followupDate!).getTime(),
      );
  }, [relevantLeads, today]);

  const pendingMeetings = useMemo(() => {
    return relevantLeads.filter(
      (lead) =>
        lead.stage === "Meeting Scheduled" &&
        lead.meetingDate &&
        (isBefore(parseISO(lead.meetingDate), today) ||
          isEqual(parseISO(lead.meetingDate), today)),
    );
  }, [relevantLeads, today]);

  const upcomingMeetings = useMemo(() => {
    return relevantLeads.filter(
      (lead) =>
        lead.stage === "Meeting Scheduled" &&
        lead.meetingDate &&
        isAfter(parseISO(lead.meetingDate), today),
    );
  }, [relevantLeads, today]);

  const stats = followupStats ?? {
    totalFollowUps: pendingFollowups.length + upcomingFollowups.length,
    pendingFollowUps: pendingFollowups.length,
    upcomingFollowUps: upcomingFollowups.length,
    totalMeetings: pendingMeetings.length + upcomingMeetings.length,
    pendingMeetings: pendingMeetings.length,
    upcomingMeetings: upcomingMeetings.length,
  };

  return (
    <div className="followups-view">
      <div className="followups-grid">
        <div className="followups-main">
          <div className="fu-card">
            <div className="fu-card-header">
              <div className="fu-card-header-left">
                <Calendar size={16} className="fu-card-header-icon" />
                <h3 className="fu-card-title">Follow-up Schedule</h3>
              </div>
              <span className="fu-pending-badge">
                <span className="fu-pending-pulse" />
                {stats.pendingFollowUps} pending
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
                    showToast={showToast}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        <div className="followups-sidebar">
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

          <div className="fu-card">
            <div className="fu-card-header">
              <div className="fu-card-header-left">
                <AlertCircle size={16} className="fu-card-header-icon" />
                <h3 className="fu-card-title">Quick Stats</h3>
              </div>
            </div>
            <div className="grid gap-3 p-4 grid-cols-1">
              <LeadMetricCard
                label="Total Follow-ups"
                value={String(stats.totalFollowUps)}
                note="All follow-up leads"
                tone="primary"
                icon={CalendarDays}
                onClick={() =>
                  dispatch(
                    openModal({
                      type: "leadStatsDrilldown",
                      payload: {
                        title: "Total Follow-ups",
                        stage: ["In Follow-up"] as LeadStage[],
                      },
                    }),
                  )
                }
              />
              <LeadMetricCard
                label="Pending Follow-ups"
                value={String(stats.pendingFollowUps)}
                note="Follow-ups due today or earlier"
                tone="danger"
                icon={Clock}
                onClick={() =>
                  dispatch(
                    openModal({
                      type: "leadStatsDrilldown",
                      payload: {
                        title: "Pending Follow-ups",
                        stage: ["In Follow-up"] as LeadStage[],
                        pendingFollowUps: true,
                      },
                    }),
                  )
                }
              />
              <LeadMetricCard
                label="Upcoming Follow-ups"
                value={String(stats.upcomingFollowUps)}
                note="Scheduled after today"
                tone="warning"
                icon={CalendarRange}
                onClick={() =>
                  dispatch(
                    openModal({
                      type: "leadStatsDrilldown",
                      payload: {
                        title: "Upcoming Follow-ups",
                        stage: ["In Follow-up"] as LeadStage[],
                        upcomingFollowUps: true,
                      },
                    }),
                  )
                }
              />
              <LeadMetricCard
                label="Total Meetings"
                value={String(stats.totalMeetings)}
                note="Meeting scheduled leads"
                tone="info"
                icon={Bell}
                onClick={() =>
                  dispatch(
                    openModal({
                      type: "leadStatsDrilldown",
                      payload: {
                        title: "Total Meetings",
                        stage: ["Meeting Scheduled"] as LeadStage[],
                      },
                    }),
                  )
                }
              />
              <LeadMetricCard
                label="Pending Meetings"
                value={String(stats.pendingMeetings)}
                note="Meetings that have passed"
                tone="danger"
                icon={TimerReset}
                onClick={() =>
                  dispatch(
                    openModal({
                      type: "leadStatsDrilldown",
                      payload: {
                        title: "Pending Meetings",
                        stage: ["Meeting Scheduled"] as LeadStage[],
                        pendingMeetings: true,
                      },
                    }),
                  )
                }
              />
              <LeadMetricCard
                label="Upcoming Meetings"
                value={String(stats.upcomingMeetings)}
                note="Meetings still ahead"
                tone="success"
                icon={CalendarDays}
                onClick={() =>
                  dispatch(
                    openModal({
                      type: "leadStatsDrilldown",
                      payload: {
                        title: "Upcoming Meetings",
                        stage: ["Meeting Scheduled"] as LeadStage[],
                        upcomingMeetings: true,
                      },
                    }),
                  )
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default FollowupsView;
