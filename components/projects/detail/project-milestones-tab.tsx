"use client";

import { Fragment, useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarCheck2, ChevronDown, Lock, Plus } from "lucide-react";

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
  stageClaimAmount,
  stageRollup,
  stageState,
  type StageState,
} from "@/lib/projects/milestone-ledger";
import {
  matchPaymentStagesToProjectStages,
} from "@/lib/projects/payment-stages";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { selectTradieAlerts } from "@/lib/projects/project-warnings";
import {
  MILESTONE_TRANSITIONS,
  canTransition,
  transitionRefusal,
} from "@/lib/projects/milestone-transitions";
import { useWebMcpTools } from "@/hooks/use-webmcp-tool";
import {
  summariseZodIssues,
  webMcpError,
  webMcpJson,
  webMcpText,
} from "@/components/webmcp/tool-result";
import { toToolInputJsonSchema } from "@/lib/tools/zod-to-json-schema";
import {
  addProjectMilestone,
  updateProjectMilestoneStatus,
} from "@/lib/store/slices/projectsSlice";
import {
  milestoneCreationSchema,
  milestoneUpdateSchema,
} from "@/utils/validators/milestone";
import { isSettled } from "@/lib/projects/milestone-ledger";
import { cn } from "@/lib/utils";
import {
  PROJECT_STAGE_LABELS,
  PROJECT_STAGE_PERCENTAGE,
  type MilestoneWithFilesTradiesUpdates,
  type ProjectDetail,
  type TradieScheduleListItem,
  type TradieScheduleWithTradieAndMilestone,
  type UIMilestone,
} from "@/types/project";
import { currency } from "@/utils/formatters";
import { MilestoneStatus, ProjectStage } from "@prisma/client";

import { MilestoneCard } from "./milestone-tab/milestone-card";

/**
 * Converted once, at module scope. The registration hook hashes the tool
 * declaration to decide whether to re-register, so a schema rebuilt on each
 * render would churn the agent's tool list on every keystroke in the tab.
 */
const milestoneCreateJsonSchema = toToolInputJsonSchema(milestoneCreationSchema);

const milestoneIdOnlySchema = {
  type: "object",
  properties: {
    milestoneId: { type: "string", description: "From get_milestones." },
  },
  required: ["milestoneId"],
  additionalProperties: false,
} as const;

const startMilestoneSchema = {
  type: "object",
  properties: {
    milestoneId: { type: "string", description: "From get_milestones." },
    startDate: { type: "string", description: "The date work started, YYYY-MM-DD." },
  },
  required: ["milestoneId", "startDate"],
  additionalProperties: false,
} as const;

const finishMilestoneSchema = {
  type: "object",
  properties: {
    milestoneId: { type: "string", description: "From get_milestones." },
    startDate: { type: "string", description: "The date work started, YYYY-MM-DD." },
    actualDate: {
      type: "string",
      description: "The date work finished, YYYY-MM-DD. Cannot precede startDate.",
    },
    spend: { type: "number", description: "What the milestone actually cost." },
  },
  required: ["milestoneId", "startDate", "actualDate", "spend"],
  additionalProperties: false,
} as const;

const updateMilestoneDetailsSchema = {
  type: "object",
  properties: {
    milestoneId: { type: "string", description: "From get_milestones." },
    targetDate: { type: "string", description: "The new due date, YYYY-MM-DD." },
  },
  required: ["milestoneId", "targetDate"],
  additionalProperties: false,
} as const;

const asToolSchema = (schema: unknown) => schema as Record<string, unknown>;

