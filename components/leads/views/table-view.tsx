import React, { useEffect, useMemo } from "react";
import {
  Phone,
  Mail,
  UserPlus,
  Search,
  CalendarCheck,
  MessageSquare,
  Archive,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { leadDetailHref } from "@/components/leads/leads-list-url";
import Link from "next/link";
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
import { fetchWhatsAppSummaries } from "@/lib/leads/whatsapp-service";
import type { WhatsAppSummaryDto } from "@/lib/leads/whatsapp-types";
import { LeadWhatsAppModal } from "@/components/leads/whatsapp/lead-whatsapp-modal";
import { LeadCommsModal } from "@/components/leads/comms/lead-comms-modal";
import {
  CommsUnreadBadge,
  commsUnreadSummary,
} from "@/components/leads/comms/comms-unread-badge";
import { fetchLeadCommsUnread } from "@/lib/leads/comms-service";
import type { LeadCommsUnreadDto } from "@/lib/leads/comms-types";
import { useCommsAvailability } from "@/hooks/use-comms-availability";
import { WhatsAppGlyph } from "@/components/whatsapp/whatsapp-logo";
import {
  WhatsAppBadge,
  WhatsAppLastSeen,
  whatsappSummaryTitle,
} from "@/components/leads/whatsapp/whatsapp-row-indicator";
import { useAppSelector } from "@/lib/store/hooks";
import { cn } from "@/lib/utils";
import { DataTableSkeleton, PageSkeleton } from "@/components/ui/skeleton";

interface TableViewProps {
  loading: boolean;
  leads: Lead[];
  onLeadUpdate: (lead: Lead) => void;
  onLeadDelete: (leadId: number) => void;
  activeMetric: string | null;
  onActiveMetricChange: (metric: string | null) => void;
  appendEmailToLead: (leadId: number, email: LeadEmails) => void;
  /** Says what is narrowing an empty list (see `emptyLeadsMessage`). */
  emptyMessage: string;
  /** Set when a search, card, chip or timeframe is narrowing the list. */
  onClearFilters?: () => void;
  user: {
    clerkUserId: string | null;
    fullName: string | null;
  };
}

function whatsappActionLabel(
  leadName: string,
  summary: WhatsAppSummaryDto | undefined,
): string {
  const unreadCount = summary?.unreadCount ?? 0;
  return unreadCount > 0
    ? `WhatsApp ${leadName}, ${unreadCount} unread WhatsApp message${unreadCount === 1 ? "" : "s"}`
    : `WhatsApp ${leadName}`;
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
  emptyMessage,
  onClearFilters,
}: TableViewProps) {
  /* ── Shared hooks ── */
  const { toasts, showToast, dismissToast } = useToast();
  const availableUsers = useAvailableUsers();
  const router = useRouter();
  const searchParams = useSearchParams();

  /* ── Modal pointers (only which lead — each modal manages its own state) ── */
  const [leadToDelete, setLeadToDelete] = React.useState<Lead | null>(null);
  const [emailLead, setEmailLead] = React.useState<Lead | null>(null);
  const [tasksLead, setTasksLead] = React.useState<Lead | null>(null);
  const [assignedLead, setAssignedLead] = React.useState<Lead | null>(null);
  const [commLead, setCommLead] = React.useState<string | null>(null);
  const [whatsappLead, setWhatsappLead] = React.useState<Lead | null>(null);
  const [phoneLead, setPhoneLead] = React.useState<Lead | null>(null);
  const comms = useCommsAvailability();
  const [whatsappSummaries, setWhatsappSummaries] = React.useState<
    Map<number, WhatsAppSummaryDto>
  >(() => new Map());
  // Bumped when the WhatsApp modal closes, so the row indicator picks up the
  // messages just sent or read without refetching on every render.
  const [whatsappVersion, setWhatsappVersion] = React.useState(0);
  // Calls Mili or the voicemail took and unread texts, for the badge over the
  // call icon. Bumped when the Phone & SMS window has marked them read.
  const [commsUnread, setCommsUnread] = React.useState<
    Map<number, LeadCommsUnreadDto>
  >(() => new Map());
  const [commsUnreadVersion, setCommsUnreadVersion] = React.useState(0);
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

  // One summary request for the page on screen — never one per row, and never
  // the full threads. A failure leaves the indicators blank; the WhatsApp
  // action itself is gated on the phone alone and still works.
  useEffect(() => {
    const controller = new AbortController();
    const leadIds = leadIdsKey === "" ? [] : leadIdsKey.split(",").map(Number);
    fetchWhatsAppSummaries(leadIds, controller.signal)
      .then((rows) =>
        setWhatsappSummaries(new Map(rows.map((row) => [row.leadId, row]))),
      )
      .catch(() => {
        if (controller.signal.aborted) return;
        setWhatsappSummaries(new Map());
      });
    return () => controller.abort();
  }, [leadIdsKey, whatsappVersion]);

  // Same shape as the WhatsApp summaries: one request for the page on screen.
  // Only asked for when calls go through the app — otherwise the call icon is
  // the device's own dialler, which cannot clear a badge.
  useEffect(() => {
    if (!comms.calls) return;
    const controller = new AbortController();
    const leadIds = leadIdsKey === "" ? [] : leadIdsKey.split(",").map(Number);
    fetchLeadCommsUnread(leadIds, controller.signal)
      .then((rows) =>
        setCommsUnread(new Map(rows.map((row) => [row.leadId, row]))),
      )
      .catch(() => {
        if (controller.signal.aborted) return;
        setCommsUnread(new Map());
      });
    return () => controller.abort();
  }, [leadIdsKey, commsUnreadVersion, comms.calls]);

  const callLabel = (lead: Lead) => {
    const summary = commsUnreadSummary(commsUnread.get(lead.id));
    return summary ? `Call ${lead.name}, ${summary}` : `Call ${lead.name}`;
  };

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
    // Through the phone provider when one is set up, so the call is placed,
    // logged and (with consent) recorded; otherwise the device's own dialler.
    if (comms.calls) {
      setPhoneLead(lead);
      return;
    }
    const dial = dialablePhone(lead.phone);
    if (dial) window.location.assign(`tel:${dial}`);
  };

  const redirectToScheduleMeeting = (lead: Lead) => {
    void bookConsultationUrlForLead(lead, user?.fullName).then(
      (href) => window.location.assign(href),
      () => showToast("Could not open the booking link.", "error"),
    );
  };

  /**
   * The lead detail modal was replaced by a full page at /leads/[id]. It
   * carries the list's page and filters, so "Back to all leads" returns to
   * this page of the table (#350).
   */
  const openLeadDetail = (lead: Lead) => {
    router.push(leadDetailHref(lead.id, searchParams.toString()));
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

        {loading ? (
          <PageSkeleton label="Loading leads" className="p-4 sm:p-5">
            <DataTableSkeleton columnCount={8} />
          </PageSkeleton>
        ) : leads.length === 0 ? (
          <div className="table-empty">
            <Search size={32} />
            <p>{emptyMessage}</p>
            {onClearFilters ? (
              <button
                type="button"
                className="mt-3 text-sm font-medium text-primary underline-offset-4 hover:underline"
                onClick={onClearFilters}
              >
                Clear filters
              </button>
            ) : null}
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
                              <strong>
                                {/* The row opens the lead on click, which a
                                    keyboard cannot do; this is the same
                                    destination as a real link. The ring is
                                    drawn inside: the cell clips overflow. */}
                                <Link
                                  href={leadDetailHref(
                                    lead.id,
                                    searchParams.toString(),
                                  )}
                                  prefetch={false}
                                  onClick={(e) => e.stopPropagation()}
                                  className="rounded-sm text-inherit hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                                >
                                  {lead.name}
                                </Link>
                              </strong>
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
                            <button
                              type="button"
                              className="assigned-name cursor-pointer rounded-sm bg-transparent p-0 text-left transition-colors hover:text-royal-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                              aria-label={`Reassign ${lead.name}, assigned to ${lead.assignedUser?.name ?? "someone"}`}
                              title="Reassign Lead"
                              onClick={(e) => {
                                e.stopPropagation();
                                setAssignedLead(lead);
                              }}
                            >
                              {lead.assignedUser?.name}
                            </button>
                          )}
                        </td>
                        <td className="col-actions">
                          <div className="action-buttons">
                            {actions.call.visible && (
                              <button
                                type="button"
                                className="action-btn-icon relative"
                                title={
                                  actions.call.disabledReason ?? callLabel(lead)
                                }
                                aria-label={callLabel(lead)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCall(lead);
                                }}
                                disabled={actions.call.disabled}
                              >
                                <Phone size={15} />
                                {comms.calls ? (
                                  <CommsUnreadBadge
                                    unread={commsUnread.get(lead.id)}
                                  />
                                ) : null}
                              </button>
                            )}
                            {actions.email.visible && (
                              <button
                                type="button"
                                className="action-btn-icon"
                                title={
                                  actions.email.disabledReason
                                  ?? `Send follow-up email to ${lead.name}`
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
                                  actions.sendText.disabledReason
                                  ?? `Send message to ${lead.name}`
                                }
                                aria-label={`Open email thread with ${lead.name}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCommLead(lead.id.toString());
                                }}
                                disabled={actions.sendText.disabled}
                              >
                                <MessageSquare size={15} />
                              </button>
                            )}
                            {actions.whatsapp.visible && (
                              <button
                                type="button"
                                className="action-btn-icon relative"
                                title={
                                  actions.whatsapp.disabledReason
                                  ?? whatsappSummaryTitle(
                                    whatsappSummaries.get(lead.id),
                                  )
                                  ?? `WhatsApp ${lead.name}`
                                }
                                aria-label={whatsappActionLabel(
                                  lead.name,
                                  whatsappSummaries.get(lead.id),
                                )}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setWhatsappLead(lead);
                                }}
                                disabled={actions.whatsapp.disabled}
                              >
                                <WhatsAppGlyph
                                  brand={!actions.whatsapp.disabled}
                                  className="size-[15px]"
                                />
                                {!actions.whatsapp.disabled ? (
                                  <WhatsAppBadge
                                    summary={whatsappSummaries.get(lead.id)}
                                  />
                                ) : null}
                              </button>
                            )}
                            {actions.archive.visible && (
                              <button
                                type="button"
                                className="action-btn-icon"
                                title={
                                  actions.archive.disabledReason
                                  ?? `Archive ${lead.name}`
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
                                  actions.bookMeeting.disabledReason
                                  ?? `Meeting schedule for ${lead.name}`
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
                            disabled={lead.isArchived}
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
                          className="mobile-action-btn relative"
                          onClick={() => handleCall(lead)}
                          title={actions.call.disabledReason ?? undefined}
                          aria-label={callLabel(lead)}
                          disabled={actions.call.disabled}
                        >
                          <Phone size={15} />
                          Call
                          {comms.calls ? (
                            <CommsUnreadBadge
                              unread={commsUnread.get(lead.id)}
                            />
                          ) : null}
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
                            actions.archive.disabledReason
                            ?? `Archive ${lead.name}`
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
                          aria-label={`Open email thread with ${lead.name}`}
                          disabled={actions.sendText.disabled}
                        >
                          <MessageSquare size={15} />
                          Emails
                        </button>
                      )}
                      {actions.whatsapp.visible && (
                        <button
                          type="button"
                          className="mobile-action-btn relative"
                          onClick={() => setWhatsappLead(lead)}
                          title={
                            actions.whatsapp.disabledReason
                            ?? whatsappSummaryTitle(
                              whatsappSummaries.get(lead.id),
                            )
                            ?? undefined
                          }
                          aria-label={whatsappActionLabel(
                            lead.name,
                            whatsappSummaries.get(lead.id),
                          )}
                          disabled={actions.whatsapp.disabled}
                        >
                          <WhatsAppGlyph
                            brand={!actions.whatsapp.disabled}
                            className="size-[15px]"
                          />
                          WhatsApp
                          {!actions.whatsapp.disabled ? (
                            <>
                              <WhatsAppLastSeen
                                summary={whatsappSummaries.get(lead.id)}
                              />
                              <WhatsAppBadge
                                summary={whatsappSummaries.get(lead.id)}
                              />
                            </>
                          ) : null}
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

      {phoneLead && (
        <LeadCommsModal
          key={phoneLead.id}
          lead={phoneLead}
          onRead={() => setCommsUnreadVersion((version) => version + 1)}
          onClose={() => {
            setPhoneLead(null);
            setCommsUnreadVersion((version) => version + 1);
          }}
        />
      )}
      {whatsappLead && (
        <LeadWhatsAppModal
          key={whatsappLead.id}
          lead={whatsappLead}
          onClose={() => {
            setWhatsappLead(null);
            setWhatsappVersion((version) => version + 1);
          }}
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
