"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  Phone,
  Mail,
  Clock,
  User,
  AlertCircle,
  Check,
  Eye,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Lead } from "@/lib/leads/types";
import { EmailFlowModal } from "@/components/leads/modal-ui/email-flow-modal";
import { dialablePhone } from "@/lib/leads/lead-helpers";
import { LEAD_TASK_TYPES } from "@/lib/leads/task-presets";
import {
  completeTask,
  deleteTask,
  fetchCompletedTasks,
  fetchOpenTasks,
  reopenTask,
  type LeadTaskRow,
} from "@/lib/leads/task-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { bumpLeadTasks, openModal } from "@/lib/store/slices/uiSlice";
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

/**
 * A finished task.
 *
 * Deliberately quieter than FollowupItem: completed work is a reference list,
 * not a worklist, so it carries one action instead of four and drops the
 * due-date urgency styling entirely. Until this existed there was no way to
 * see a task again once it was closed, and no way to undo a mis-click.
 */
function CompletedItem({
  task,
  onReopen,
  onDelete,
}: {
  task: LeadTaskRow;
  onReopen: (taskId: number) => void;
  onDelete: (taskId: number) => void;
}) {
  const typeLabel =
    LEAD_TASK_TYPES.find((t) => t.value === task.type)?.label ?? task.type;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-4 py-2.5 last:border-b-0">
      <Check
        className="size-3.5 shrink-0 text-[var(--success-ink)]"
        aria-hidden="true"
      />
      <span className="text-sm font-medium text-foreground">{task.lead.name}</span>
      <Badge variant="outline">{typeLabel}</Badge>
      {task.completedAt && (
        <span className="text-xs text-muted-foreground">
          Completed {format(parseISO(task.completedAt), "d MMM")}
        </span>
      )}
      {task.notes && (
        <span
          className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          title={task.notes}
        >
          {task.notes}
        </span>
      )}
      <div className="ml-auto flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onReopen(task.id)}
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Reopen
        </Button>
        {/* For work that should never have been booked. Closing a task says
            it happened; this removes the record entirely. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Remove task for ${task.lead.name}`}
          onClick={() => onDelete(task.id)}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Remove
        </Button>
      </div>
    </div>
  );
}

interface FollowupsViewProps {
  loading: boolean;
  leads: Lead[];
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
    // Cancelled is now selectable, and without an entry it fell through to a
    // muted grey pill that read as neutral rather than closed-unsuccessful.
    Cancelled: {
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

/** Due today or earlier. Module scope so the memo hooks below stay memoizable. */
function isDue(t: LeadTaskRow, today: Date): boolean {
  if (t.dueDate === null) return false;
  const d = parseISO(t.dueDate);
  return isBefore(d, today) || isEqual(d, today);
}

interface FollowupItemProps {
  task: LeadTaskRow;
  /** Only needed to open the email modal, which wants a whole Lead. */
  lead: Lead | undefined;
  index: number;
  onLeadUpdate: (lead: Lead) => void;
  onDone: (taskId: number) => void;
  onReview: (task: LeadTaskRow) => void;
  showToast: (message: string, type?: "success" | "info" | "error") => void;
}

function FollowupItem({
  task,
  lead,
  index,
  onLeadUpdate,
  onDone,
  onReview,
  showToast,
}: FollowupItemProps) {
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [closing, setClosing] = useState(false);
  const handleCall = () => {
    const dial = dialablePhone(task.lead.phone ?? "");
    if (dial) window.location.href = `tel:${dial}`;
  };

  const typeLabel =
    LEAD_TASK_TYPES.find((t) => t.value === task.type)?.label ?? task.type;
  const stageConfig = getStageConfig(task.lead.stage);
  const todayStr = getAustralianDate(0);
  const isToday = task.dueDate ? isSameDay(parseISO(task.dueDate), todayStr) : false;

  return (
    <div className={`fu-item ${isToday ? "fu-item-today" : ""}`}>
      {showEmailModal && lead && (
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
            <span className="fu-item-name">{task.lead.name}</span>
            {/* shadcn Badge, not a bespoke span. The stage colour is data —
                one per pipeline stage — so it arrives as a style override on
                the secondary variant rather than as another hand-rolled pill.
                --warning-ink, not --warning: globals.css states the base
                status colours are fill-only and fail contrast as text. */}
            <Badge
              variant="secondary"
              className="border-transparent"
              style={{
                backgroundColor: isToday ? "var(--warning-light)" : stageConfig.bg,
                color: isToday ? "var(--warning-ink)" : stageConfig.color,
              }}
            >
              {task.lead.stage}
            </Badge>
            <Badge variant="outline">{typeLabel}</Badge>
          </div>
          <div className="fu-item-meta">
            <span className="fu-meta-chip">
              <Calendar size={12} />
              {task.dueDate ? formatDate(task.dueDate) : "No date"}
            </span>
            <span className="fu-meta-chip">
              <Clock size={12} />
              {task.dueTime ?? ""}
            </span>
            <span className="fu-meta-chip">
              <User size={12} />
              {task.lead.assignedName || "Unassigned"}
            </span>
          </div>
        </div>

        {/* Always rendered, even when empty. The row is a grid and the body
            uses display:contents, so a missing cell would shunt the actions
            into the notes column on any lead without a note. */}
        <div
          className={`fu-notes-block${task.notes ? "" : " fu-notes-empty"}`}
          title={task.notes || undefined}
        >
          {task.notes}
        </div>

        <div className="fu-item-actions">
          <button
            type="button"
            className="fu-action-btn fu-action-call"
            title={`Call ${task.lead.name}`}
            aria-label={`Call ${task.lead.name}`}
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
            title={
              lead
                ? `Send follow-up email to ${task.lead.name}`
                : "Open the lead to email from here"
            }
            aria-label={`Send follow-up email to ${task.lead.name}`}
            // The modal wants a whole Lead. Tasks are fetched independently of
            // the lead page, so one can arrive without its lead loaded.
            disabled={!lead}
            onClick={(event) => {
              event.stopPropagation();
              setShowEmailModal(true);
            }}
          >
            <Mail size={14} />
            <span>Email</span>
          </button>
          <button
            type="button"
            className="fu-action-btn"
            title={`Mark this ${typeLabel.toLowerCase()} done`}
            aria-label={`Mark ${task.lead.name} ${typeLabel.toLowerCase()} done`}
            disabled={closing}
            onClick={async (event) => {
              event.stopPropagation();
              setClosing(true);
              try {
                await completeTask(task.id);
                onDone(task.id);
              } catch {
                showToast("Could not close the task. Please try again.", "error");
              } finally {
                setClosing(false);
              }
            }}
          >
            <Check size={14} />
            <span>Done</span>
          </button>
          <button
            type="button"
            className="fu-action-btn"
            title={`Record the outcome for ${task.lead.name}`}
            aria-label={`Review ${task.lead.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onReview(task);
            }}
          >
            <Eye size={14} />
            <span>Review</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function FollowupsView({
  loading,
  leads,
  onLeadUpdate,
  showToast,
}: FollowupsViewProps) {
  const dispatch = useAppDispatch();

  // Tasks, not leads with dates. The old buckets read followupDate and
  // meetingDate off the Lead, which allowed one follow-up and one meeting per
  // lead ever and overwrote the previous one on every save.
  const tasksVersion = useAppSelector((state) => state.ui.leadTasksVersion);
  const [tasks, setTasks] = useState<LeadTaskRow[]>([]);
  const [doneTasks, setDoneTasks] = useState<LeadTaskRow[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState(false);
  const busy = loading || tasksLoading;

  // showToast is rebuilt on every render of the component that owns the hook,
  // so it cannot sit in a dependency array without refetching the whole tab on
  // every render. Held in a ref so the effect can key on the version alone.
  const toastRef = useRef(showToast);
  useEffect(() => {
    toastRef.current = showToast;
  }, [showToast]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetchOpenTasks(controller.signal),
      fetchCompletedTasks(controller.signal),
    ])
      .then(([open, done]) => {
        setTasks(open);
        setDoneTasks(done);
      })
      .catch((err: unknown) => {
        // An abort on unmount is expected and silent. A real failure must not
        // be: an empty list renders "All caught up", which is exactly the lie
        // this whole change exists to stop telling.
        if (err instanceof DOMException && err.name === "AbortError") return;
        setTasksError(true);
        toastRef.current("Could not load tasks. Refresh to try again.", "error");
      })
      .finally(() => setTasksLoading(false));
    return () => controller.abort();
    // Keyed on the version so anything that closes, reopens or books a task —
    // including both review dialogs, which are rendered by the modal manager
    // and cannot reach this state — brings both lists back in step.
  }, [tasksVersion]);

  /**
   * Review opens the outcome dialog: completed, not required, or rescheduled
   * with a date. Scoped to the clicked task by id. The old panel closed EVERY
   * non-meeting task on the lead, which is defensible from a lead-level panel
   * and surprising from a row: click Review on one and two disappear.
   */
  const handleReview = useCallback(
    (task: LeadTaskRow) => {
      dispatch(
        openModal({
          type: task.type === "MEETING" ? "meetingReview" : "followUpPrompt",
          payload: { leadId: task.leadId, taskId: task.id },
        }),
      );
    },
    [dispatch],
  );

  /**
   * Drop the row immediately, then refetch so the Completed section and the
   * bucket counts follow. The optimistic removal keeps the click feeling
   * instant; the refetch is what keeps the two lists honest.
   */
  const handleTaskDone = useCallback(
    (taskId: number) => {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      dispatch(bumpLeadTasks());
    },
    [dispatch],
  );

  /** Remove a task outright. Not the same as closing it. */
  const handleDelete = useCallback(
    async (taskId: number) => {
      try {
        await deleteTask(taskId);
        dispatch(bumpLeadTasks());
        showToast("Task removed.", "success");
      } catch {
        showToast("Could not remove the task.", "error");
      }
    },
    [dispatch, showToast],
  );

  /** Put a completed task back on the open list, dates and note intact. */
  const handleReopen = useCallback(
    async (taskId: number) => {
      try {
        await reopenTask(taskId);
        dispatch(bumpLeadTasks());
        showToast("Task reopened.", "success");
      } catch {
        showToast("Could not reopen the task.", "error");
      }
    },
    [dispatch, showToast],
  );

  /** The full Lead, for the email modal. Missing is fine; the button disables. */
  const leadsById = useMemo(() => {
    const m = new Map<number, Lead>();
    for (const l of leads) m.set(l.id, l);
    return m;
  }, [leads]);

  // A stable key, not a fresh Date each render. getAustralianDate() returns a
  // new object every call, so it changed identity on every render and each memo
  // below recomputed regardless.
  const todayKey = getAustralianDate().toDateString();
  const today = useMemo(() => new Date(todayKey), [todayKey]);

  const meetings = useMemo(() => tasks.filter((t) => t.type === "MEETING"), [tasks]);
  const nonMeetings = useMemo(() => tasks.filter((t) => t.type !== "MEETING"), [tasks]);

  // Undated tasks count as pending. They are work nobody has scheduled, and
  // hiding them is how 5 production leads ended up parked while the tab said
  // "All caught up".
  // Every open task, whatever its type. Splitting meetings out of the list left
  // them counted in Quick Stats and rendered nowhere, so a meeting had no Done
  // button and no row. The type pill on each row tells them apart.
  const pendingFollowups = useMemo(
    () => tasks.filter((t) => t.dueDate === null || isDue(t, today)),
    [tasks, today],
  );

  const upcomingFollowups = useMemo(
    () =>
      tasks
        .filter((t) => t.dueDate !== null && isAfter(parseISO(t.dueDate), today))
        .sort((a, b) => parseISO(a.dueDate!).getTime() - parseISO(b.dueDate!).getTime()),
    [tasks, today],
  );

  const pendingMeetings = useMemo(
    () => meetings.filter((t) => t.dueDate === null || isDue(t, today)),
    [meetings, today],
  );

  const upcomingMeetings = useMemo(
    () => meetings.filter((t) => t.dueDate !== null && isAfter(parseISO(t.dueDate), today)),
    [meetings, today],
  );

  // Derived from the same list the rows come from, so the counts and the list
  // can no longer disagree. Production showed three different numbers for this
  // on one screen: the card said 10 pending, the tab said 0, the panel said 4.
  const undatedCount = useMemo(
    () => tasks.filter((t) => t.dueDate === null).length,
    [tasks],
  );

  const liveStats = useMemo(
    () => ({
      totalFollowUps: nonMeetings.length,
      pendingFollowUps: pendingFollowups.filter((t) => t.type !== "MEETING").length,
      upcomingFollowUps: upcomingFollowups.filter((t) => t.type !== "MEETING").length,
      totalMeetings: meetings.length,
      pendingMeetings: pendingMeetings.length,
      upcomingMeetings: upcomingMeetings.length,
    }),
    [nonMeetings, pendingFollowups, upcomingFollowups, meetings, pendingMeetings, upcomingMeetings],
  );

  // No server fallback any more. The counts and the rows are derived from one
  // list, so they cannot disagree. Production showed three different numbers
  // for this on a single screen: the card said 10 pending, the tab said 0,
  // and the panel said 4, because each counted a different thing.
  const stats = liveStats;

  return (
    <div className="followups-view">
      {/* One list, full width.
          There used to be three places showing the same work: an "Overdue and
          due today" panel above the tabs, this list, and an "Upcoming
          Reminders" sidebar. The panel held 14 rows and every one of them was
          already in this list, with more context and three actions instead of
          one. It has gone, the reminders are folded in as a section, and the
          six stat cards are a single line. */}
      <div className="tasks-summary">
        <span><strong>{pendingFollowups.length}</strong> due now</span>
        <span><strong>{stats.pendingFollowUps}</strong> calls, emails, waiting</span>
        <span><strong>{stats.pendingMeetings}</strong> meetings</span>
        <span><strong>{upcomingFollowups.length}</strong> due later</span>
        <span><strong>{undatedCount}</strong> unscheduled</span>
      </div>

      <div className="fu-card">
        <div className="fu-list">
          {busy ? (
            <div className="fu-empty">
              <p className="fu-empty-title">Loading...</p>
            </div>
          ) : pendingFollowups.length === 0 && upcomingFollowups.length === 0 ? (
            <div className="fu-empty">
              <div className="fu-empty-icon">
                {tasksError ? <AlertCircle size={28} /> : <Calendar size={28} />}
              </div>
              {/* A failed request must never render as "nothing due". That
                  sentence is what let 5 production leads sit parked with
                  nothing scheduled and nobody the wiser. */}
              <p className="fu-empty-title">
                {tasksError ? "Could not load tasks" : "Nothing due"}
              </p>
              <p className="fu-empty-desc">
                {tasksError
                  ? "This list is empty because the request failed, not because there is no work. Refresh to try again."
                  : "No open tasks on any live lead."}
              </p>
            </div>
          ) : (
            <>
              {pendingFollowups.map((task, index) => (
                <FollowupItem
                  key={task.id}
                  task={task}
                  lead={leadsById.get(task.leadId)}
                  index={index}
                  onLeadUpdate={onLeadUpdate}
                  onDone={handleTaskDone}
                  onReview={handleReview}
                  showToast={showToast}
                />
              ))}

              {upcomingFollowups.length > 0 && (
                <div className="fu-divider">
                  Due later
                  <span>{upcomingFollowups.length}</span>
                </div>
              )}
              {upcomingFollowups.map((task, index) => (
                <FollowupItem
                  key={task.id}
                  task={task}
                  lead={leadsById.get(task.leadId)}
                  index={pendingFollowups.length + index}
                  onLeadUpdate={onLeadUpdate}
                  onDone={handleTaskDone}
                  onReview={handleReview}
                  showToast={showToast}
                />
              ))}
            </>
          )}

          {/* Outside the open/empty branch on purpose: when every task is
              closed the list above is empty, and that is exactly the moment
              somebody wants to see what was finished. */}
          {doneTasks.length > 0 && (
            <>
              <button
                type="button"
                aria-expanded={showDone}
                onClick={() => setShowDone((open) => !open)}
                className="flex w-full items-center gap-2 border-t border-border/60 px-4 py-2 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground"
              >
                {showDone ? (
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                ) : (
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                )}
                Completed
                <span className="ml-auto tabular-nums">{doneTasks.length}</span>
              </button>
              {showDone &&
                doneTasks.map((task) => (
                  <CompletedItem
                    key={task.id}
                    task={task}
                    onReopen={handleReopen}
                    onDelete={handleDelete}
                  />
                ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default FollowupsView;
