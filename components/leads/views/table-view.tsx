import React, { useMemo } from "react";
import {
  Phone,
  Mail,
  Calendar,
  UserPlus,
  Search,
  RefreshCw,
  Trash2,
  CalendarCheck,
} from "lucide-react";
import { Lead } from "@/lib/leads/types";
import { useAvailableUsers } from "@/hooks/use-available-users";
import {
  formatFollowup,
  dialablePhone,
  STAGE_STYLES,
  isTerminalStage,
} from "@/lib/leads/lead-helpers";
import { DetailModal } from "@/components/leads/modal-ui/detail-modal";
import { DeleteConfirmModal } from "@/components/leads/modal-ui/delete-confirm-modal";
import { EmailFlowModal } from "@/components/leads/modal-ui/email-flow-modal";
import { FollowupModal } from "@/components/leads/modal-ui/followup-modal";
import { AssignedModal } from "@/components/leads/modal-ui/assigned-modal";
import { ToastContainer, useToast } from "@/components/common/use-toast";

interface TableViewProps {
  loading: boolean;
  leads: Lead[];
  onLeadUpdate: (lead: Lead) => void;
  onLeadDelete: (leadId: number) => void;
  activeMetric: string | null;
  onActiveMetricChange: (metric: string | null) => void;
  user: {
    clerkUserId: string | null;
    fullName: string | null;
  };
}

