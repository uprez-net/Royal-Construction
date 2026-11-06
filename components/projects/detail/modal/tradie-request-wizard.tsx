import type { ProjectStage, TradieRequestKind } from "@prisma/client";
import { Loader2, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  ExtraAttachmentsField,
  extraAttachmentIds,
  type ExtraAttachment,
} from "@/components/modals/compliance/extra-attachments-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { draftTradieRequestWorkDetailsAction } from "@/lib/data/tradie-request-ai";
import type { SentTradieRequestsResult } from "@/lib/data/tradie-requests";
import { getTradieGroupedByCategoryCached } from "@/lib/data/tradie-management";
import { TRADIE_REF_PREVIEW } from "@/lib/domain/tradies/reply-reference";
import {
  MAX_REQUEST_ACTIVITIES,
  MAX_REQUEST_ATTACHMENTS,
  MAX_REQUEST_TRADIES,
  bookingTrade,
  sameTrade,
} from "@/lib/domain/tradies/request-rules";
import {
  bookingsDisplacedBySelection,
  directBookingRefusal,
  LIVE_SELECTION_STATUSES,
} from "@/lib/domain/tradies/selection-rules";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { sendTradieRequests } from "@/lib/store/slices/projectsSlice";
import {
  clearState,
  setTradieLoading,
  setTradies,
} from "@/lib/store/slices/tradieManagementSlice";
import { cn } from "@/lib/utils";
import { PROJECT_STAGE_LABELS, type ProjectDetail } from "@/types/project";
import {
  generateTradieBookingEmail,
  generateTradieRequestEmail,
  tradieBookingSubject,
  tradieRequestSubject,
} from "@/utils/generate-email";

import {
  activeRequestFor,
  defaultActivityDate,
  requestAttachmentOptions,
  requestTradeOptions,
  type RequestMilestone,
} from "../tradie-requests";
import {
  RequestActivitiesStep,
  RequestKindPicker,
} from "./request-activities-step";
import { RequestEmailStep } from "./request-email-step";
import { RequestDeliveryStatus } from "../request-delivery-status";

export type RequestActivityDraft = {
  /** `YYYY-MM-DD`. */
  scheduledDate: string;
  durationDays: number;
};

type Step = "activities" | "email" | "sent";

const STEPS: { key: Exclude<Step, "sent">; label: string }[] = [
  { key: "activities", label: "Activities & tradies" },
  { key: "email", label: "Review email" },
];

interface TradieRequestWizardProps {
  open: boolean;
  onClose: () => void;
  project: ProjectDetail;
  /** Preselects the stage filter, when opened from a stage's header. */
  initialProjectStage?: ProjectStage;
  /** Preselects the trade, when opened from a trade on the Tradies tab. */
  initialTrade?: string;
  /** Opens on a quote request (the default) or a direct booking. */
  initialKind?: TradieRequestKind;
}

/**
 * An edit the office made in the email preview, with the text it replaced.
 * It holds only while the template still writes that text: change an
 * activity's date after rewording its line and the new date comes back,
 * rather than the old one going out.
 */
type CopyEdit = { from: string; to: string };

/** The edits that still apply to the email the template now writes. */
function liveCopy(
  edits: Readonly<Record<string, CopyEdit>>,
  defaults: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(edits)
      .filter(
        ([key, edit]) => defaults[key] === edit.from && edit.to !== edit.from,
      )
      .map(([key, edit]) => [key, edit.to]),
  );
}

/** "Tue 20 Oct 2026 · 3 days" for a `YYYY-MM-DD` day. */
function activityDateLabel(draft: RequestActivityDraft): string {
  if (!draft.scheduledDate) return "No date yet";
  const day = new Date(
    `${draft.scheduledDate}T00:00:00.000Z`,
  ).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    weekday: "short",
    year: "numeric",
  });
  return `Approx. ${day} · ${draft.durationDays} day${draft.durationDays === 1 ? "" : "s"}`;
}