const convertToVisualMilestone = (
  milestones: MilestoneWithFilesTradiesUpdates[],
): UIMilestone[] => {
  const milestoneMap: Record<string, UIMilestone> = {};

  // First pass: create every milestone so parents can be referenced
  // regardless of their position in the input array.
  milestones.forEach((m) => {
    milestoneMap[m.id] = {
      ...m,
      childrenMilestones: [],
    };
  });

  const rootMilestones: UIMilestone[] = [];

  // Second pass: build the hierarchy.
  Object.values(milestoneMap).forEach((milestone) => {
    if (milestone.parentId) {
      const parent = milestoneMap[milestone.parentId];

      if (parent) {
        parent.childrenMilestones.push(milestone);
      }
    } else {
      rootMilestones.push(milestone);
    }
  });

  // Sort children recursively and roots by order.
  const sortMilestones = (items: UIMilestone[]) => {
    items.sort((a, b) => a.order - b.order);

    items.forEach((milestone) => {
      sortMilestones(milestone.childrenMilestones);
    });
  };

  sortMilestones(rootMilestones);

  return rootMilestones;
};

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
          {ledgerStage.blockedBy ? ` · after ${ledgerStage.blockedBy.label}` : null}
        </span>
      </>
    );
  }

  const dueness = duenessOf(new Date(next.activity.targetDate), new Date());
  const detail =
    dueness.kind === "overdue"
      ? `Overdue ${Math.abs(dueness.days)}d`
      : dueness.kind === "today"
        ? "Due today"
        : dueness.kind === "soon"
          ? `Due in ${dueness.days}d`
          : `Due ${shortDate(new Date(next.activity.targetDate))}`;

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
  if (state === "complete") return <StatusPill tone="success">Complete</StatusPill>;
  if (state === "active") return <StatusPill tone="warning">Active</StatusPill>;
  return <StatusPill tone="neutral">Upcoming</StatusPill>;
}

