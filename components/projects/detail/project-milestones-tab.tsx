"use client";

import { Fragment, useMemo, useState } from "react";
import type { UserPrincipal } from "@/lib/domain/principal";
import { addWeeks, format, isWithinInterval } from "date-fns";
import {
  CalendarCheck2,
  CalendarPlus,
  ChevronDown,
  Lock,
  Plus,
} from "lucide-react";

import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  duenessOf,
  findWorkingStageIndex,
  lastCompleted,
  nextActivity,
  partitionActivities,
  stageRollup,
  stageState,
  type StageState,
} from "@/lib/projects/milestone-ledger";
import {
  buildMilestoneTree,
  groupRootsByStage,
} from "@/lib/projects/milestone-tree";
import {
  contractClaimTotal,
  resolveStageClaims,
} from "@/lib/projects/stage-claim";
import { sydneyDateOnly } from "@/lib/dates/sydney";
import { isTradieAlertLive } from "@/lib/domain/tradies/alert-rules";
import { milestoneEndDate } from "@/lib/domain/projects/milestone-schedule";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { cn } from "@/lib/utils";
import {
  PROJECT_STAGE_LABELS,
  PROJECT_STAGE_PERCENTAGE,
  type ProjectDetail,
  type TradieScheduleListItem,
  type TradieScheduleWithTradieAndMilestone,
  type UIMilestone,
} from "@/types/project";
import { currency } from "@/utils/formatters";
import { MilestoneStatus, ProjectStage } from "@prisma/client";

import { CreateVariationModal } from "@/components/projects/create-variation-modal";

import { MilestoneCard } from "./milestone-tab/milestone-card";

interface LedgerStage {
  stage: ProjectStage;
  label: string;
  percentage: number | null;
  claim: number | null;
  milestones: UIMilestone[];
  state: StageState;
  /** False while an earlier stage is still open: stages are claimed in order. */
  isWorkable: boolean;
  /** The stage holding this one up, when it is gated. */
  blockedBy: LedgerStage | null;
}

function shortDate(value: Date) {
  return format(value, "d MMM");
}

/**
 * What a stage is waiting on, in one line.
 *
 * Every stage carries one — including the finished and the gated — because the
 * question this tab exists to answer is "what happens next", and a row that
 * answers it only when expanded makes the user open all six to find out.
 */
function NextUp({ ledgerStage }: { ledgerStage: LedgerStage }) {
  const next = nextActivity(ledgerStage.milestones);
  const rollup = stageRollup(ledgerStage.milestones);

  if (ledgerStage.state === "complete") {
    return (
      <span className="text-muted-foreground">All {rollup.total} done</span>
    );
  }

  if (!next) {
    return <span className="text-muted-foreground">No activities yet</span>;
  }

  const name = next.parent
    ? `${next.parent.name} › ${next.activity.name}`
    : next.activity.name;

  if (!ledgerStage.isWorkable) {
    return (
      <>
        <span className="block truncate font-medium text-foreground">
          {name}
        </span>
        <span className="block text-muted-foreground">
          from{" "}
          <span className="font-mono tabular-nums">
            {shortDate(new Date(next.activity.targetDate))}
          </span>
          {ledgerStage.blockedBy
            ? ` · after ${ledgerStage.blockedBy.label}`
            : null}
        </span>
      </>
    );
  }

  const dueness = duenessOf(next.activity, new Date());
  const detail =
    dueness.kind === "overdue"
      ? `Overdue ${Math.abs(dueness.days)}d`
      : dueness.kind === "today"
        ? "Due today"
        : dueness.kind === "soon"
          ? `Due in ${dueness.days}d`
          : `Due ${shortDate(milestoneEndDate(next.activity))}`;

  return (
    <>
      <span className="block truncate font-medium text-foreground">{name}</span>
      <span
        className={cn(
          "block",
          dueness.kind === "overdue"
            ? "font-semibold text-destructive-ink"
            : dueness.kind === "today" || dueness.kind === "soon"
              ? "font-semibold text-warning-ink"
              : "text-muted-foreground",
        )}
      >
        {detail}
      </span>
    </>
  );
}

function StageStatusPill({ state }: { state: StageState }) {
  if (state === "complete")
    return <StatusPill tone="success">Complete</StatusPill>;
  if (state === "active") return <StatusPill tone="warning">Active</StatusPill>;
  return <StatusPill tone="neutral">Upcoming</StatusPill>;
}

