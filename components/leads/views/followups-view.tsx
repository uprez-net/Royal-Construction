"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Calendar,
  Phone,
  Mail,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  onLeadUpdate: (lead: Lead) => void;
  onDone: (taskId: number) => void;
  onReview: (task: LeadTaskRow) => void;
  showToast: (message: string, type?: "success" | "info" | "error") => void;
}

function FollowupItem({
  task,
  lead,
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
  const isToday = task.dueDate
    ? isSameDay(parseISO(task.dueDate), todayStr)
    : false;
  const isOverdue =
    task.dueDate !== null &&
    isBefore(parseISO(task.dueDate), todayStr) &&
    !isToday;
  const dueLabel = task.dueDate
    ? `${formatDate(task.dueDate)}${task.dueTime ? ` · ${task.dueTime}` : ""}`
    : "No date";

  return (
    <>
      {showEmailModal && lead
        ? createPortal(
            <EmailFlowModal
              lead={lead}
              onClose={() => setShowEmailModal(false)}
              onLeadUpdate={onLeadUpdate}
              showToast={showToast}
            />,
            document.body,
          )
        : null}
      <TableRow
        className={
          isOverdue
            ? "bg-[var(--destructive-light)]/40"
            : isToday
              ? "bg-[var(--warning-light)]/70"
              : undefined
        }
      >
        <TableCell className="max-w-56">
          <a
            href={`/leads/${task.leadId}?activeTab=scheduledWork`}
            className="block truncate font-medium text-foreground hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {task.lead.name}
          </a>
          <Badge
            variant="secondary"
            className="mt-1 border-transparent"
            style={{
              backgroundColor: stageConfig.bg,
              color: stageConfig.color,
            }}
          >
            {task.lead.stage}
          </Badge>
        </TableCell>
        <TableCell>
          <Badge variant="outline">{typeLabel}</Badge>
        </TableCell>
        <TableCell
          className={
            isOverdue
              ? "font-medium tabular-nums text-[var(--destructive-ink)]"
              : "tabular-nums text-muted-foreground"
          }
        >
          {dueLabel}
        </TableCell>
        <TableCell
          className="max-w-36 truncate text-muted-foreground"
          title={task.lead.assignedName || "Unassigned"}
        >
          {task.lead.assignedName || "Unassigned"}
        </TableCell>
        <TableCell
          className="max-w-64 min-w-40 whitespace-normal text-muted-foreground"
          title={task.notes || undefined}
        >
          <span className="line-clamp-2">{task.notes || "—"}</span>
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="cursor-pointer"
              title={`Call ${task.lead.name}`}
              aria-label={`Call ${task.lead.name}`}
              onClick={handleCall}
            >
              <Phone aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="cursor-pointer"
              title={
                lead
                  ? `Send follow-up email to ${task.lead.name}`
                  : "Open the lead to email from here"
              }
              aria-label={`Send follow-up email to ${task.lead.name}`}
              disabled={!lead}
              onClick={() => setShowEmailModal(true)}
            >
              <Mail aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="cursor-pointer"
              title={`Mark this ${typeLabel.toLowerCase()} done`}
              aria-label={`Mark ${task.lead.name} ${typeLabel.toLowerCase()} done`}
              disabled={closing}
              onClick={async () => {
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
              <Check aria-hidden="true" />
              Done
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="cursor-pointer"
              title={`Record the outcome for ${task.lead.name}`}
              aria-label={`Review ${task.lead.name}`}
              onClick={() => onReview(task)}
            >
              <Eye aria-hidden="true" />
              Review
            </Button>
          </div>
        </TableCell>
      </TableRow>
    </>
  );
}

function TaskTable({ children }: { children: React.ReactNode }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Lead</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Due</TableHead>
          <TableHead>Assigned</TableHead>
          <TableHead>Note</TableHead>
          <TableHead className="text-right">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
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
  const [taskFilter, setTaskFilter] = useState<
    "all" | "dueNow" | "dueLater" | "unscheduled" | "nonMeeting" | "meeting"
  >("all");
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
        // Cleared on success, not just set on failure. Once a load failed the
        // tab kept rendering "Could not load tasks" over a list that had since
        // reloaded perfectly well.
        setTasksError(false);
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
  const dueNowTasks = useMemo(
    () => tasks.filter((t) => t.dueDate === null || isDue(t, today)),
    [tasks, today],
  );

  const dueLaterTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.dueDate !== null && isAfter(parseISO(t.dueDate), today))
        .sort(
          (a, b) =>
            parseISO(a.dueDate!).getTime() - parseISO(b.dueDate!).getTime(),
        ),
    [tasks, today],
  );

  const undatedTasks = useMemo(
    () => tasks.filter((t) => t.dueDate === null),
    [tasks],
  );

  type TaskFilter =
    | "all"
    | "dueNow"
    | "dueLater"
    | "unscheduled"
    | "nonMeeting"
    | "meeting";

  /** Due-now first, then due-later, then undated — for type-only filters. */
  const sortOpenWork = useCallback(
    (list: LeadTaskRow[]) =>
      [...list].sort((a, b) => {
        const rank = (t: LeadTaskRow) => {
          if (t.dueDate === null) return 2;
          if (isDue(t, today)) return 0;
          return 1;
        };
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        if (a.dueDate && b.dueDate) {
          return parseISO(a.dueDate).getTime() - parseISO(b.dueDate).getTime();
        }
        return 0;
      }),
    [today],
  );

  const filteredSingleList = useMemo(() => {
    switch (taskFilter) {
      case "dueNow":
        return dueNowTasks;
      case "dueLater":
        return dueLaterTasks;
      case "unscheduled":
        return undatedTasks;
      case "nonMeeting":
        return sortOpenWork(nonMeetings);
      case "meeting":
        return sortOpenWork(meetings);
      default:
        return null;
    }
  }, [
    taskFilter,
    dueNowTasks,
    dueLaterTasks,
    undatedTasks,
    nonMeetings,
    meetings,
    sortOpenWork,
  ]);

  const filterChips: {
    key: TaskFilter;
    count: number;
    label: string;
  }[] = [
    { key: "all", count: tasks.length, label: "all open" },
    { key: "dueNow", count: dueNowTasks.length, label: "due now" },
    {
      key: "nonMeeting",
      count: nonMeetings.length,
      label: "calls, emails, waiting",
    },
    { key: "meeting", count: meetings.length, label: "meetings" },
    { key: "dueLater", count: dueLaterTasks.length, label: "due later" },
    { key: "unscheduled", count: undatedTasks.length, label: "unscheduled" },
  ];

  const listIsEmpty =
    taskFilter === "all"
      ? dueNowTasks.length === 0 && dueLaterTasks.length === 0
      : (filteredSingleList?.length ?? 0) === 0;

  return (
    <div className="followups-view">
      {/* One list, full width. Summary chips are real filters — each count
          matches what the list shows when that chip is pressed. */}
      <div
        className="mb-2 flex flex-wrap gap-1.5"
        role="toolbar"
        aria-label="Filter tasks"
      >
        {filterChips.map(({ key, count, label }) => {
          const pressed = taskFilter === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={pressed}
              className={
                pressed
                  ? "inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary"
                  : "inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              }
              onClick={() => setTaskFilter(key)}
            >
              <strong className="tabular-nums">{count}</strong> {label}
            </button>
          );
        })}
      </div>

      <div className="fu-card">
        <div className="fu-list">
          {busy ? (
            <div className="fu-empty">
              <p className="fu-empty-title">Loading...</p>
            </div>
          ) : listIsEmpty ? (
            <div className="fu-empty">
              <div className="fu-empty-icon">
                {tasksError ? <AlertCircle size={28} /> : <Calendar size={28} />}
              </div>
              {/* A failed request must never render as "nothing due". That
                  sentence is what let 5 production leads sit parked with
                  nothing scheduled and nobody the wiser. */}
              <p className="fu-empty-title">
                {tasksError
                  ? "Could not load tasks"
                  : taskFilter === "all"
                    ? "Nothing due"
                    : "Nothing in this filter"}
              </p>
              <p className="fu-empty-desc">
                {tasksError
                  ? "This list is empty because the request failed, not because there is no work. Refresh to try again."
                  : taskFilter === "all"
                    ? "No open tasks on any live lead."
                    : "Try another filter, or clear back to all open."}
              </p>
            </div>
          ) : taskFilter === "all" ? (
            <TaskTable>
              {dueNowTasks.map((task) => (
                <FollowupItem
                  key={task.id}
                  task={task}
                  lead={leadsById.get(task.leadId)}
                  onLeadUpdate={onLeadUpdate}
                  onDone={handleTaskDone}
                  onReview={handleReview}
                  showToast={showToast}
                />
              ))}

              {dueLaterTasks.length > 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={6}
                    className="bg-muted/40 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                  >
                    <span className="flex items-center justify-between">
                      Due later
                      <span className="tabular-nums font-medium">
                        {dueLaterTasks.length}
                      </span>
                    </span>
                  </TableCell>
                </TableRow>
              )}
              {dueLaterTasks.map((task) => (
                <FollowupItem
                  key={task.id}
                  task={task}
                  lead={leadsById.get(task.leadId)}
                  onLeadUpdate={onLeadUpdate}
                  onDone={handleTaskDone}
                  onReview={handleReview}
                  showToast={showToast}
                />
              ))}
            </TaskTable>
          ) : (
            <TaskTable>
              {filteredSingleList!.map((task) => (
                <FollowupItem
                  key={task.id}
                  task={task}
                  lead={leadsById.get(task.leadId)}
                  onLeadUpdate={onLeadUpdate}
                  onDone={handleTaskDone}
                  onReview={handleReview}
                  showToast={showToast}
                />
              ))}
            </TaskTable>
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
                className="flex w-full items-center gap-2 border-t border-border/60 px-4 py-2 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground"
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
