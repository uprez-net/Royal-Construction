"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import {
  Calendar,
  Phone,
  Mail,
  AlertCircle,
  Check,
  ClipboardCheck,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Lead } from "@/lib/leads/types";
import { fetchLead } from "@/lib/leads/leads-service";
import { EmailFlowModal } from "@/components/leads/modal-ui/email-flow-modal";
import { LeadCommsModal } from "@/components/leads/comms/lead-comms-modal";
import { LeadWhatsAppModal } from "@/components/leads/whatsapp/lead-whatsapp-modal";
import { WhatsAppGlyph } from "@/components/whatsapp/whatsapp-logo";
import { useCommsAvailability } from "@/hooks/use-comms-availability";
import { normaliseLeadPhone } from "@/lib/domain/leads/whatsapp/phone";
import { STAGE_STYLES, dialablePhone } from "@/lib/leads/lead-helpers";
import { cn } from "@/lib/utils";
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
import { MobileFilterSelect } from "@/components/common/mobile-filter-select";
import {
  FilterChip,
  FilterChips,
  TableCard,
} from "@/components/common/list-toolbar";
import { DataTableSkeleton } from "@/components/ui/skeleton";
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
        className="size-3.5 shrink-0 text-success-ink"
        aria-hidden="true"
      />
      <span className="text-sm font-medium text-foreground">
        {task.lead.name}
      </span>
      <Badge variant="outline">{typeLabel}</Badge>
      {task.completedAt && (
        <span className="text-xs text-muted-foreground">
          Completed {format(parseISO(task.completedAt), "d MMM")}
        </span>
      )}
      {task.notes && (
        <span
          className="min-w-0 basis-full whitespace-normal break-words text-sm md:basis-auto md:flex-1 md:truncate md:text-xs text-muted-foreground"
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
  /** The filter the tab opens on: "due now" from the Overdue card. */
  initialFilter?: "all" | "dueNow";
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
  /**
   * The whole Lead the email modal wants, when it is on the page of leads
   * already loaded. Otherwise it is fetched when Email is pressed.
   */
  lead: Lead | undefined;
  /** Calls go through the phone provider (the Phone & SMS window). */
  callsInApp: boolean;
  onLeadUpdate: (lead: Lead) => void;
  onDone: (taskId: number) => void;
  onReview: (task: LeadTaskRow) => void;
  showToast: (message: string, type?: "success" | "info" | "error") => void;
}

function FollowupItem({
  task,
  lead,
  callsInApp,
  onLeadUpdate,
  onDone,
  onReview,
  showToast,
}: FollowupItemProps) {
  const [emailLead, setEmailLead] = useState<Lead | null>(null);
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [showPhone, setShowPhone] = useState(false);
  const [showWhatsApp, setShowWhatsApp] = useState(false);
  const [closing, setClosing] = useState(false);
  // The same phone rule the lead list and the send use. A WhatsApp task on a
  // lead without a usable number says why instead of opening a dead composer.
  const whatsappPhone = normaliseLeadPhone(task.lead.phone);
  const dial = dialablePhone(task.lead.phone ?? "");
  // The Leads table's rule: through the phone provider when one is set up, so
  // the call is placed, logged and recorded; otherwise the device's dialler.
  const handleCall = () => {
    if (callsInApp) {
      setShowPhone(true);
      return;
    }
    if (dial) window.location.assign(`tel:${dial}`);
  };
  // The Tasks tab lists every open task, not just the leads on the table's
  // current page, so the Lead the email modal needs is fetched when missing
  // rather than leaving Email disabled on most rows.
  const handleEmail = async () => {
    if (lead) {
      setEmailLead(lead);
      return;
    }
    setLoadingEmail(true);
    try {
      const fetched = await fetchLead(task.leadId);
      if (fetched) setEmailLead(fetched);
      else showToast("Could not open this lead's email.", "error");
    } catch {
      showToast("Could not open this lead's email.", "error");
    } finally {
      setLoadingEmail(false);
    }
  };

  const typeLabel =
    LEAD_TASK_TYPES.find((t) => t.value === task.type)?.label ?? task.type;
  const todayStr = getAustralianDate(0);
  const isToday = task.dueDate
    ? isSameDay(parseISO(task.dueDate), todayStr)
    : false;
  const isOverdue =
    task.dueDate !== null
    && isBefore(parseISO(task.dueDate), todayStr)
    && !isToday;
  const dueLabel = task.dueDate
    ? `${formatDate(task.dueDate)}${task.dueTime ? ` · ${task.dueTime}` : ""}`
    : "No date";

  return (
    <>
      {emailLead
        ? createPortal(
            <EmailFlowModal
              lead={emailLead}
              onClose={() => setEmailLead(null)}
              onLeadUpdate={onLeadUpdate}
              showToast={showToast}
            />,
            document.body,
          )
        : null}
      {showPhone
        ? createPortal(
            <LeadCommsModal
              lead={{ id: task.leadId, name: task.lead.name }}
              onClose={() => setShowPhone(false)}
            />,
            document.body,
          )
        : null}
      {showWhatsApp
        ? createPortal(
            <LeadWhatsAppModal
              lead={{ id: task.leadId, name: task.lead.name }}
              onClose={() => setShowWhatsApp(false)}
            />,
            document.body,
          )
        : null}
      {/* Overdue and due-today rows take the Leads table's urgent-row tint
          (.leads-table tr.urgent-row), so they stand out in the list. */}
      <TableRow
        data-task-row
        className={
          isOverdue || isToday
            ? "bg-[color-mix(in_oklab,var(--warning)_6%,transparent)]"
            : undefined
        }
      >
        <TableCell data-label="Lead" className="max-w-56">
          {/* Link, not a bare anchor. A worklist is somewhere you open a lead,
              deal with it and come back, and a plain href tears the app down
              and rebuilds it every time — losing the filter chip you had
              selected and refetching every task to land where a client
              navigation would have gone straight there. */}
          <Link
            href={`/leads/${task.leadId}?activeTab=scheduledWork`}
            className="block break-words font-medium text-foreground hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {task.lead.name}
          </Link>
          <Badge
            variant="secondary"
            className={cn(
              "mt-1 border-transparent",
              STAGE_STYLES[task.lead.stage],
            )}
          >
            {task.lead.stage}
          </Badge>
        </TableCell>
        <TableCell data-label="Type">
          <Badge variant="outline">{typeLabel}</Badge>
        </TableCell>
        <TableCell
          data-label="Due"
          className="tabular-nums text-muted-foreground"
        >
          {isOverdue || isToday ? (
            // Overdue and due today both carry the warning tone. Orange, not
            // red: red is reserved for lost, cancelled and declined.
            <span className="inline-flex h-[22px] items-center rounded-full bg-warning-light px-2.5 text-[11.5px] font-semibold whitespace-nowrap text-warning-ink">
              {dueLabel}
            </span>
          ) : (
            dueLabel
          )}
        </TableCell>
        <TableCell
          data-label="Assigned"
          className="max-w-36 truncate text-muted-foreground"
          title={task.lead.assignedName || "Unassigned"}
        >
          {task.lead.assignedName || "Unassigned"}
        </TableCell>
        <TableCell
          data-label="Note"
          className="max-w-64 min-w-40 whitespace-normal text-muted-foreground"
          title={task.notes || undefined}
        >
          <span className="line-clamp-2">{task.notes || "—"}</span>
        </TableCell>
        <TableCell data-label="Actions" className="text-right">
          <div className="grid grid-cols-2 gap-2 md:flex md:justify-end md:gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="cursor-pointer"
              title={
                callsInApp || dial
                  ? `Call ${task.lead.name}`
                  : "This lead has no phone number."
              }
              aria-label={`Call ${task.lead.name}`}
              disabled={!callsInApp && !dial}
              onClick={handleCall}
            >
              <Phone aria-hidden="true" />
              <span className="md:sr-only">Call</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="cursor-pointer"
              title={
                task.lead.email
                  ? `Send follow-up email to ${task.lead.name}`
                  : "This lead has no email address."
              }
              aria-label={`Send follow-up email to ${task.lead.name}`}
              disabled={!task.lead.email || loadingEmail}
              onClick={() => void handleEmail()}
            >
              <Mail aria-hidden="true" />
              <span className="md:sr-only">Email</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="cursor-pointer"
              title={
                whatsappPhone.usable
                  ? `WhatsApp ${task.lead.name}`
                  : whatsappPhone.reason
              }
              aria-label={`WhatsApp ${task.lead.name}`}
              disabled={!whatsappPhone.usable}
              onClick={() => setShowWhatsApp(true)}
            >
              <WhatsAppGlyph brand={whatsappPhone.usable} className="size-4" />
              <span className="md:sr-only">WhatsApp</span>
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
                  showToast(
                    "Could not close the task. Please try again.",
                    "error",
                  );
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
              <ClipboardCheck aria-hidden="true" />
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
    <Table className="mobile-task-table">
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
  initialFilter = "all",
}: FollowupsViewProps) {
  const dispatch = useAppDispatch();
  const comms = useCommsAvailability();

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
  >(initialFilter);
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
      fetchOpenTasks({ signal: controller.signal }),
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
        toastRef.current(
          "Could not load tasks. Refresh to try again.",
          "error",
        );
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

  const meetings = useMemo(
    () => tasks.filter((t) => t.type === "MEETING"),
    [tasks],
  );
  const nonMeetings = useMemo(
    () => tasks.filter((t) => t.type !== "MEETING"),
    [tasks],
  );

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
        .filter(
          (t) => t.dueDate !== null && isAfter(parseISO(t.dueDate), today),
        )
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
      {/* One list, full width, in one card. The summary chips are real
          filters: each count matches what the list shows when it is pressed.
          On a phone the same choice is a dropdown. */}
      <TableCard
        header={
          <div className="flex flex-col gap-2">
            <MobileFilterSelect
              label="Task filter"
              value={taskFilter}
              options={filterChips.map(({ key, count, label }) => ({
                value: key,
                count,
                label,
              }))}
              onChange={(value) => setTaskFilter(value as TaskFilter)}
            />
            <FilterChips
              className="hidden md:flex"
              role="toolbar"
              aria-label="Filter tasks"
            >
              {filterChips.map(({ key, count, label }) => (
                <FilterChip
                  key={key}
                  active={taskFilter === key}
                  onClick={() => setTaskFilter(key)}
                >
                  <strong className="tabular-nums">{count}</strong> {label}
                </FilterChip>
              ))}
            </FilterChips>
          </div>
        }
      >
        {/* fu-list's padding is unlayered CSS, so a plain md:p-0 would lose to
            it: the task table runs edge to edge in the card from md up. */}
        <div className="fu-list md:p-0!">
          {busy ? (
            <div role="status" aria-busy="true">
              <span className="sr-only">Loading tasks…</span>
              <DataTableSkeleton
                flush
                rowCount={3}
                columnCount={6}
                mobileColumns={1}
              />
            </div>
          ) : listIsEmpty ? (
            <div className="fu-empty">
              <div className="fu-empty-icon">
                {tasksError ? (
                  <AlertCircle size={28} />
                ) : (
                  <Calendar size={28} />
                )}
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
                  callsInApp={comms.calls}
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
                    className="bg-muted py-2 text-[13px] font-semibold text-foreground"
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
                  callsInApp={comms.calls}
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
                  callsInApp={comms.calls}
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
                className="flex w-full items-center gap-2 border-t border-border/60 bg-muted px-4 py-2 text-left text-[13px] font-semibold text-foreground transition-colors hover:bg-border/50"
              >
                {showDone ? (
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                ) : (
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                )}
                Completed
                <span className="ml-auto tabular-nums">{doneTasks.length}</span>
              </button>
              {showDone
                && doneTasks.map((task) => (
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
      </TableCard>
    </div>
  );
}

export default FollowupsView;