export function ProjectMilestonesTab({
  project,
  isAdmin,
  notesViewer,
}: {
  project: ProjectDetail;
  isAdmin: boolean;
  /** Who is reading staff notes; null hides them (a customer). */
  notesViewer: UserPrincipal | null;
}) {
  const dispatch = useAppDispatch();
  const projectStageData =
    project.requirements?.commercialsAndClaims?.paymentStages;
  // The contract's own claim schedule wins over the static stage table: the
  // percentages there are what the owner actually agreed to pay per stage.
  // Shared with the invoice generator so a stage bills exactly what is shown here.
  const stageClaims = useMemo(
    () => resolveStageClaims(projectStageData, Number(project.totalBudget)),
    [projectStageData, project.totalBudget],
  );
  const visualMilestones = useMemo(
    () => buildMilestoneTree(project.milestones),
    [project.milestones],
  );

  const ledgerStages = useMemo<LedgerStage[]>(() => {
    const grouped = groupRootsByStage(visualMilestones);

    // Milestones arrive sorted by `order`, which need not follow the contract
    // stages, so the ledger is driven by the canonical stage sequence instead.
    // Carrying each stage's milestones alongside its key keeps the array in
    // hand rather than re-reading a partial record TS cannot prove is populated.
    const populated = (Object.keys(PROJECT_STAGE_PERCENTAGE) as ProjectStage[])
      .map((stage) => ({ stage, milestones: grouped[stage] ?? [] }))
      .filter((entry) => entry.milestones.length > 0);

    const states = populated.map((entry) => stageState(entry.milestones));
    const workingIndex = findWorkingStageIndex(states);

    const rows: LedgerStage[] = populated.map(
      ({ stage, milestones }, index) => {
        const { percentage, claim } = stageClaims[stage];

        return {
          stage,
          label: PROJECT_STAGE_LABELS[stage] ?? stage,
          percentage,
          claim,
          milestones,
          state: states[index],
          isWorkable: index === workingIndex,
          blockedBy: null,
        };
      },
    );

    // A gated stage names the stage in front of it, which is the one currently
    // being worked — not simply the row above, which may itself be complete.
    const gate = workingIndex >= 0 ? rows[workingIndex] : null;
    return rows.map((row) =>
      row.isWorkable || row.state === "complete"
        ? row
        : { ...row, blockedBy: gate },
    );
  }, [visualMilestones, stageClaims]);

  const workingStage = ledgerStages.find((row) => row.isWorkable);

  const [openStages, setOpenStages] = useState<ProjectStage[]>(() =>
    workingStage ? [workingStage.stage] : [],
  );
  const [stagesShowingDone, setStagesShowingDone] = useState<ProjectStage[]>(
    [],
  );
  // The activity a variation is being raised on, while the wizard is open.
  const [variationFor, setVariationFor] = useState<string | null>(null);

  const toggleStage = (stage: ProjectStage) =>
    setOpenStages((open) =>
      open.includes(stage)
        ? open.filter((candidate) => candidate !== stage)
        : [...open, stage],
    );

  const toggleDone = (stage: ProjectStage) =>
    setStagesShowingDone((shown) =>
      shown.includes(stage)
        ? shown.filter((candidate) => candidate !== stage)
        : [...shown, stage],
    );

  const tradieAlerts = useMemo(() => {
    const now = new Date();
    const nextWeek = addWeeks(now, 1);
    const today = sydneyDateOnly(now);

    return project.tradieSchedules.filter((schedule) => {
      if (schedule.status === "CANCELLED") return false;
      // Settled with its milestone, past its last day, or dismissed.
      if (!isTradieAlertLive(schedule, project.tradieSchedules, today)) {
        return false;
      }
      const hasAlertStatus = schedule.status === "CONFIRMED";

      const targetDate = schedule.milestone?.targetDate;
      const isMilestoneDueSoon =
        targetDate
        && isWithinInterval(new Date(targetDate), {
          start: now,
          end: nextWeek,
        });

      return hasAlertStatus || isMilestoneDueSoon;
    });
  }, [project.tradieSchedules]);

  const tradieAlertsByMilestone = useMemo(() => {
    return tradieAlerts.reduce<
      Record<string, TradieScheduleWithTradieAndMilestone[]>
    >((acc, schedule) => {
      if (!schedule.milestoneId || schedule.status !== "CONFIRMED") {
        return acc;
      }

      acc[schedule.milestoneId] = acc[schedule.milestoneId] ?? [];
      acc[schedule.milestoneId].push(schedule);
      return acc;
    }, {});
  }, [tradieAlerts]);

  const handleOpenAddUpdateModal = (id: string) => {
    dispatch(
      openModal({
        type: "addMilestonePicture",
        payload: { milestoneId: id, projectId: project.id },
      }),
    );
  };

  const handleSendReminder = (tradieReminder: TradieScheduleListItem) => {
    dispatch(
      openModal({
        type: "tradieReminder",
        payload: { schedule: tradieReminder },
      }),
    );
  };

  const handleAddMilestone = (stage: ProjectStage) => {
    dispatch(
      openModal({
        type: "addMilestone",
        payload: { projectId: project.id, projectStage: stage },
      }),
    );
  };

  const handleScheduleTradies = (stage: ProjectStage) => {
    dispatch(
      openModal({
        type: "scheduleTradie",
        payload: { project, projectStage: stage },
      }),
    );
  };

  const handleOpenViewPicture = (
    imageUrls: string[],
    selectedIndex: number,
  ) => {
    dispatch(
      openModal({ type: "viewPicture", payload: { imageUrls, selectedIndex } }),
    );
  };

  const handleStatusUpdate = (
    milestoneId: string,
    status?: MilestoneStatus,
  ) => {
    dispatch(
      openModal({
        type: "updateMilestoneStatus",
        payload: {
          milestoneId,
          projectId: project.id,
          newStatus: status || MilestoneStatus.DONE,
          isAdmin: isAdmin,
        },
      }),
    );
  };

  const handleStartMilestone = (milestoneId: string) => {
    dispatch(
      openModal({
        type: "updateMilestoneStatus",
        payload: {
          milestoneId,
          projectId: project.id,
          newStatus: MilestoneStatus.ACTIVE,
        },
      }),
    );
  };

  const handleMarkAsNotRequired = (milestoneId: string) => {
    dispatch(
      openModal({
        type: "updateMilestoneStatus",
        payload: {
          milestoneId,
          projectId: project.id,
          newStatus: MilestoneStatus.NOT_REQUIRED,
        },
      }),
    );
  };

  // "Contract total" means the whole claim schedule. Summing only the stages
  // that currently carry activities would under-report it the moment a stage
  // is emptied, and this figure is money.
  // No stage resolved an amount — the total is unknown, not zero. Printing
  // $0 as a contract total would be a confident wrong number.
  const contractTotal = useMemo(
    () => contractClaimTotal(stageClaims),
    [stageClaims],
  );
  // Stage, [Claim], Progress, Status, Next up, disclosure.
  const columnCount = isAdmin ? 6 : 5;

  return (
    <section className="grid gap-4">
      <Card className="rounded-xl border-border/70 bg-card shadow-sm">
        <CardHeader className="border-b border-border/70 pb-4">
          <CardTitle
            as="h2"
            className="flex items-center gap-2 text-base font-semibold text-foreground"
          >
            <CalendarCheck2
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            Stage schedule
          </CardTitle>
        </CardHeader>

        <CardContent className="px-0 pt-0">
          {ledgerStages.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <p className="text-sm font-medium text-foreground">
                No activities yet
              </p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Add the first activity to break this project into stages with
                target dates and budgets.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="project-stage-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Stage</TableHead>
                    {isAdmin ? (
                      <TableHead className="text-right">Claim</TableHead>
                    ) : null}
                    <TableHead className="hidden md:table-cell">
                      Progress
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      Status
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      Next up
                    </TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {ledgerStages.map((ledgerStage) => {
                    const isOpen = openStages.includes(ledgerStage.stage);
                    const rollup = stageRollup(ledgerStage.milestones);
                    const { open, settled } = partitionActivities(
                      ledgerStage.milestones,
                    );
                    const isShowingDone = stagesShowingDone.includes(
                      ledgerStage.stage,
                    );
                    const mostRecent = lastCompleted(ledgerStage.milestones);
                    const bodyId = `stage-activities-${ledgerStage.stage}`;

                    return (
                      <Fragment key={ledgerStage.stage}>
                        <TableRow
                          className={cn(
                            "cursor-pointer",
                            isOpen && "bg-primary/5 hover:bg-primary/5",
                          )}
                          onClick={() => toggleStage(ledgerStage.stage)}
                        >
                          <TableCell className="stage-heading">
                            <span className="font-medium text-foreground">
                              {ledgerStage.label}
                            </span>
                            {ledgerStage.percentage != null ? (
                              <span className="ml-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                                {ledgerStage.percentage}%
                              </span>
                            ) : null}

                            {/* Below `sm` the Status and Next up columns are
                                gone, so both fold in under the stage name. */}
                            <span className="ml-1.5 inline-flex align-middle md:hidden">
                              <StageStatusPill state={ledgerStage.state} />
                            </span>
                            <span className="mt-1 block text-xs md:hidden">
                              <NextUp ledgerStage={ledgerStage} />
                            </span>
                          </TableCell>

                          {isAdmin ? (
                            <TableCell className="stage-claim text-right font-mono tabular-nums">
                              <span className="mb-1 block font-sans text-xs text-muted-foreground md:hidden">
                                Stage claim
                              </span>
                              {ledgerStage.claim === null
                                ? "—"
                                : currency.format(ledgerStage.claim)}
                            </TableCell>
                          ) : null}

                          <TableCell className="hidden md:table-cell">
                            <span className="flex items-center gap-2">
                              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                                {rollup.done} / {rollup.total}
                              </span>
                              <span
                                className="h-1 w-14 overflow-hidden rounded-full bg-muted"
                                aria-hidden="true"
                              >
                                <span
                                  className={cn(
                                    "block h-full rounded-full",
                                    ledgerStage.state === "complete"
                                      ? "bg-success-ink"
                                      : "bg-warning-ink",
                                  )}
                                  style={{
                                    width: `${
                                      rollup.total
                                        ? Math.round(
                                            (rollup.done / rollup.total) * 100,
                                          )
                                        : 0
                                    }%`,
                                  }}
                                />
                              </span>
                            </span>
                          </TableCell>

                          <TableCell className="hidden md:table-cell">
                            <StageStatusPill state={ledgerStage.state} />
                          </TableCell>

                          <TableCell className="hidden max-w-[22rem] text-xs md:table-cell">
                            <NextUp ledgerStage={ledgerStage} />
                          </TableCell>

                          <TableCell className="stage-actions">
                            <span className="flex items-center justify-end gap-1">
                              {/* A finished stage has no open activity left to
                                  book a tradie onto, so it gets no button. */}
                              {ledgerStage.state !== "complete" ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-primary"
                                  aria-label={`Schedule tradies for ${ledgerStage.label}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleScheduleTradies(ledgerStage.stage);
                                  }}
                                >
                                  <CalendarPlus
                                    className="size-4"
                                    aria-hidden="true"
                                  />
                                  <span className="hidden whitespace-nowrap md:inline">
                                    Schedule tradies
                                  </span>
                                </Button>
                              ) : null}
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-expanded={isOpen}
                                aria-controls={isOpen ? bodyId : undefined}
                                aria-label={`${isOpen ? "Hide" : "Show"} ${ledgerStage.label} activities`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleStage(ledgerStage.stage);
                                }}
                              >
                                <ChevronDown
                                  className={cn(
                                    "size-4 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                                    isOpen && "rotate-180",
                                  )}
                                  aria-hidden="true"
                                />
                              </Button>
                            </span>
                          </TableCell>
                        </TableRow>

                        {isOpen ? (
                          <TableRow className="hover:bg-transparent">
                            <TableCell
                              colSpan={columnCount}
                              className="bg-background p-0"
                            >
                              <div id={bodyId}>
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/70 px-4 py-2 text-xs text-muted-foreground">
                                  {ledgerStage.isWorkable
                                  || ledgerStage.state === "complete" ? (
                                    <span>
                                      {ledgerStage.state === "complete"
                                        ? `All ${rollup.total} activities done`
                                        : `${rollup.remaining} to go · ${rollup.done} done`}
                                      {rollup.notRequired > 0
                                        ? ` · ${rollup.notRequired} not required`
                                        : null}
                                    </span>
                                  ) : (
                                    /* One explanation for the stage beats the
                                       same sentence repeated on every row. */
                                    <span className="flex items-center gap-1.5">
                                      <Lock
                                        className="size-3.5"
                                        aria-hidden="true"
                                      />
                                      <span>
                                        <span className="font-medium text-foreground">
                                          Opens when{" "}
                                          {ledgerStage.blockedBy?.label} is
                                          complete
                                        </span>
                                        {ledgerStage.blockedBy
                                          ? ` · ${
                                              stageRollup(
                                                ledgerStage.blockedBy
                                                  .milestones,
                                              ).remaining
                                            } ${ledgerStage.blockedBy.label} activities to go`
                                          : null}
                                      </span>
                                    </span>
                                  )}

                                  <Button
                                    size="default"
                                    variant="ghost"
                                    className="ml-auto text-primary"
                                    onClick={() =>
                                      handleAddMilestone(ledgerStage.stage)
                                    }
                                  >
                                    <Plus
                                      className="size-4"
                                      aria-hidden="true"
                                    />
                                    Add activity
                                    <span className="sr-only">
                                      to {ledgerStage.label}
                                    </span>
                                  </Button>
                                </div>

                                {open.length > 0 ? (
                                  <ul className="list-none px-4">
                                    {open.map((milestone) => (
                                      <MilestoneCard
                                        key={milestone.id}
                                        isActiveStage={ledgerStage.isWorkable}
                                        isAdmin={isAdmin}
                                        notesViewer={notesViewer}
                                        milestone={milestone}
                                        project={project}
                                        tradieAlertsByMilestone={
                                          tradieAlertsByMilestone
                                        }
                                        onOpenAddUpdateModal={
                                          handleOpenAddUpdateModal
                                        }
                                        onStatusUpdate={handleStatusUpdate}
                                        onStartMilestone={handleStartMilestone}
                                        onSendReminder={handleSendReminder}
                                        onOpenViewPicture={
                                          handleOpenViewPicture
                                        }
                                        onMarkasNotRequired={
                                          handleMarkAsNotRequired
                                        }
                                        onCreateVariation={
                                          isAdmin ? setVariationFor : undefined
                                        }
                                      />
                                    ))}
                                  </ul>
                                ) : null}

                                {settled.length > 0 ? (
                                  <>
                                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 bg-muted/60 px-4 py-1.5 text-xs text-muted-foreground">
                                      <span>
                                        {rollup.done} done
                                        {mostRecent && open.length > 0 ? (
                                          <>
                                            {" · last "}
                                            {mostRecent.name}{" "}
                                            <span className="font-mono tabular-nums">
                                              {shortDate(
                                                new Date(
                                                  mostRecent.actualDate as Date,
                                                ),
                                              )}
                                            </span>
                                          </>
                                        ) : null}
                                        {rollup.notRequired > 0
                                          ? ` · ${rollup.notRequired} not required`
                                          : null}
                                      </span>

                                      <Button
                                        size="default"
                                        variant="ghost"
                                        className="text-primary"
                                        aria-expanded={isShowingDone}
                                        onClick={() =>
                                          toggleDone(ledgerStage.stage)
                                        }
                                      >
                                        {isShowingDone ? "Hide" : "Show"}
                                        <span className="sr-only">
                                          done activities in {ledgerStage.label}
                                        </span>
                                        <ChevronDown
                                          className={cn(
                                            "size-4 transition-transform duration-200 motion-reduce:transition-none",
                                            isShowingDone && "rotate-180",
                                          )}
                                          aria-hidden="true"
                                        />
                                      </Button>
                                    </div>

                                    {isShowingDone ? (
                                      <ul className="list-none px-4">
                                        {settled.map((milestone) => (
                                          <MilestoneCard
                                            key={milestone.id}
                                            isActiveStage={
                                              ledgerStage.isWorkable
                                            }
                                            isAdmin={isAdmin}
                                            notesViewer={notesViewer}
                                            milestone={milestone}
                                            project={project}
                                            tradieAlertsByMilestone={
                                              tradieAlertsByMilestone
                                            }
                                            onOpenAddUpdateModal={
                                              handleOpenAddUpdateModal
                                            }
                                            onStatusUpdate={handleStatusUpdate}
                                            onStartMilestone={
                                              handleStartMilestone
                                            }
                                            onSendReminder={handleSendReminder}
                                            onOpenViewPicture={
                                              handleOpenViewPicture
                                            }
                                            onMarkasNotRequired={
                                              handleMarkAsNotRequired
                                            }
                                            onCreateVariation={
                                              isAdmin
                                                ? setVariationFor
                                                : undefined
                                            }
                                          />
                                        ))}
                                      </ul>
                                    ) : null}
                                  </>
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </TableBody>

                {isAdmin ? (
                  <TableFooter>
                    <TableRow className="hover:bg-transparent">
                      <TableCell className="text-xs font-normal text-muted-foreground">
                        Contract total
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {contractTotal === null
                          ? "—"
                          : currency.format(contractTotal)}
                      </TableCell>
                      <TableCell colSpan={columnCount - 2} />
                    </TableRow>
                  </TableFooter>
                ) : null}
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      {isAdmin ? (
        <CreateVariationModal
          projectId={project.id}
          open={variationFor !== null}
          onOpenChange={(open) => {
            if (!open) setVariationFor(null);
          }}
          initialMilestoneId={variationFor}
        />
      ) : null}
    </section>
  );
}
