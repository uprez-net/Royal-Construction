import React, { useEffect, useMemo } from "react";
import {
  Phone,
  Mail,
  UserPlus,
  Search,
  RefreshCw,
  CalendarCheck,
  MessageSquare,
  Archive,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Lead } from "@/lib/leads/types";
import { useAvailableUsers } from "@/hooks/use-available-users";
import {
  dialablePhone,
  STAGE_STYLES,
  LEAD_STAGE_OPTIONS,
  isKpiCohortMetric,
  sortLeadOpenTasks,
} from "@/lib/leads/lead-helpers";
import { leadActions } from "@/lib/leads/lead-actions";
import { bookConsultationUrlForLead } from "@/lib/actions/leads";
import { DeleteConfirmModal } from "@/components/leads/modal-ui/delete-confirm-modal";
import { EmailFlowModal } from "@/components/leads/modal-ui/email-flow-modal";
import {
  LeadTaskCell,
  LeadTasksModal,
} from "@/components/leads/modal-ui/lead-tasks-modal";
import { AssignedModal } from "@/components/leads/modal-ui/assigned-modal";
import { ToastContainer, useToast } from "@/components/common/use-toast";
import type { LeadEmails } from "@prisma/client";
import LeadCommModal from "../modal-ui/lead-comm-modal";
import { fetchOpenTasks, type LeadTaskRow } from "@/lib/leads/task-service";
import { useAppSelector } from "@/lib/store/hooks";
import { cn } from "@/lib/utils";

