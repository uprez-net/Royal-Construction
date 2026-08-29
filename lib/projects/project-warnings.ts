import { addWeeks, isWithinInterval } from "date-fns";

import type {
    ProjectDetail,
    TradieScheduleWithTradieAndMilestone,
} from "@/types/project";

/**
 * What is wrong with a project, in one place.
 *
 * Three components already answer parts of this question — `project-header.tsx`
 * shows compliance chips, `project-compliance-alert.tsx` repeats them as a
 * banner, `project-tradie-alert.tsx` lists bookings that need attention — and
 * the `get_project_warnings` tool has to give the agent the same answer the
 * user is looking at. A fourth copy of the logic would be a fourth thing to
 * update.
 *
 * Two branches of the same `ProjectDetail`, not one: compliance comes from
 * `requirements.legalAdministration`, bookings from `tradieSchedules`. They are
 * reported as separate sections because they are separate problems with
 * separate fixes.
 */

/** How far ahead a milestone counts as "due soon" for a booking alert. */
const ALERT_HORIZON_WEEKS = 1;

type LegalAdministration = {
    signedDate?: string | null;
    pcaInspector?: string | null;
    hbcfInsuranceNumber?: string | null;
};

const isBlank = (value: string | null | undefined) => !value || value.trim() === "";

/**
 * Compliance gaps only count on a live job. A project that is completed or not
 * yet started has no PCA inspector for the same reason it has no site: there is
 * nothing to inspect, and flagging it would be noise.
 */
const isActiveJob = (status: ProjectDetail["status"]) =>
    status === "ACTIVE" || status === "NEEDS_ATTENTION";

export type ComplianceWarning = {
    field: string;
    message: string;
};

/**
 * The compliance gaps the header and the banner show.
 *
 * Mirrors `project-header.tsx` (the `showPcaWarning` / `showHbcfWarning` pair
 * and the unverified signed date) and `project-compliance-alert.tsx`. Those two
 * still compute their own booleans for rendering; if either gains a check, add
 * it here too or the agent and the screen will disagree.
 */
export function selectComplianceWarnings(project: ProjectDetail): ComplianceWarning[] {
    const legal = ((project.requirements ?? {}) as {
        legalAdministration?: LegalAdministration;
    }).legalAdministration ?? {};

    const warnings: ComplianceWarning[] = [];

    if (isActiveJob(project.status)) {
        if (isBlank(legal.hbcfInsuranceNumber)) {
            warnings.push({
                field: "hbcfInsuranceNumber",
                message: "HBCF insurance number is not set on a live job.",
            });
        }
        if (isBlank(legal.pcaInspector)) {
            warnings.push({
                field: "pcaInspector",
                message: "PCA inspector is not set on a live job.",
            });
        }
    }

    // Unlike the two above, this one holds whatever the status is: a contract
    // date nobody can parse is wrong information, not missing information, and
    // it stays wrong after the job finishes.
    if (legal.signedDate && !isParseableDate(legal.signedDate)) {
        warnings.push({
            field: "signedDate",
            message: `Signed date "${legal.signedDate}" could not be read as a date and shows as unverified.`,
        });
    }

    return warnings;
}

/** Matches what `normalizeDateString` accepts in the header. */
function isParseableDate(value: string): boolean {
    return !Number.isNaN(new Date(value).getTime());
}

/**
 * Bookings that need attention: confirmed, or attached to a milestone due
 * within the week.
 *
 * Extracted from `project-tradie-alert.tsx`, where it was duplicated verbatim
 * in `project-milestones-tab.tsx`. Both now call this.
 */
export function selectTradieAlerts(
    schedules: readonly TradieScheduleWithTradieAndMilestone[],
    now: Date = new Date(),
): TradieScheduleWithTradieAndMilestone[] {
    const horizon = addWeeks(now, ALERT_HORIZON_WEEKS);

    return schedules.filter((schedule) => {
        if (schedule.status === "CONFIRMED") return true;

        const targetDate = schedule.milestone?.targetDate;
        return Boolean(
            targetDate
            && isWithinInterval(new Date(targetDate), { start: now, end: horizon }),
        );
    });
}

export type TradieWarning = {
    scheduleId: string;
    tradie: string;
    trade: string;
    status: string;
    milestone: string;
    scheduledDate: string | null;
    milestoneTargetDate: string | null;
};

/** The same alerts, flattened for a tool result. */
export function describeTradieAlerts(
    schedules: readonly TradieScheduleWithTradieAndMilestone[],
    now: Date = new Date(),
): TradieWarning[] {
    return selectTradieAlerts(schedules, now).map((schedule) => ({
        scheduleId: schedule.id,
        tradie: schedule.tradie.name,
        trade: schedule.tradie.trade,
        status: schedule.status,
        milestone: schedule.milestone?.name ?? "general works",
        scheduledDate: schedule.scheduledDate
            ? new Date(schedule.scheduledDate).toISOString()
            : null,
        milestoneTargetDate: schedule.milestone?.targetDate
            ? new Date(schedule.milestone.targetDate).toISOString()
            : null,
    }));
}