export default function TableView({
  loading,
  leads,
  onLeadUpdate,
  onLeadDelete,
  activeMetric,
  onActiveMetricChange,
  user
}: TableViewProps) {
  /* ── Shared hooks ── */
  const { toasts, showToast, dismissToast } = useToast();
  const availableUsers = useAvailableUsers();

  /* ── Modal pointers (only which lead — each modal manages its own state) ── */
  const [detailLead, setDetailLead] = React.useState<Lead | null>(null);
  const [leadToDelete, setLeadToDelete] = React.useState<Lead | null>(null);
  const [emailLead, setEmailLead] = React.useState<Lead | null>(null);
  const [followupLead, setFollowupLead] = React.useState<Lead | null>(null);
  const [assignedLead, setAssignedLead] = React.useState<Lead | null>(null);

  /* ── Filter logic ── */
  const activeFilters = useMemo(() => {
    if (!activeMetric) return ["all"];
    if (activeMetric.includes("total")) return ["all"];
    if (activeMetric.includes("converted")) return ["Won", "Converted"];
    if (activeMetric.includes("pendingFollowup")) return ["In Follow-up"];
    if (activeMetric.includes("lost"))
      return ["Lost", "Cancelled", "Disqualified"];
    return activeMetric.split(",").map((s) => s.trim());
  }, [activeMetric]);

  const toggleFilter = (stage: string) => {
    if (stage === "all") return onActiveMetricChange(null);
    if (activeFilters.includes(stage)) {
      const next = activeFilters.filter((s) => s !== stage);
      onActiveMetricChange(next.length === 0 ? null : next.join(","));
    } else {
      const next = [...activeFilters.filter((s) => s !== "all"), stage];
      onActiveMetricChange(next.join(","));
    }
  };

  const handleCall = (lead: Lead) => {
    const dial = dialablePhone(lead.phone);
    if (dial) window.location.assign(`tel:${dial}`);
  };

  const redirectToScheduleMeeting = (lead: Lead) => {
    const url = `/book-consultation?TeammateName=${user?.fullName ?? ''}&name=${lead.name}&email=${lead.email}&id=${lead.id}`;
    window.location.assign(url);
  }

  /* ── Render ── */
  return (
    <div className="table-view">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      <div className="table-card">
        <div className="table-header">
          <div className="table-header-row">
            <div className="table-filters">
              <div className="filter-chips">
                {[
                  "all",
                  "New",
                  "Contacted",
                  "Meeting Scheduled",
                  "In Follow-up",
                  "Qualified",
                  "Quoted",
                  "Negotiating",
                  // "Won",
                  "Converted",
                  "No Response",
                  //"Cancelled",
                  "Disqualified",
                  "Lost",
                ].map((stage) => (
                  <button
                    key={stage}
                    className={`filter-chip ${activeFilters.includes(stage) ? "active" : ""}`}
                    onClick={() => toggleFilter(stage)}
                  >
                    {stage === "all" ? "All" : stage}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {leads.length === 0 ? (
          <div className="table-empty">
            <Search size={32} />
            <p>No leads match your search.</p>
          </div>
        ) : (
          <>
            <div className="table-wrapper">
              <table className="leads-table">
                <thead>
                  <tr>
                    <th className="col-lead">Lead</th>
                    <th className="col-phone">Phone</th>
                    <th className="col-location">Location</th>
                    <th className="col-source">Source Detail</th>
                    <th className="col-stage">Stage</th>
                    <th className="col-followup">Follow-up</th>
                    <th className="col-assigned">Assigned</th>
                    <th className="col-actions">Actions</th>
                  </tr>
                </thead>
                {!loading ? (
                  <tbody>
                    {leads.map((lead) => (
                      <tr
                        key={lead.id}
                        className={
                          lead.urgent ? "urgent-row bg-rose-50/50" : ""
                        }
                        onClick={() => setDetailLead(lead)}
                      >
                        <td className="col-lead">
                          <div className="cell-name">
                            {lead.urgent && (
                              <span className="urgent-dot inline-block size-2 rounded-full bg-rose-600 animate-pulse" />
                            )}
                            <div className="cell-name-text">
                              <strong>{lead.name}</strong>
                              <small>{lead.email}</small>
                            </div>
                          </div>
                        </td>
                        <td className="col-phone">{lead.phone}</td>
                        <td className="col-location">{lead.location}</td>
                        <td className="col-source-detail">
                          {lead.sourceDetail}
                        </td>
                        <td className="col-stage">
                          <span
                            className={`stage-badge ${STAGE_STYLES[lead.stage]}`}
                          >
                            {lead.stage}
                          </span>
                        </td>
                        <td className="col-followup">
                          {!lead.followupDate || !lead.followupTime ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-[color:var(--royal-gold)] hover:bg-[color:var(--royal-gold-light)] hover:text-[color:var(--royal-gold)]"
                              onClick={(e) => {
                                e.stopPropagation();
                                setFollowupLead(lead);
                              }}
                              title="Set Follow-up"
                            >
                              <Calendar size={12} />
                              <span>Set date</span>
                            </button>
                          ) : (
                            <span
                              className={`followup-date-text cursor-pointer transition-colors hover:text-[color:var(--royal-gold)] ${lead.urgent ? "followup-urgent text-[color:var(--destructive)] font-semibold hover:text-[color:var(--destructive)]" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setFollowupLead(lead);
                              }}
                            >
                              {formatFollowup(
                                lead.followupDate,
                                lead.followupTime,
                              )}
                            </span>
                          )}
                        </td>
                        <td className="col-assigned">
                          {!lead.assignedId ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-[color:var(--royal-gold)] hover:bg-[color:var(--royal-gold-light)] hover:text-[color:var(--royal-gold)]"
                              onClick={(e) => {
                                e.stopPropagation();
                                setAssignedLead(lead);
                              }}
                              title="Assign Lead"
                            >
                              <UserPlus size={12} />
                              <span>Assign</span>
                            </button>
                          ) : (
                            <span
                              className="assigned-name cursor-pointer transition-colors hover:text-[color:var(--royal-gold)]"
                              onClick={(e) => {
                                e.stopPropagation();
                                setAssignedLead(lead);
                              }}
                            >
                              {lead.assignedUser?.name}
                            </span>
                          )}
                        </td>
                        <td className="col-actions">
                          <div className="action-buttons">
                            {!isTerminalStage(lead.stage) && (
                              <button
                                type="button"
                                className="action-btn-icon"
                                title={`Call ${lead.name}`}
                                aria-label={`Call ${lead.name}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCall(lead);
                                }}
                              >
                                <Phone size={15} />
                              </button>
                            )}
                            {lead.email && (
                              <button
                                type="button"
                                className="action-btn-icon"
                                title={`Send follow-up email to ${lead.name}`}
                                aria-label={`Send follow-up email to ${lead.name}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEmailLead(lead);
                                }}
                              >
                                <Mail size={15} />
                              </button>
                            )}
                            {isTerminalStage(lead.stage) && (
                              <button
                                type="button"
                                className="action-btn-icon"
                                title={`Delete ${lead.name}`}
                                aria-label={`Delete ${lead.name}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setLeadToDelete(lead);
                                }}
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                            <button
                              type="button"
                              className="action-btn-icon"
                              title={`Meeting schedule for ${lead.name}`}
                              aria-label={`Meeting schedule for ${lead.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                redirectToScheduleMeeting(lead);
                              }}
                            >
                              <CalendarCheck size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ) : (
                  <tbody>
                    <tr>
                      <td colSpan={8} className="px-4 py-16 text-center">
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
                      </td>
                    </tr>
                  </tbody>
                )}
              </table>
            </div>
            <div className="mobile-lead-list">
              {leads.map((lead) => (
                <article
                  key={lead.id}
                  className={`mobile-lead-card ${lead.urgent ? "urgent" : ""}`}
                >
                  <button
                    type="button"
                    className="mobile-lead-main"
                    onClick={() => setDetailLead(lead)}
                    aria-label={`Open ${lead.name} lead details`}
                  >
                    <span className="mobile-lead-name-row">
                      <span className="mobile-lead-name">
                        {lead.urgent && (
                          <span className="urgent-dot inline-block size-2 rounded-full bg-rose-600 animate-pulse" />
                        )}
                        {lead.name}
                      </span>
                      <span className={`stage-badge ${STAGE_STYLES[lead.stage]}`}>
                        {lead.stage}
                      </span>
                    </span>
                    <span className="mobile-lead-email">
                      {lead.email || lead.phone || "No contact saved"}
                    </span>
                  </button>

                  <dl className="mobile-lead-meta">
                    <div>
                      <dt>Follow-up</dt>
                      <dd>
                        {!lead.followupDate || !lead.followupTime ? (
                          <button
                            type="button"
                            className="mobile-inline-action"
                            onClick={() => setFollowupLead(lead)}
                          >
                            Set date
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="mobile-link-action"
                            onClick={() => setFollowupLead(lead)}
                          >
                            {formatFollowup(lead.followupDate, lead.followupTime)}
                          </button>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Assigned</dt>
                      <dd>
                        <button
                          type="button"
                          className="mobile-link-action"
                          onClick={() => setAssignedLead(lead)}
                        >
                          {lead.assignedUser?.name || "Assign"}
                        </button>
                      </dd>
                    </div>
                  </dl>

                  <div className="mobile-lead-actions">
                    {!isTerminalStage(lead.stage) && (
                      <button
                        type="button"
                        className="mobile-action-btn"
                        onClick={() => handleCall(lead)}
                        aria-label={`Call ${lead.name}`}
                      >
                        <Phone size={15} />
                        Call
                      </button>
                    )}
                    {lead.email && (
                      <button
                        type="button"
                        className="mobile-action-btn"
                        onClick={() => setEmailLead(lead)}
                        aria-label={`Send follow-up email to ${lead.name}`}
                      >
                        <Mail size={15} />
                        Email
                      </button>
                    )}
                    <button
                      type="button"
                      className="mobile-action-btn"
                      onClick={() => redirectToScheduleMeeting(lead)}
                      aria-label={`Meeting Schedule for ${lead.name}`}
                    >
                      <CalendarCheck size={15} />
                      Actions
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Modals ── */}
      {detailLead && (
        <DetailModal
          lead={detailLead}
          onClose={() => setDetailLead(null)}
          onLeadUpdate={(updated, options) => {
            onLeadUpdate(updated);
            setDetailLead(options?.keepOpen ? updated : null);
          }}
          onDeleteClick={(lead) => setLeadToDelete(lead)}
          showToast={showToast}
          availableUsers={availableUsers}
        />
      )}

      {leadToDelete && (
        <DeleteConfirmModal
          lead={leadToDelete}
          onClose={() => setLeadToDelete(null)}
          onDeleted={(id) => {
            onLeadDelete(id);
            setLeadToDelete(null);
            setDetailLead(null);
          }}
          showToast={showToast}
        />
      )}

      {emailLead && (
        <EmailFlowModal
          lead={emailLead}
          onClose={() => setEmailLead(null)}
          onLeadUpdate={onLeadUpdate}
          showToast={showToast}
        />
      )}

      {followupLead && (
        <FollowupModal
          lead={followupLead}
          onClose={() => setFollowupLead(null)}
          onLeadUpdate={onLeadUpdate}
          showToast={showToast}
        />
      )}

      {assignedLead && (
        <AssignedModal
          lead={assignedLead}
          onClose={() => setAssignedLead(null)}
          onLeadUpdate={onLeadUpdate}
          showToast={showToast}
          availableUsers={availableUsers}
        />
      )}
    </div>
  );
}