interface TableViewProps {
  loading: boolean;
  leads: Lead[];
  onLeadUpdate: (lead: Lead) => void;
  onLeadDelete: (leadId: number) => void;
  activeMetric: string | null;
  onActiveMetricChange: (metric: string | null) => void;
  appendEmailToLead: (leadId: number, email: LeadEmails) => void;
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
  user,
  appendEmailToLead,
}: TableViewProps) {
  /* ── Shared hooks ── */
  const { toasts, showToast, dismissToast } = useToast();
  const availableUsers = useAvailableUsers();
  const router = useRouter();

  /* ── Modal pointers (only which lead — each modal manages its own state) ── */
  const [leadToDelete, setLeadToDelete] = React.useState<Lead | null>(null);
  const [emailLead, setEmailLead] = React.useState<Lead | null>(null);
  const [tasksLead, setTasksLead] = React.useState<Lead | null>(null);
  const [assignedLead, setAssignedLead] = React.useState<Lead | null>(null);
  const [commLead, setCommLead] = React.useState<string | null>(null);
  const [openTasks, setOpenTasks] = React.useState<LeadTaskRow[]>([]);
  const [tasksLoaded, setTasksLoaded] = React.useState(false);
  // Failed is not the same as empty. Without this the catch marked the fetch
  // loaded with an empty list, so a dropped request rendered the dashed "Add
  // task" pill on every row — the whole table reading as though nobody had a
  // single call booked. The Tasks tab already draws this distinction.
  const [tasksError, setTasksError] = React.useState(false);
  const tasksVersion = useAppSelector((state) => state.ui.leadTasksVersion);

  // Ask for the tasks of the leads on screen, not of the whole business. The
  // unscoped list is capped at the 200 soonest-due, so a lead whose only task
  // sorted past that showed the dashed "Add task" pill over real work.
  //
  // Joined into a string for the dependency array: `leads` is a fresh array on
  // every render of the parent, so depending on it refetches continuously,
  // and depending on `leads.length` misses a filter change that happens to
  // return the same number of rows.
  const leadIdsKey = useMemo(() => leads.map((l) => l.id).join(","), [leads]);

  useEffect(() => {
    const controller = new AbortController();
    const leadIds = leadIdsKey === "" ? [] : leadIdsKey.split(",").map(Number);
    // Cleared on success rather than up front: a synchronous setState in an
    // effect body cascades a render, and resetting here would flash the
    // loading placeholder over an error that is about to be resolved anyway.
    fetchOpenTasks({ leadIds, signal: controller.signal })
      .then((rows) => {
        setOpenTasks(rows);
        setTasksError(false);
        setTasksLoaded(true);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Drop the stale list too: rows from a previous load would otherwise
        // sit next to leads whose tasks this attempt never fetched.
        setOpenTasks([]);
        setTasksError(true);
        setTasksLoaded(true);
      });
    return () => controller.abort();
  }, [tasksVersion, leadIdsKey]);

  const tasksReady = tasksLoaded && !tasksError;

  const tasksByLeadId = useMemo(() => {
    const grouped = new Map<number, LeadTaskRow[]>();
    for (const task of openTasks) {
      const list = grouped.get(task.leadId);
      if (list) list.push(task);
      else grouped.set(task.leadId, [task]);
    }
    for (const [leadId, list] of grouped) {
      grouped.set(leadId, sortLeadOpenTasks(list));
    }
    return grouped;
  }, [openTasks]);

  /* ── Filter logic ── */
  const activeFilters = useMemo(() => {
    if (!activeMetric) return ["all"];
    if (activeMetric.includes("total")) return ["all"];
    if (activeMetric.includes("converted")) return ["Won", "Converted"];
    // Scheduled work spans every live stage now, so this cohort highlights no
    // single chip. "all" keeps the row in a sane state rather than lighting up
    // two chips that no longer exist.
    if (activeMetric.includes("pendingFollowup")) return ["all"];
    if (activeMetric.includes("lost"))
      return ["Lost", "Cancelled", "Disqualified"];
    return activeMetric.split(",").map((s) => s.trim());
  }, [activeMetric]);

  const toggleFilter = (stage: string) => {
    if (stage === "all") return onActiveMetricChange(null);
    // A KPI cohort is all-or-nothing: clicking its highlighted chip clears it,
    // clicking any other chip replaces it. It must never survive in half.
    if (isKpiCohortMetric(activeMetric)) {
      return onActiveMetricChange(activeFilters.includes(stage) ? null : stage);
    }
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
    void bookConsultationUrlForLead(lead, user?.fullName).then(
      (href) => window.location.assign(href),
      () => showToast("Could not open the booking link.", "error"),
    );
  };

  /** The lead detail modal was replaced by a full page at /leads/[id]. */
  const openLeadDetail = (lead: Lead) => {
    router.push(`/leads/${lead.id}`);
  };

  /* ── Render ── */
  return (
    <div className="table-view">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      <div className="table-card">
        <div className="table-header">
          <div className="table-header-row">
            <div className="table-filters">
              <div className="filter-chips">
                {/*
                  Derived from LEAD_STAGE_OPTIONS, not hand-maintained. This
                  used to be a second copy of the stage list and the two had
                  already drifted apart, so a lead could be SET to a stage the
                  chips could not FILTER to. "all" and "Archived" are not
                  stages, hence the bookends.
                */}
                {["all", ...LEAD_STAGE_OPTIONS, "Archived"].map((stage) => (
                  <button
                    key={stage}
                    type="button"
                    className={`filter-chip ${activeFilters.includes(stage) ? "active" : ""}`}
                    aria-pressed={activeFilters.includes(stage)}
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
                    <th className="col-followup">Task</th>
                    <th className="col-assigned">Assigned</th>
                    <th className="col-actions">Actions</th>
                  </tr>
                </thead>
                {!loading ? (
                  <tbody>
                    {leads.map((lead) => {
                      const actions = leadActions(lead);

                      return (
                        <tr
                          key={lead.id}
                          className={cn(
                            lead.urgent && "urgent-row bg-rose-50/50",
                            lead.isArchived && "opacity-50",
                          )}
                          onClick={() => openLeadDetail(lead)}
                        >
                          <td className="col-lead">
                            <div className="cell-name">
                              {lead.urgent && (
                                <span className="urgent-dot inline-block size-2 rounded-full bg-rose-600 animate-pulse" />
                              )}
                              <div className="cell-name-text">
                                <strong>{lead.name}</strong>
                                <small>{lead.email}</small>
                                {lead.secondaryName ? (
                                  <small className="text-muted-foreground/80">
                                    + {lead.secondaryName}
                                    {lead.secondaryEmail
                                      ? ` · ${lead.secondaryEmail}`
                                      : ""}
                                  </small>
                                ) : null}
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
                            {tasksReady ? (
                              <LeadTaskCell
                                next={tasksByLeadId.get(lead.id)?.[0]}
                                disabled={lead.isArchived}
                                onOpen={() => setTasksLead(lead)}
                              />
                            ) : (
                              <span
                                className="text-xs text-muted-foreground"
                                title={
                                  tasksError
                                    ? "Could not load tasks. Refresh to try again."
                                    : "Loading tasks"
                                }
                              >
                                —
                              </span>
                            )}
                          </td>
                          <td className="col-assigned">
                            {!lead.assignedId ? (
                              <button
                                type="button"
                                className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-royal-gold hover:bg-royal-gold-light hover:text-royal-gold"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAssignedLead(lead);
                                }}
                                title="Assign Lead"
                                disabled={lead.isArchived}
                              >
                                <UserPlus size={12} />
                                <span>Assign</span>
                              </button>
                            ) : (
                              <span
                                className="assigned-name cursor-pointer transition-colors hover:text-royal-gold"
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
                              {actions.call.visible && (
                                <button
                                  type="button"
                                  className="action-btn-icon"
                                  title={
                                    actions.call.disabledReason ??
                                    `Call ${lead.name}`
                                  }
                                  aria-label={`Call ${lead.name}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCall(lead);
                                  }}
                                  disabled={actions.call.disabled}
                                >
                                  <Phone size={15} />
                                </button>
                              )}
                              {actions.email.visible && (
                                <button
                                  type="button"
                                  className="action-btn-icon"
                                  title={
                                    actions.email.disabledReason ??
                                    `Send follow-up email to ${lead.name}`
                                  }
                                  aria-label={`Send follow-up email to ${lead.name}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEmailLead(lead);
                                  }}
                                  disabled={actions.email.disabled}
                                >
                                  <Mail size={15} />
                                </button>
                              )}
                              {actions.sendText.visible && (
                                <button
                                  type="button"
                                  className="action-btn-icon"
                                  title={
                                    actions.sendText.disabledReason ??
                                    `Send message to ${lead.name}`
                                  }
                                  aria-label={`Send message to ${lead.name}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCommLead(lead.id.toString());
                                  }}
                                  disabled={actions.sendText.disabled}
                                >
                                  <MessageSquare size={15} />
                                </button>
                              )}
                              {actions.archive.visible && (
                                <button
                                  type="button"
                                  className="action-btn-icon"
                                  title={
                                    actions.archive.disabledReason ??
                                    `Archive ${lead.name}`
                                  }
                                  aria-label={`Archive ${lead.name}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setLeadToDelete(lead);
                                  }}
                                  disabled={actions.archive.disabled}
                                >
                                  <Archive size={15} />
                                </button>
                              )}
                              {actions.bookMeeting.visible && (
                                <button
                                  type="button"
                                  className="action-btn-icon"
                                  title={
                                    actions.bookMeeting.disabledReason ??
                                    `Meeting schedule for ${lead.name}`
                                  }
                                  aria-label={`Meeting schedule for ${lead.name}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    redirectToScheduleMeeting(lead);
                                  }}
                                  disabled={actions.bookMeeting.disabled}
                                >
                                  <CalendarCheck size={15} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
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
              {leads.map((lead) => {
                const actions = leadActions(lead);

                return (
                  <article
                    key={lead.id}
                    className={cn(
                      "mobile-lead-card",
                      lead.urgent && "urgent",
                      lead.isArchived && "opacity-50",
                    )}
                  >
                    <button
                      type="button"
                      className="mobile-lead-main"
                      onClick={() => openLeadDetail(lead)}
                      aria-label={`Open ${lead.name} lead details`}
                    >
                      <span className="mobile-lead-name-row">
                        <span className="mobile-lead-name">
                          {lead.urgent && (
                            <span className="urgent-dot inline-block size-2 rounded-full bg-rose-600 animate-pulse" />
                          )}
                          {lead.name}
                        </span>
                        <span
                          className={`stage-badge ${STAGE_STYLES[lead.stage]}`}
                        >
                          {lead.stage}
                        </span>
                      </span>
                      <span className="mobile-lead-email">
                        {lead.email || lead.phone || "No contact saved"}
                      </span>
                      {lead.secondaryName ? (
                        <span className="mobile-lead-email text-muted-foreground/80">
                          + {lead.secondaryName}
                          {lead.secondaryEmail
                            ? ` · ${lead.secondaryEmail}`
                            : ""}
                        </span>
                      ) : null}
                    </button>

                    <dl className="mobile-lead-meta">
                      <div>
                        <dt>Task</dt>
                        <dd>
                          {tasksReady ? (
                            <LeadTaskCell
                              next={tasksByLeadId.get(lead.id)?.[0]}
                              disabled={lead.isArchived}
                              onOpen={() => setTasksLead(lead)}
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
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
                      {actions.call.visible && (
                        <button
                          type="button"
                          className="mobile-action-btn"
                          onClick={() => handleCall(lead)}
                          title={actions.call.disabledReason ?? undefined}
                          aria-label={`Call ${lead.name}`}
                          disabled={actions.call.disabled}
                        >
                          <Phone size={15} />
                          Call
                        </button>
                      )}
                      {actions.email.visible && (
                        <button
                          type="button"
                          className="mobile-action-btn"
                          onClick={() => setEmailLead(lead)}
                          title={actions.email.disabledReason ?? undefined}
                          aria-label={`Send follow-up email to ${lead.name}`}
                          disabled={actions.email.disabled}
                        >
                          <Mail size={15} />
                          Email
                        </button>
                      )}
                      {actions.archive.visible && (
                        <button
                          type="button"
                          className="mobile-action-btn"
                          title={
                            actions.archive.disabledReason ??
                            `Archive ${lead.name}`
                          }
                          aria-label={`Archive ${lead.name}`}
                          onClick={() => {
                            setLeadToDelete(lead);
                          }}
                          disabled={actions.archive.disabled}
                        >
                          <Archive size={15} />
                          Archive
                        </button>
                      )}
                      {actions.sendText.visible && (
                        <button
                          type="button"
                          className="mobile-action-btn"
                          onClick={() => setCommLead(lead.id.toString())}
                          title={actions.sendText.disabledReason ?? undefined}
                          aria-label={`Communicate with ${lead.name}`}
                          disabled={actions.sendText.disabled}
                        >
                          <MessageSquare size={15} />
                          Text
                        </button>
                      )}
                      {actions.bookMeeting.visible && (
                        <button
                          type="button"
                          className="mobile-action-btn"
                          onClick={() => redirectToScheduleMeeting(lead)}
                          title={
                            actions.bookMeeting.disabledReason ?? undefined
                          }
                          aria-label={`Meeting Schedule for ${lead.name}`}
                          disabled={actions.bookMeeting.disabled}
                        >
                          <CalendarCheck size={15} />
                          Actions
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Modals ── */}
      {commLead && (
        <LeadCommModal
          key={leads.find((l) => l.id === Number(commLead))!.emails.length}
          lead={leads.find((l) => l.id === Number(commLead))!}
          isOpen={!!commLead}
          onClose={() => setCommLead(null)}
          appendEmailToLead={appendEmailToLead}
        />
      )}

      {leadToDelete && (
        <DeleteConfirmModal
          lead={leadToDelete}
          onClose={() => setLeadToDelete(null)}
          onDeleted={(id) => {
            onLeadDelete(id);
            setLeadToDelete(null);
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

      {tasksLead && (
        <LeadTasksModal
          key={tasksLead.id}
          lead={leads.find((l) => l.id === tasksLead.id) ?? tasksLead}
          tasks={tasksByLeadId.get(tasksLead.id) ?? []}
          onClose={() => setTasksLead(null)}
          onLeadUpdate={onLeadUpdate}
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