export default function TradieRequestWizard({
  open,
  onClose,
  project,
  initialProjectStage,
  initialTrade,
  initialKind = "QUOTE",
}: TradieRequestWizardProps) {
  const dispatch = useAppDispatch();
  const { tradiesByCategory, loading: tradiesLoading } = useAppSelector(
    (state) => state.tradieManagement,
  );

  const [step, setStep] = useState<Step>("activities");
  const [kind, setKind] = useState<TradieRequestKind>(initialKind);
  const booking = kind === "BOOKING";
  const [stage, setStage] = useState<ProjectStage | null>(
    initialProjectStage ?? null,
  );
  const [trade, setTrade] = useState<string | null>(initialTrade ?? null);
  const [includeUnassigned, setIncludeUnassigned] = useState(false);
  const [activities, setActivities] = useState<
    Record<string, RequestActivityDraft>
  >({});
  const [tradieIds, setTradieIds] = useState<string[]>([]);
  const [stepErrors, setStepErrors] = useState<{
    activities?: string;
    tradies?: string;
    subject?: string;
  }>({});

  const [subject, setSubject] = useState("");
  const [subjectEdited, setSubjectEdited] = useState(false);
  const [note, setNote] = useState("");
  const [copyEdits, setCopyEdits] = useState<Record<string, CopyEdit>>({});
  const [workLines, setWorkLines] = useState<Record<string, string[]>>({});
  const [drafting, setDrafting] = useState<ReadonlySet<string>>(new Set());
  const [draftError, setDraftError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ExtraAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [previewTradieId, setPreviewTradieId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SentTradieRequestsResult | null>(null);
  /** Activities the AI has already been asked about, so Back/Next does not re-ask. */
  const draftedRef = useRef<Set<string>>(new Set());

  // The directory, for the tradie picker. Same source and store as before.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    dispatch(setTradieLoading(true));
    getTradieGroupedByCategoryCached()
      .then((data) => {
        if (!cancelled) dispatch(setTradies(data));
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Error fetching tradies:", error);
        toast.error("Failed to fetch tradies. Please try again.");
      })
      .finally(() => {
        if (!cancelled) dispatch(setTradieLoading(false));
      });
    return () => {
      cancelled = true;
      dispatch(clearState());
    };
  }, [open, dispatch]);

  const milestones: RequestMilestone[] = project.milestones;
  const attachmentOptions = useMemo(
    () => requestAttachmentOptions(project),
    [project],
  );
  const milestoneById = useMemo(
    () => new Map(milestones.map((milestone) => [milestone.id, milestone])),
    [milestones],
  );

  const tradies = useMemo(
    // A tradie in several trades is listed under each; the picker wants them
    // once.
    () => [
      ...new Map(
        tradiesByCategory
          .flatMap((category) => category.tradies)
          .map((tradie) => [tradie.id, tradie]),
      ).values(),
    ],
    [tradiesByCategory],
  );
  // The trade it was opened on is always an option, even when only a past
  // booking puts it on the project: otherwise the picker reads blank while the
  // rest of the step is filtered by it.
  const tradeOptions = useMemo(
    () =>
      requestTradeOptions(milestones, [
        ...tradiesByCategory.map((category) => category.category),
        ...(trade ? [trade] : []),
      ]),
    [milestones, trade, tradiesByCategory],
  );

  /** Selected activities, in build order. */
  const selected = useMemo(
    () =>
      Object.keys(activities)
        .map((id) => milestoneById.get(id))
        .filter((milestone): milestone is RequestMilestone =>
          Boolean(milestone),
        )
        .sort((a, b) => a.order - b.order),
    [activities, milestoneById],
  );
  const recipients = useMemo(
    () =>
      tradieIds
        .map((id) => tradies.find((tradie) => tradie.id === id))
        .filter((tradie): tradie is (typeof tradies)[number] => Boolean(tradie))
        .map((tradie) => ({ id: tradie.id, name: tradie.name })),
    [tradieIds, tradies],
  );

  // The duplicate-booking rule, checked before the server refuses it.
  const conflicts = useMemo(() => {
    const found = new Map<string, string[]>();
    for (const milestone of selected) {
      const names = recipients
        .filter((recipient) =>
          activeRequestFor(project.tradieSchedules, recipient.id, milestone.id),
        )
        .map((recipient) => recipient.name);
      if (names.length > 0) found.set(milestone.id, names);
    }
    return found;
  }, [project.tradieSchedules, recipients, selected]);

  // A direct booking takes the trade the way a selected quote does, so the
  // same rule says whether it may, and what it cancels — shown before Next
  // rather than learned from a refusal after the email is written.
  const bookingCheck = useMemo(() => {
    if (!booking || !trade || recipients.length !== 1) return null;
    const [tradie] = recipients;
    const others = project.tradieSchedules
      .filter((schedule) => schedule.tradieId !== tradie.id)
      .map((schedule) => ({
        milestoneId: schedule.milestoneId,
        milestoneName: schedule.milestone?.name ?? null,
        quotedPrice: schedule.quotedPrice,
        status: schedule.status,
        trade: bookingTrade(schedule),
        tradieName: schedule.tradie.name,
      }));
    const live = project.tradeSelections.find(
      (item) =>
        sameTrade(item.trade, trade)
        && LIVE_SELECTION_STATUSES.includes(item.status),
    );
    const milestoneIds = selected.map((milestone) => milestone.id);
    return {
      displaced: bookingsDisplacedBySelection(
        milestoneIds.map((milestoneId) => ({
          milestoneId,
          status: "PENDING" as const,
        })),
        others,
        trade,
      ),
      refusal: directBookingRefusal({
        liveSelection: live
          ? {
              status: live.status,
              tradieId: live.tradieId,
              tradieName: live.tradie.name,
            }
          : null,
        milestoneIds,
        others,
        trade,
        tradieId: tradie.id,
        tradieName: tradie.name,
      }),
    };
  }, [
    booking,
    project.tradeSelections,
    project.tradieSchedules,
    recipients,
    selected,
    trade,
  ]);

  const defaultSubject = trade
    ? (booking ? tradieBookingSubject : tradieRequestSubject)({
        activityCount: selected.length,
        projectName: project.name,
        trade,
      })
    : "";
  const effectiveSubject = subjectEdited ? subject : defaultSubject;

  const changeTrade = (next: string) => {
    if (trade && sameTrade(trade, next)) return;
    setTrade(next);
    // Activities and tradies belong to a trade; carrying them over would send
    // a plumber a request for electrical work.
    setActivities({});
    setTradieIds([]);
    setWorkLines({});
    draftedRef.current = new Set();
    setStepErrors({});
  };

  const toggleActivity = useCallback(
    (milestone: RequestMilestone, on: boolean) => {
      setActivities((previous) => {
        if (!on) {
          const rest = { ...previous };
          delete rest[milestone.id];
          return rest;
        }
        return {
          ...previous,
          [milestone.id]: {
            durationDays: Math.max(1, milestone.estimatedDays || 1),
            scheduledDate: defaultActivityDate(milestone),
          },
        };
      });
      setStepErrors((previous) => ({ ...previous, activities: undefined }));
    },
    [],
  );

  const changeActivity = useCallback(
    (milestoneId: string, change: Partial<RequestActivityDraft>) => {
      setActivities((previous) =>
        previous[milestoneId]
          ? {
              ...previous,
              [milestoneId]: { ...previous[milestoneId], ...change },
            }
          : previous,
      );
    },
    [],
  );

  // A booking is one tradie: ticking another replaces the first.
  const toggleTradie = useCallback(
    (tradieId: string, on: boolean) => {
      setTradieIds((previous) =>
        on
          ? booking
            ? [tradieId]
            : previous.includes(tradieId)
              ? previous
              : [...previous, tradieId]
          : previous.filter((id) => id !== tradieId),
      );
      setStepErrors((previous) => ({ ...previous, tradies: undefined }));
    },
    [booking],
  );

  const changeKind = (next: TradieRequestKind) => {
    if (next === kind) return;
    setKind(next);
    if (next === "BOOKING") setTradieIds((previous) => previous.slice(0, 1));
    // A subject written for a quote request is wrong on a booking.
    setSubject("");
    setSubjectEdited(false);
    setStepErrors({});
  };

  const draft = useCallback(
    async (milestoneIds: readonly string[]) => {
      if (!trade || milestoneIds.length === 0) return;
      milestoneIds.forEach((id) => draftedRef.current.add(id));
      setDraftError(null);
      setDrafting(new Set(milestoneIds));
      try {
        const drafted = await draftTradieRequestWorkDetailsAction({
          milestoneIds,
          projectId: project.id,
          trade,
        });
        if (!drafted.ok) {
          setDraftError(drafted.message);
          return;
        }
        setWorkLines((previous) => {
          const next = { ...previous };
          for (const item of drafted.items)
            next[item.milestoneId] = [...item.lines];
          return next;
        });
        const missed = milestoneIds.filter(
          (id) => !drafted.items.some((item) => item.milestoneId === id),
        );
        if (missed.length > 0) {
          setDraftError(
            "Some activities came back without a draft. Write those by hand, or try Draft again.",
          );
        }
      } catch {
        setDraftError(
          "The draft could not be generated. Write the work details by hand, or try again.",
        );
      } finally {
        setDrafting(new Set());
      }
    },
    [project.id, trade],
  );

  const validateActivitiesStep = (): boolean => {
    const errors: typeof stepErrors = {};
    if (!trade) errors.activities = "Choose a trade category.";
    else if (selected.length === 0)
      errors.activities = "Choose at least one activity.";
    else if (selected.length > MAX_REQUEST_ACTIVITIES)
      errors.activities = `A request can cover at most ${MAX_REQUEST_ACTIVITIES} activities.`;
    else if (
      selected.some((milestone) => {
        const value = activities[milestone.id];
        return !value.scheduledDate || value.durationDays < 1;
      })
    )
      errors.activities =
        "Give every selected activity a start date and at least one day.";
    else if (conflicts.size > 0)
      errors.activities =
        "Some tradies already have an open request for a selected activity.";

    if (tradieIds.length === 0)
      errors.tradies = booking
        ? "Choose the tradie to book."
        : "Choose at least one tradie.";
    else if (booking && tradieIds.length > 1)
      errors.tradies = "Book one tradie at a time.";
    else if (tradieIds.length > MAX_REQUEST_TRADIES)
      errors.tradies = `A request can go to at most ${MAX_REQUEST_TRADIES} tradies at once.`;
    else if (bookingCheck?.refusal)
      errors.tradies = bookingCheck.refusal.message;

    setStepErrors(errors);
    return !errors.activities && !errors.tradies;
  };

  const goToEmail = () => {
    if (!validateActivitiesStep()) return;
    setStep("email");
    if (!recipients.some((recipient) => recipient.id === previewTradieId)) {
      setPreviewTradieId(recipients[0]?.id ?? "");
    }
    // Draft once per activity, on first arrival. Coming Back and forward again
    // keeps what the office edited.
    const fresh = selected
      .map((milestone) => milestone.id)
      .filter(
        (id) =>
          !draftedRef.current.has(id) && (workLines[id] ?? []).length === 0,
      );
    if (fresh.length > 0) void draft(fresh);
  };

  const emailActivities = useMemo(
    () =>
      selected.map((milestone) => ({
        dateLabel: activityDateLabel(activities[milestone.id]),
        durationDays: activities[milestone.id].durationDays,
        milestoneId: milestone.id,
        name: milestone.name,
        scheduledDate: activities[milestone.id].scheduledDate,
        stage: PROJECT_STAGE_LABELS[milestone.projectStage],
      })),
    [activities, selected],
  );

  const preview = useMemo(() => {
    if (step !== "email" || !trade) return null;
    const recipient =
      recipients.find((item) => item.id === previewTradieId) ?? recipients[0];
    const render = (copy?: Record<string, string>) =>
      (booking ? generateTradieBookingEmail : generateTradieRequestEmail)({
        activities: emailActivities.map((activity) => ({
          ...activity,
          workLines: workLines[activity.milestoneId] ?? [],
        })),
        copy,
        editable: true,
        note,
        projectName: project.name,
        reference: TRADIE_REF_PREVIEW,
        siteManager: {
          email: project.siteManager?.email ?? "",
          name: project.siteManager?.name ?? "",
          phone: project.siteManager?.phone ?? "",
        },
        subject: effectiveSubject,
        trade,
        tradieName: recipient?.name ?? "Tradie",
      });
    // The template's own text first, to tell which edits still apply.
    const template = render();
    const copy = liveCopy(copyEdits, template.copy);
    return {
      copy,
      defaults: template.copy,
      html: Object.keys(copy).length > 0 ? render(copy).html : template.html,
    };
  }, [
    booking,
    copyEdits,
    effectiveSubject,
    emailActivities,
    note,
    previewTradieId,
    project.name,
    project.siteManager,
    recipients,
    step,
    trade,
    workLines,
  ]);

  const submit = async () => {
    // Not while a file is still uploading: the email would go out without it.
    if (submitting || uploading || !trade) return;
    if (!effectiveSubject.trim()) {
      setStepErrors({ subject: "Give the email a subject." });
      return;
    }
    setSubmitting(true);
    try {
      // `.unwrap()`: without it a rejected thunk resolves and the wizard would
      // report success on a refused request.
      const sent = await dispatch(
        sendTradieRequests({
          activities: emailActivities.map((activity) => ({
            durationDays: activity.durationDays,
            milestoneId: activity.milestoneId,
            scheduledDate: activity.scheduledDate,
            workLines: (workLines[activity.milestoneId] ?? [])
              .map((line) => line.trim())
              .filter(Boolean),
          })),
          attachmentFileIds: extraAttachmentIds(attachments),
          copy: preview?.copy,
          kind,
          note: note.trim() || undefined,
          projectId: project.id,
          trade,
          subject: effectiveSubject.trim(),
          tradieIds,
        }),
      ).unwrap();

      const notSent = sent.deliveries.filter(
        (delivery) => delivery.status !== "SENT",
      );
      if (sent.cancelled > 0) {
        toast.info(
          `${sent.cancelled} other ${sent.cancelled === 1 ? "tradie's open request was" : "tradies' open requests were"} cancelled. They were not emailed.`,
        );
      }
      if (notSent.length === 0) {
        toast.success(
          booking
            ? `Booking sent to ${sent.deliveries[0]?.tradieName}. Their bookings wait on their confirmation.`
            : sent.deliveries.length === 1
              ? `Request sent to ${sent.deliveries[0].tradieName}.`
              : `Request sent to ${sent.deliveries.length} tradies.`,
        );
        closeAndReset();
        return;
      }
      // Saved but not everyone was emailed yet: say so, by name, and stay
      // open with Retry where a person may retry.
      setResult(sent);
      setStep("sent");
    } catch (error) {
      toast.error(
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "Failed to send the request. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // The single close path, so the wizard never reopens holding the last
  // request's selections, drafts or result.
  const closeAndReset = () => {
    setStep("activities");
    setKind(initialKind);
    setStage(initialProjectStage ?? null);
    setTrade(initialTrade ?? null);
    setIncludeUnassigned(false);
    setActivities({});
    setTradieIds([]);
    setStepErrors({});
    setSubject("");
    setSubjectEdited(false);
    setNote("");
    setCopyEdits({});
    setWorkLines({});
    setAttachments([]);
    setUploading(false);
    setDraftError(null);
    setResult(null);
    draftedRef.current = new Set();
    onClose();
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !submitting) closeAndReset();
  };

  const stepIndex = step === "activities" ? 0 : 1;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-mobile-scroll="body"
        className="grid max-h-[calc(100dvh-1.5rem)] max-w-6xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0 shadow-lg"
      >
        <DialogHeader className="space-y-3 border-b px-4 py-4 pr-14 sm:px-6 sm:py-5">
          <div>
            <DialogTitle>
              {booking ? "Book a tradie" : "New tradie request"}
            </DialogTitle>
            <DialogDescription>
              {booking
                ? "Book one tradie for several activities in one trade, without a quote. They get one email asking them to confirm the dates; you can record their price later."
                : "Ask one or more tradies to quote for several activities in one trade. Each tradie receives a single email covering them all."}
            </DialogDescription>
          </div>
          {step !== "sent" ? (
            <ol className="flex items-center gap-2 text-xs" aria-label="Steps">
              {STEPS.map((item, index) => {
                const done = index < stepIndex;
                const current = index === stepIndex;
                return (
                  <li
                    key={item.key}
                    className="flex items-center gap-2"
                    aria-current={current ? "step" : undefined}
                  >
                    {index > 0 ? (
                      <span aria-hidden="true" className="h-px w-6 bg-border" />
                    ) : null}
                    <span
                      className={cn(
                        "inline-flex size-5 items-center justify-center rounded-full font-semibold",
                        current || done
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {index + 1}
                    </span>
                    <span
                      className={cn(
                        current
                          ? "font-medium text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {item.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          {step === "activities" ? (
            <div className="space-y-5">
              <RequestKindPicker kind={kind} onKindChange={changeKind} />
              <RequestActivitiesStep
                kind={kind}
                displaced={bookingCheck?.displaced ?? []}
                milestones={milestones}
                schedules={project.tradieSchedules}
                tradeOptions={tradeOptions}
                tradies={tradies}
                tradiesLoading={tradiesLoading}
                stage={stage}
                onStageChange={setStage}
                trade={trade}
                onTradeChange={changeTrade}
                includeUnassigned={includeUnassigned}
                onIncludeUnassignedChange={setIncludeUnassigned}
                activities={activities}
                onToggleActivity={toggleActivity}
                onActivityChange={changeActivity}
                tradieIds={tradieIds}
                onToggleTradie={toggleTradie}
                conflicts={conflicts}
                errors={stepErrors}
              />
            </div>
          ) : step === "email" ? (
            <RequestEmailStep
              kind={kind}
              activities={emailActivities}
              workLines={workLines}
              onWorkLinesChange={(milestoneId, lines) =>
                setWorkLines((previous) => ({
                  ...previous,
                  [milestoneId]: lines,
                }))
              }
              subject={effectiveSubject}
              onSubjectChange={(value) => {
                setSubject(value);
                setSubjectEdited(true);
                setStepErrors((previous) => ({
                  ...previous,
                  subject: undefined,
                }));
              }}
              note={note}
              onNoteChange={setNote}
              drafting={drafting}
              draftError={draftError}
              onDraft={(ids) => void draft(ids)}
              recipients={recipients}
              previewTradieId={previewTradieId || recipients[0]?.id || ""}
              onPreviewTradieChange={setPreviewTradieId}
              previewHtml={preview?.html ?? ""}
              editedCopy={Object.keys(preview?.copy ?? {}).length}
              onCopyEdit={(key, text) => {
                const from = preview?.defaults[key];
                if (from === undefined) return;
                setCopyEdits((previous) => ({
                  ...previous,
                  [key]: { from, to: text },
                }));
              }}
              onCopyReset={() => setCopyEdits({})}
              subjectError={stepErrors.subject}
              attachments={
                <ExtraAttachmentsField
                  projectId={project.id}
                  label="Attachments (optional)"
                  value={attachments}
                  onChange={setAttachments}
                  vaultOptions={attachmentOptions}
                  disabled={submitting}
                  onUploadingChange={setUploading}
                  hint={
                    recipients.length > 1
                      ? `Plans, a scope or site photos. Pick from this project's files or upload new ones; every tradie's email carries them. Up to ${MAX_REQUEST_ATTACHMENTS}.`
                      : `Plans, a scope or site photos. Pick from this project's files or upload new ones. Up to ${MAX_REQUEST_ATTACHMENTS}.`
                  }
                />
              }
            />
          ) : result ? (
            <DeliveryReport projectId={project.id} result={result} />
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          {step === "sent" ? (
            <Button className="sm:ml-auto" onClick={closeAndReset}>
              Done
            </Button>
          ) : (
            <>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {trade
                  ? `${trade} · ${selected.length} ${selected.length === 1 ? "activity" : "activities"} · ${tradieIds.length} ${tradieIds.length === 1 ? "tradie" : "tradies"}`
                  : "Choose a trade to begin."}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:flex">
                {step === "activities" ? (
                  <Button
                    variant="outline"
                    onClick={() => handleOpenChange(false)}
                  >
                    Cancel
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => setStep("activities")}
                    disabled={submitting || uploading}
                  >
                    Back
                  </Button>
                )}
                {step === "activities" ? (
                  <Button onClick={goToEmail}>Next: review email</Button>
                ) : (
                  <Button
                    onClick={submit}
                    disabled={submitting || uploading || drafting.size > 0}
                    aria-busy={submitting}
                  >
                    {submitting ? (
                      <Loader2
                        className="mr-1.5 size-4 animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                    ) : (
                      <Send className="mr-1.5 size-4" aria-hidden="true" />
                    )}
                    {submitting
                      ? "Sending…"
                      : uploading
                        ? "Uploading…"
                        : booking
                          ? "Send booking"
                          : recipients.length === 1
                            ? "Send request"
                            : `Send ${recipients.length} requests`}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Shown only when at least one email did not go straight out. The bookings
 * are saved either way. Each row reads the live state from the store, so a
 * Retry here — or one that happens on the Tradies tab — updates it in place.
 */
function DeliveryReport({
  projectId,
  result,
}: {
  projectId: string;
  result: SentTradieRequestsResult;
}) {
  const schedules = useAppSelector(
    (state) => state.projects.activeProject?.tradieSchedules,
  );
  const live = (recipientId: string) =>
    schedules?.find((schedule) => schedule.requestRecipient?.id === recipientId)
      ?.requestRecipient;
  const deliveries = result.deliveries.map((delivery) => ({
    delivery: live(delivery.recipientId) ?? {
      attempts: delivery.attempts,
      // Only read when the store has not caught up; a fresh send is not stalled.
      createdAt: new Date(),
      deliveryStatus: delivery.status,
      id: delivery.recipientId,
      lastAttemptAt: null,
      lastError: delivery.reason,
      nextAttemptAt: delivery.nextAttemptAt,
      sentAt: null,
    },
    to: delivery.to,
    tradieId: delivery.tradieId,
    tradieName: delivery.tradieName,
  }));
  const waiting = deliveries.filter(
    ({ delivery }) => delivery.deliveryStatus !== "SENT",
  );
  const retrying = waiting.filter(
    ({ delivery }) => delivery.deliveryStatus === "RETRYING",
  ).length;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div
        role="alert"
        className={
          waiting.length === 0
            ? "rounded-lg border border-success/40 bg-success-light p-4"
            : "rounded-lg border border-warning/40 bg-warning-light p-4"
        }
      >
        <p
          className={
            waiting.length === 0
              ? "text-sm font-semibold text-success-ink"
              : "text-sm font-semibold text-warning-ink"
          }
        >
          {waiting.length === 0
            ? "Every email has now gone out."
            : `The request is saved, but ${waiting.length} of ${deliveries.length} ${deliveries.length === 1 ? "email has" : "emails have"} not gone out yet.`}
        </p>
        {waiting.length > 0 ? (
          <p className="mt-1 text-sm text-warning-ink">
            {retrying > 0
              ? "Emails marked Retrying are tried again automatically. "
              : ""}
            Anything that fails stays on the Tradies tab and in the project
            alerts with a Retry button until it is sent.
          </p>
        ) : null}
      </div>
      <ul className="divide-y rounded-lg border border-border/70 bg-card">
        {deliveries.map(({ delivery, to, tradieId, tradieName }) => (
          <li key={tradieId} className="space-y-1.5 px-4 py-3">
            <p className="text-sm font-medium text-foreground">
              {tradieName}
              <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                {to}
              </span>
            </p>
            <RequestDeliveryStatus
              projectId={projectId}
              delivery={delivery}
              tradieName={tradieName}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