export function ProjectMilestonesTab({
  project,
  isAdmin,
}: {
  project: ProjectDetail;
  isAdmin: boolean;
}) {
  const dispatch = useAppDispatch();
  const projectStageData =
    project.requirements?.commercialsAndClaims?.paymentStages;
  // The contract's own claim schedule wins over the static stage table: the
  // percentages there are what the owner actually agreed to pay per stage.
  const contractStages = useMemo(
    () => matchPaymentStagesToProjectStages(projectStageData),
    [projectStageData],
  );
  const visualMilestones = useMemo(
    () => convertToVisualMilestone(project.milestones),
    [project.milestones],
  );

  const ledgerStages = useMemo<LedgerStage[]>(() => {
    const grouped = visualMilestones.reduce<Record<string, UIMilestone[]>>(
      (acc, milestone) => {
        acc[milestone.projectStage] = acc[milestone.projectStage] ?? [];
        acc[milestone.projectStage].push(milestone);
        return acc;
      },
      {},
    );

    // Milestones arrive sorted by `order`, which need not follow the contract
    // stages, so the ledger is driven by the canonical stage sequence instead.
    const populated = (
      Object.keys(PROJECT_STAGE_PERCENTAGE) as ProjectStage[]
    ).filter((stage) => grouped[stage]?.length);

    const projectBudget = Number(project.totalBudget);
    const states = populated.map((stage) => stageState(grouped[stage]));
    const workingIndex = findWorkingStageIndex(states);

    const rows: LedgerStage[] = populated.map((stage, index) => {
      const contractStage = contractStages[stage];
      const percentage =
        contractStage?.percentage ??
        (PROJECT_STAGE_PERCENTAGE[stage] != null
          ? PROJECT_STAGE_PERCENTAGE[stage] * 100
          : null);
      const claim = stageClaimAmount(
        contractStage?.amount,
        percentage,
        projectBudget,
      );

      return {
        stage,
        label: PROJECT_STAGE_LABELS[stage] ?? stage,
        percentage,
        claim,
        milestones: grouped[stage],
        state: states[index],
        isWorkable: index === workingIndex,
        blockedBy: null,
      };
    });

    // A gated stage names the stage in front of it, which is the one currently
    // being worked — not simply the row above, which may itself be complete.
    const gate = workingIndex >= 0 ? rows[workingIndex] : null;
    return rows.map((row) =>
      row.isWorkable || row.state === "complete"
        ? row
        : { ...row, blockedBy: gate },
    );
  }, [visualMilestones, contractStages, project.totalBudget]);

  const workingStage = ledgerStages.find((row) => row.isWorkable);

  const [openStages, setOpenStages] = useState<ProjectStage[]>(() =>
    workingStage ? [workingStage.stage] : [],
  );
  const [stagesShowingDone, setStagesShowingDone] = useState<ProjectStage[]>([]);

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

  const tradieAlerts = useMemo(
    () => selectTradieAlerts(project.tradieSchedules),
    [project.tradieSchedules],
  );

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

  /* ── WebMCP: milestone reads, scoped to this tab ──
     get_milestones used to be a shared manifest tool reading the database
     directly. It is here now because the answer an agent needs is not the raw
     rows: it is the rows plus the two things only this tab knows — which stage
     is currently workable, and which status each milestone may legally move to.
     Without those an agent picks a milestone in a gated stage, gets refused,
     and has no way to work out why. */
  /**
   * Every milestone on the project, flat, each with the stage that governs it.
   *
   * The tools need two lookups the tree does not give directly: is this
   * milestone in the stage that is currently workable, and what may its status
   * become. Building the index once means a tool answers both without walking
   * the tree, and means a bad id is caught before anything is dispatched.
   */
  const milestoneIndex = useMemo(() => {
    const index = new Map<
      string,
      { milestone: UIMilestone; stage: LedgerStage }
    >();

    for (const stage of ledgerStages) {
      for (const milestone of stage.milestones) {
        index.set(milestone.id, { milestone, stage });
        for (const child of milestone.childrenMilestones) {
          index.set(child.id, { milestone: child, stage });
        }
      }
    }

    return index;
  }, [ledgerStages]);

  /**
   * Resolves a milestone id and checks the move is one the UI would offer.
   *
   * Two gates, and they fail for different reasons worth telling apart. The
   * status machine says a DONE milestone cannot start again. The stage gate
   * says a PENDING milestone in a later stage cannot start *yet* — the work in
   * front of it is not finished. An agent told only "rejected" would retry;
   * told which, it can either pick a different milestone or explain the wait.
   */
  // A tagged union rather than an optional `error`: `"error" in resolved`
  // cannot narrow a member that declares the key as optional-undefined, and
  // silently widening every use back to `string | undefined` is exactly the
  // kind of thing that gets cast away.
  type TransitionCheck =
    | { ok: false; error: string }
    | { ok: true; id: string; milestone: UIMilestone };

  const resolveTransition = (
    rawId: unknown,
    to: MilestoneStatus,
    options: { requireWorkableStage?: boolean } = {},
  ): TransitionCheck => {
    const id = typeof rawId === "string" ? rawId.trim() : "";
    if (!id) {
      return { ok: false, error: "milestoneId is required. Call get_milestones to resolve it." };
    }

    const found = milestoneIndex.get(id);
    if (!found) {
      return {
        ok: false,
        error: `No milestone ${id} on this project. Call get_milestones for the current ids.`,
      };
    }

    const { milestone, stage } = found;
    if (!canTransition(milestone.status, to)) {
      return { ok: false, error: transitionRefusal(milestone.name, milestone.status, to) };
    }

    if (options.requireWorkableStage && !stage.isWorkable) {
      const blocker = stage.blockedBy?.label ?? "an earlier stage";
      return {
        ok: false,
        error: `"${milestone.name}" is in the ${stage.label} stage, which cannot be worked until ${blocker} is finished.`,
      };
    }

    return { ok: true, id, milestone };
  };

  useWebMcpTools([
    {
      name: "get_milestones",
      title: "List this project's milestones",
      description:
        "Lists the milestones of the project currently open, grouped by contract stage, with each one's status and the statuses it may move to next. Only one stage is workable at a time \u2014 `isActiveStage` says which \u2014 and a milestone in a later stage cannot be started until that one is finished. This is where the milestoneId the other milestone tools need comes from.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async () => {
        const describe = (milestone: UIMilestone, isActiveStage: boolean) => ({
          id: milestone.id,
          name: milestone.name,
          status: milestone.status,
          projectStage: milestone.projectStage,
          order: milestone.order,
          targetDate: milestone.targetDate
            ? new Date(milestone.targetDate).toISOString()
            : null,
          startDate: milestone.startDate
            ? new Date(milestone.startDate).toISOString()
            : null,
          actualDate: milestone.actualDate
            ? new Date(milestone.actualDate).toISOString()
            : null,
          budget: milestone.budget?.toString() ?? null,
          spend: milestone.spend?.toString() ?? null,
          isActiveStage,
          // A parent is finished by its children, so finish_milestone refuses
          // one that still has unsettled work below it.
          childMilestoneIds: milestone.childrenMilestones.map((child) => child.id),
          canBecome: MILESTONE_TRANSITIONS[milestone.status],
        });

        const stages = ledgerStages.map((stage) => ({
          stage: stage.stage,
          label: stage.label,
          state: stage.state,
          isActiveStage: stage.isWorkable,
          blockedBy: stage.blockedBy?.label ?? null,
          milestones: stage.milestones.flatMap((milestone) => [
            describe(milestone, stage.isWorkable),
            ...milestone.childrenMilestones.map((child) =>
              describe(child, stage.isWorkable),
            ),
          ]),
        }));

        return webMcpJson({
          projectId: project.id,
          activeStage: ledgerStages.find((stage) => stage.isWorkable)?.stage ?? null,
          stages,
        });
      },
    },
    {
      name: "create_milestone",
      title: "Add a milestone",
      description:
        "Adds a milestone to this project. projectStage is required and must be one of the build stages. Pass parentId to nest it under an existing milestone \u2014 a parent is finished by its children, not on its own.",
      inputSchema: milestoneCreateJsonSchema,
      annotations: { readOnlyHint: false },
      execute: async (input) => {
        const parsed = milestoneCreationSchema.safeParse(input);
        if (!parsed.success) {
          return webMcpError(summariseZodIssues(parsed.error));
        }

        const created = await dispatch(
          addProjectMilestone({ projectId: project.id, ...parsed.data }),
        ).unwrap();

        return webMcpJson({
          id: created.id,
          name: created.name,
          status: created.status,
          canBecome: MILESTONE_TRANSITIONS[created.status],
        });
      },
    },
    {
      name: "start_milestone",
      title: "Start a milestone",
      description:
        "Marks a milestone as started, the way the Start button does. Only a PENDING milestone in the stage currently being worked can start; anything else is refused with the reason. Needs the date work actually began.",
      inputSchema: asToolSchema(startMilestoneSchema),
      annotations: { readOnlyHint: false },
      execute: async (input) => {
        const resolved = resolveTransition(input.milestoneId, MilestoneStatus.ACTIVE, {
          requireWorkableStage: true,
        });
        if (!resolved.ok) return webMcpError(resolved.error);

        const parsed = milestoneUpdateSchema.safeParse({
          status: MilestoneStatus.ACTIVE,
          startDate: input.startDate,
        });
        if (!parsed.success) return webMcpError(summariseZodIssues(parsed.error));

        const updated = await dispatch(
          updateProjectMilestoneStatus({
            projectId: project.id,
            milestoneId: resolved.id,
            ...parsed.data,
          }),
        ).unwrap();

        return webMcpJson({ id: updated.id, name: updated.name, status: updated.status });
      },
    },
    {
      name: "finish_milestone",
      title: "Finish a milestone",
      description:
        "Marks an ACTIVE milestone as done, the way the Finish button does. All of startDate, actualDate and spend are required together \u2014 a milestone recorded as complete with no cost against it is worse than one left open \u2014 and actualDate cannot precede startDate. A milestone with child activities is finished by finishing those.",
      inputSchema: asToolSchema(finishMilestoneSchema),
      annotations: { readOnlyHint: false },
      execute: async (input) => {
        const resolved = resolveTransition(input.milestoneId, MilestoneStatus.DONE);
        if (!resolved.ok) return webMcpError(resolved.error);

        const outstanding = resolved.milestone.childrenMilestones.filter(
          (child) => !isSettled(child),
        );
        if (outstanding.length > 0) {
          return webMcpError(
            `"${resolved.milestone.name}" is finished by its child activities. ${outstanding.length} of them are still open: ${outstanding.map((child) => child.name).join(", ")}.`,
          );
        }

        const parsed = milestoneUpdateSchema.safeParse({
          status: MilestoneStatus.DONE,
          startDate: input.startDate,
          actualDate: input.actualDate,
          spend: input.spend,
        });
        if (!parsed.success) return webMcpError(summariseZodIssues(parsed.error));

        const updated = await dispatch(
          updateProjectMilestoneStatus({
            projectId: project.id,
            milestoneId: resolved.id,
            ...parsed.data,
          }),
        ).unwrap();

        return webMcpJson({ id: updated.id, name: updated.name, status: updated.status });
      },
    },
    {
      name: "set_milestone_not_required",
      title: "Mark a milestone as not required",
      description:
        "Marks a PENDING milestone as not required for this build, the way the ban icon does. Reversible \u2014 it can be set back to PENDING from the milestone's own dialog if the scope changes.",
      inputSchema: asToolSchema(milestoneIdOnlySchema),
      annotations: { readOnlyHint: false },
      execute: async (input) => {
        const resolved = resolveTransition(
          input.milestoneId,
          MilestoneStatus.NOT_REQUIRED,
        );
        if (!resolved.ok) return webMcpError(resolved.error);

        const updated = await dispatch(
          updateProjectMilestoneStatus({
            projectId: project.id,
            milestoneId: resolved.id,
            status: MilestoneStatus.NOT_REQUIRED,
          }),
        ).unwrap();

        return webMcpJson({ id: updated.id, name: updated.name, status: updated.status });
      },
    },
    {
      name: "update_milestone_details",
      title: "Change a milestone's due date",
      description:
        "Changes when a milestone is due, without moving its status. Works at any status, including stages that cannot start yet \u2014 those carry auto-spaced placeholder dates nobody chose, so they are the ones that most need correcting.",
      inputSchema: asToolSchema(updateMilestoneDetailsSchema),
      annotations: { readOnlyHint: false },
      execute: async (input) => {
        const id = typeof input.milestoneId === "string" ? input.milestoneId.trim() : "";
        const found = id ? milestoneIndex.get(id) : undefined;
        if (!found) {
          return webMcpError(
            `No milestone ${id || "(none given)"} on this project. Call get_milestones for the current ids.`,
          );
        }

        // milestoneUpdateSchema always wants a status, so the milestone's own
        // is re-sent. Anything else would move the machine as a side effect of
        // editing a date.
        const parsed = milestoneUpdateSchema.safeParse({
          status: found.milestone.status,
          targetDate: input.targetDate,
          ...(found.milestone.startDate
            ? { startDate: format(new Date(found.milestone.startDate), "yyyy-MM-dd") }
            : {}),
          ...(found.milestone.actualDate
            ? { actualDate: format(new Date(found.milestone.actualDate), "yyyy-MM-dd") }
            : {}),
          ...(found.milestone.spend != null ? { spend: Number(found.milestone.spend) } : {}),
        });
        if (!parsed.success) return webMcpError(summariseZodIssues(parsed.error));

        const updated = await dispatch(
          updateProjectMilestoneStatus({
            projectId: project.id,
            milestoneId: found.milestone.id,
            ...parsed.data,
          }),
        ).unwrap();

        return webMcpJson({
          id: updated.id,
          name: updated.name,
          status: updated.status,
          targetDate: input.targetDate,
        });
      },
    },
    {
      name: "add_milestone_photos",
      title: "Attach photos to a milestone",
      description:
        "Opens the photo upload dialog for a milestone, the way the Add photo button does. It uploads nothing: you have no file content, so a person has to choose the photos and confirm. Tell the user the dialog is open and stop \u2014 do not report the photos as attached.",
      inputSchema: asToolSchema(milestoneIdOnlySchema),
      annotations: { readOnlyHint: false },
      execute: async (input) => {
        const id = typeof input.milestoneId === "string" ? input.milestoneId.trim() : "";
        const found = id ? milestoneIndex.get(id) : undefined;
        if (!found) {
          return webMcpError(
            `No milestone ${id || "(none given)"} on this project. Call get_milestones for the current ids.`,
          );
        }

        handleOpenAddUpdateModal(found.milestone.id);

        return webMcpText(
          `Opened the photo dialog for "${found.milestone.name}". The user needs to choose the files and confirm — nothing has been attached yet.`,
        );
      },
    },
  ]);

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

  const handleOpenViewPicture = (
    imageUrls: string[],
    selectedIndex: number,
  ) => {
    dispatch(
      openModal({ type: "viewPicture", payload: { imageUrls, selectedIndex } }),
    );
  };

  const handleStatusUpdate = (milestoneId: string, status?: MilestoneStatus) => {
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
  const contractTotal = useMemo(() => {
    const projectBudget = Number(project.totalBudget);

    const amounts = (Object.keys(PROJECT_STAGE_PERCENTAGE) as ProjectStage[])
      .map((stage) => {
        const contractStage = contractStages[stage];
        const percentage =
          contractStage?.percentage ??
          (PROJECT_STAGE_PERCENTAGE[stage] != null
            ? PROJECT_STAGE_PERCENTAGE[stage] * 100
            : null);

        return stageClaimAmount(
          contractStage?.amount,
          percentage,
          projectBudget,
        );
      })
      .filter((amount): amount is number => amount !== null);

    // No stage resolved an amount — the total is unknown, not zero. Printing
    // $0 as a contract total would be a confident wrong number.
    return amounts.length === 0
      ? null
      : amounts.reduce((total, amount) => total + amount, 0);
  }, [contractStages, project.totalBudget]);
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stage</TableHead>
                    {isAdmin ? (
                      <TableHead className="text-right">Claim</TableHead>
                    ) : null}
                    <TableHead className="hidden sm:table-cell">
                      Progress
                    </TableHead>
                    <TableHead className="hidden sm:table-cell">
                      Status
                    </TableHead>
                    <TableHead className="hidden sm:table-cell">
                      Next up
                    </TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">Activities</span>
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
                          <TableCell>
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
                            <span className="ml-1.5 inline-flex align-middle sm:hidden">
                              <StageStatusPill state={ledgerStage.state} />
                            </span>
                            <span className="mt-1 block text-xs sm:hidden">
                              <NextUp ledgerStage={ledgerStage} />
                            </span>
                          </TableCell>

                          {isAdmin ? (
                            <TableCell className="text-right font-mono tabular-nums">
                              {ledgerStage.claim === null
                                ? "—"
                                : currency.format(ledgerStage.claim)}
                            </TableCell>
                          ) : null}

                          <TableCell className="hidden sm:table-cell">
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

                          <TableCell className="hidden sm:table-cell">
                            <StageStatusPill state={ledgerStage.state} />
                          </TableCell>

                          <TableCell className="hidden max-w-[22rem] text-xs sm:table-cell">
                            <NextUp ledgerStage={ledgerStage} />
                          </TableCell>

                          <TableCell className="text-center">
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
                                  {ledgerStage.isWorkable ||
                                  ledgerStage.state === "complete" ? (
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
                                          Opens when {ledgerStage.blockedBy?.label}{" "}
                                          is complete
                                        </span>
                                        {ledgerStage.blockedBy
                                          ? ` · ${
                                              stageRollup(
                                                ledgerStage.blockedBy.milestones,
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
                                    <Plus className="size-4" aria-hidden="true" />
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
                                        onOpenViewPicture={handleOpenViewPicture}
                                        onMarkasNotRequired={
                                          handleMarkAsNotRequired
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
    </section>
  );
}
