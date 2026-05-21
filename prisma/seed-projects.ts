import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import {
    MaterialStatus,
    MilestoneStatus,
    Prisma,
    PrismaClient,
    ProjectStatus,
    Role,
    TradieScheduleStatus,
    VariationStatus,
} from "@prisma/client";

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is not set.");
}

const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
});

const decimal = (value: number) => new Prisma.Decimal(value.toFixed(2));
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const addDays = (baseDate: Date, offsetDays: number) => new Date(baseDate.getTime() + offsetDays * 86_400_000);
const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/**
 * Random but deterministic-ish Unsplash image seeding helper.
 *
 * Why:
 * - Avoid fake CDN paths
 * - Make seeded environments visually alive
 * - Different projects/milestones get believable imagery
 * - No need to manually maintain assets
 *
 * Usage:
 * asset(projectSlug, "updates", "frame-progress")
 */

const UNSPLASH_COLLECTIONS = {
    construction: "825494", // construction/building
    interiors: "317099", // interiors/joinery
    architecture: "1065976", // houses/architecture
    tools: "1118905", // tools/tradies
    roofing: "1424340",
    kitchens: "404339",
    bathrooms: "1065392",
    landscaping: "483251",
} as const;

const folderThemes: Record<string, keyof typeof UNSPLASH_COLLECTIONS> = {
    updates: "construction",
    milestones: "construction",
    feasibility: "architecture",
    approvals: "architecture",
    earthworks: "construction",
    slab: "construction",
    frame: "construction",
    roof: "roofing",
    roughin: "tools",
    linings: "interiors",
    fitout: "interiors",
    handover: "architecture",
    renovation: "construction",
    external: "landscaping",
    joinery: "kitchens",
};

const hashString = (value: string) => {
    let hash = 0;

    for (let i = 0; i < value.length; i++) {
        hash = (hash << 5) - hash + value.charCodeAt(i);
        hash |= 0;
    }

    return Math.abs(hash);
};

/**
 * Generates realistic seeded image URLs using Unsplash.
 *
 * Result examples:
 * https://source.unsplash.com/collection/825494/1280x720?sig=18273
 */
export const asset = (
    projectSlug: string,
    folder: string,
    filename: string,
) => {
    const theme =
        folderThemes[folder.toLowerCase()] ?? "construction";

    const collectionId = UNSPLASH_COLLECTIONS[theme];

    const seed = hashString(
        `${projectSlug}-${folder}-${filename}`,
    );

    return `https://source.unsplash.com/collection/${collectionId}/1280x720?sig=${seed}`;
};

type FileAuthor = "admin" | "manager" | "customer";
type FileProfile =
    | "feasibility"
    | "approvals"
    | "earthworks"
    | "slab"
    | "frame"
    | "roof"
    | "roughin"
    | "linings"
    | "fitout"
    | "handover"
    | "renovation"
    | "external"
    | "joinery";

type FileTemplate = {
    filename: string;
    fileType: string;
    filesize: number;
    author: FileAuthor;
};

type MilestoneSeed = {
    name: string;
    order: number;
    description: string;
    targetOffsetDays: number;
    actualOffsetDays?: number;
    status: MilestoneStatus;
    isPhotoRequired?: boolean;
    budget: number;
    spend?: number;
    fileProfile: FileProfile;
};

type UpdateSeed = {
    milestoneOrder?: number;
    author: FileAuthor;
    offsetDays: number;
    notes: string;
    photoUrls: string[];
};

type VariationSeed = {
    description: string;
    cost: number;
    requestedOffsetDays: number;
    approvedOffsetDays?: number;
    delayDays: number;
    status: VariationStatus;
};

type ScheduleSeed = {
    tradieKey: string;
    milestoneOrder?: number;
    offsetDays: number;
    durationDays: number;
    status: TradieScheduleStatus;
};

type MaterialSeed = {
    name: string;
    category: string;
    quantity: number;
    unitCost: number;
    totalCost: number;
    specifications: string;
    status: MaterialStatus;
};

type ProjectSeed = {
    name: string;
    description: string;
    buildingType: string;
    council: string;
    lotSize: number;
    location: string;
    status: ProjectStatus;
    budget: number;
    spent: number;
    startDate: string;
    estimatedEndDate: string;
    customerKey: string;
    managerKey: string;
    requirements: string[];
    milestones: MilestoneSeed[];
    updates: UpdateSeed[];
    variations: VariationSeed[];
    schedules: ScheduleSeed[];
    materials: MaterialSeed[];
};

type TradieSeed = {
    key: string;
    name: string;
    company: string;
    trade: string;
    tradeType: string;
    phone: string;
    email: string;
    hourlyRate: number;
    rating: number;
};

/**
 * Helper to push activity rows
 */
const pushActivity = ({
  projectId,
  userId,
  type,
  message,
  createdAt,
}: {
  projectId: string;
  userId?: string | null;
  type: string;
  message: string;
  createdAt: Date;
}) => {
  activityEntries.push({
    projectId,
    authorId: userId ?? null,
    type,
    message,
    createdAt,
  });
};

const activityEntries: Prisma.ActivityLogCreateManyInput[] = [];

const activityKinds = {
    projectCreated: "project_created",
    milestoneCreated: "milestone_created",
    milestoneStarted: "milestone_started",
    milestoneDelayed: "milestone_delayed",
    milestoneCompleted: "milestone_completed",
    siteUpdatePosted: "site_update_posted",
    variationRequested: "variation_requested",
    variationApproved: "variation_approved",
    variationRejected: "variation_rejected",
    tradieScheduled: "tradie_scheduled",
    tradieConfirmed: "tradie_confirmed",
    tradieDeclined: "tradie_declined",
    tradieNoResponse: "tradie_no_response",
    materialOrdered: "material_ordered",
    materialDelivered: "material_delivered",
    materialInstalled: "material_installed",
    inspectionBooked: "inspection_booked",
    inspectionPassed: "inspection_passed",
    inspectionFailed: "inspection_failed",
    customerWalkthroughCompleted: "customer_walkthrough_completed",
    defectsIssued: "defects_issued",
    defectsResolved: "defects_resolved",
    handoverCompleted: "handover_completed",
} as const;

type ActivityKind = (typeof activityKinds)[keyof typeof activityKinds];

type MilestoneRecord = MilestoneSeed & {
    id: string;
    targetDate: Date;
    actualDate: Date | null;
};

type ActivityGenerationContext = {
    projectId: string;
    projectSlug: string;
    projectName: string;
    projectStatus: ProjectStatus;
    projectStart: Date;
    managerId: string;
    managerName: string;
    customerId: string;
    customerName: string;
    projectSeed: ProjectSeed;
    milestonesByOrder: Map<number, MilestoneRecord>;
    tradiesByKey: Map<string, { id: string; name: string; company: string; tradeType: string }>;
};

const deterministicInt = (seed: string, min: number, max: number) =>
    min + (hashString(seed) % (max - min + 1));

const pickMessage = (seed: string, options: readonly string[]) =>
    options[hashString(seed) % options.length];

const timelineDate = (
    baseDate: Date,
    seed: string,
    options: { before?: number; after?: number; floor?: Date } = {},
) => {
    const backward = options.before ? deterministicInt(`${seed}:before`, 0, options.before) : 0;
    const forward = options.after ? deterministicInt(`${seed}:after`, 0, options.after) : 0;
    let candidate = addDays(baseDate, forward - backward);

    if (candidate > activityCutoff) {
        candidate = addDays(activityCutoff, -(1 + deterministicInt(`${seed}:cutoff`, 0, 4)));
    }

    if (options.floor && candidate < options.floor) {
        candidate = options.floor;
    }

    return candidate;
};

const activityCutoff = day("2026-05-21");

const stageLabelByProfile: Record<FileProfile, string> = {
    feasibility: "feasibility and survey work",
    approvals: "approvals and consultant coordination",
    earthworks: "earthworks and footing works",
    slab: "slab and concrete works",
    frame: "frame and structural works",
    roof: "roofing and weatherproofing",
    roughin: "rough-in services",
    linings: "linings and insulation",
    fitout: "fit-off and finish selections",
    handover: "handover and close-out",
    renovation: "strip-out and demolition",
    external: "civil and external works",
    joinery: "joinery and cabinet manufacture",
};

const inspectionLabelByProfile: Partial<Record<FileProfile, string>> = {
    feasibility: "consultant review",
    approvals: "council response pack",
    earthworks: "compaction check",
    slab: "slab inspection",
    frame: "frame inspection",
    roof: "roofing inspection",
    roughin: "rough-in inspection",
    linings: "lining inspection",
    fitout: "client walkthrough",
    handover: "handover inspection",
    renovation: "demolition clearance",
    external: "civil inspection",
    joinery: "shop-drawing review",
};

const stageDelayReason = (profile: FileProfile, seed: string) => {
    const reasonPools: Record<FileProfile, readonly string[]> = {
        feasibility: [
            "the surveyor wanted one more boundary check before the plans were locked",
            "the consultant set came back with a small redraw request",
            "the owner requested a quick scope review before the next lodgement",
        ],
        approvals: [
            "council came back with a condition that needed a revised response pack",
            "the certifier asked for one more detail on the compliance paperwork",
            "the consultant team had to reissue the stormwater notes",
        ],
        earthworks: [
            "the locator crew needed to clear an extra service line",
            "wet weather softened the cut and pushed the dig window back",
            "the earthworks crew waited on the final compaction sign-off",
        ],
        slab: [
            "the concrete supplier shifted the pour window by a day",
            "reinforcement checks added a short hold before the pour",
            "the pump booking had to be resequenced around another site",
        ],
        frame: [
            "the structural carpenter needed a tie-down adjustment signed off",
            "the truss supplier rechecked the load package before release",
            "the frame crew waited on the corrected steel detail",
        ],
        roof: [
            "the roofing crew was held up by a small sheet-count mismatch",
            "high wind kept the scaffold team off the roof for a day",
            "the supplier moved the flashing pack to the next truck run",
        ],
        roughin: [
            "the plumbing crew had to wait for the roof envelope to close",
            "the electrician's rough-in was pushed while the next trade finished up",
            "the inspection booking slipped behind a supplier delay",
        ],
        linings: [
            "the plasterboard delivery came in after the wet weather window",
            "the insulation batch needed a recheck before installation",
            "the lining crew held off until the rough-in photos were uploaded",
        ],
        fitout: [
            "the joiner was waiting on the final client selection sheet",
            "the cabinet pack could not be released until the revised measurement set was approved",
            "the stone supplier needed a fresh template before fabrication",
        ],
        handover: [
            "the final defects list was still being cleaned up before the certifier return visit",
            "the warranty pack needed one last document before handover",
            "the occupation paperwork was waiting on a final compliance attachment",
        ],
        renovation: [
            "the demolition crew found a small extra cleanup item behind the wall lining",
            "the skip run had to be shifted after the strip-out exposed more waste than expected",
            "the builder held the next trade until the strip-out photos were archived",
        ],
        external: [
            "the retaining crew needed one more drainage detail signed off",
            "the civil package waited on a weather window for the excavation",
            "the driveway formwork was resequenced around the external drainage run",
        ],
        joinery: [
            "the cabinetmaker held back release until the shop drawing was approved",
            "the joinery team waited for the client to lock the finish schedule",
            "the template for the stone top needed a quick remeasure on site",
        ],
    };

    return pickMessage(seed, reasonPools[profile]);
};

const lifecycleMessage = (
    kind: ActivityKind,
    context: ActivityGenerationContext,
    milestone: MilestoneRecord,
    seed: string,
    extra?: string,
) => {
    const stageLabel = stageLabelByProfile[milestone.fileProfile];
    const inspectionLabel = inspectionLabelByProfile[milestone.fileProfile] ?? "inspection";
    const prefix = `${context.projectName} • ${milestone.name}`;

    switch (kind) {
        case activityKinds.projectCreated:
            return pickMessage(seed, [
                `${prefix} opened with scope baseline, budget and program captured by ${context.managerName}.`,
                `${context.projectName} is live in the system with the initial schedule and customer details logged.`,
            ]);
        case activityKinds.milestoneCreated:
            return pickMessage(seed, [
                `${prefix} was added to the baseline program for ${stageLabel}.`,
                `${milestone.name} is now tracked as part of the project program and linked to ${stageLabel}.`,
            ]);
        case activityKinds.milestoneStarted:
            return pickMessage(seed, [
                `${prefix} started on site and the next trade window has been aligned around it.`,
                `${milestone.name} kicked off after the previous package cleared and materials were staged.`,
            ]);
        case activityKinds.milestoneDelayed:
            return pickMessage(seed, [
                `${prefix} slipped after ${extra ?? stageDelayReason(milestone.fileProfile, seed)}.`,
                `${milestone.name} moved out by a day while the team resequenced around ${extra ?? "the site hold-up"}.`,
            ]);
        case activityKinds.milestoneCompleted:
            return pickMessage(seed, [
                `${prefix} is complete and the next package can mobilise once the paperwork is filed.`,
                `${milestone.name} signed off cleanly and ${inspectionLabel} is now in the record set.`,
            ]);
        case activityKinds.siteUpdatePosted:
            return pickMessage(seed, [
                `${context.managerName} posted a site update for ${milestone.name}.`,
                `Progress note captured for ${milestone.name} and shared with the project team.`,
            ]);
        case activityKinds.variationRequested:
            return pickMessage(seed, [
                `Variation requested for ${milestone.name}; ${extra ?? "the scope change is now with the client for review"}.`,
                `A client-led change was raised on ${milestone.name} and pricing is being checked against the revised scope.`,
            ]);
        case activityKinds.variationApproved:
            return pickMessage(seed, [
                `Variation approved for ${milestone.name} after the revised pricing review was accepted.`,
                `The upgraded scope for ${milestone.name} was approved and the program has been adjusted around it.`,
            ]);
        case activityKinds.variationRejected:
            return pickMessage(seed, [
                `Variation for ${milestone.name} was rejected after commercial review.`,
                `The requested change for ${milestone.name} was declined and the base scope remains unchanged.`,
            ]);
        case activityKinds.tradieScheduled:
            return pickMessage(seed, [
                `${extra ?? "Trade"} has been scheduled for ${milestone.name} and the booking has been locked in.`,
                `${extra ?? "The crew"} is booked for ${milestone.name} once the next site window opens.`,
            ]);
        case activityKinds.tradieConfirmed:
            return pickMessage(seed, [
                `${extra ?? "Trade"} confirmed the booking for ${milestone.name} and the crew is ready to mobilise.`,
                `Confirmation received for ${milestone.name}; ${extra ?? "the tradie"} has the job in the diary.`,
            ]);
        case activityKinds.tradieDeclined:
            return pickMessage(seed, [
                `${extra ?? "Trade"} declined the booking for ${milestone.name} so the team is lining up a replacement.`,
                `The original ${extra ?? "trade"} could not take ${milestone.name} and the booking has been reworked.`,
            ]);
        case activityKinds.tradieNoResponse:
            return pickMessage(seed, [
                `${extra ?? "Trade"} has not responded for ${milestone.name} yet, so the site manager is chasing a confirmation.`,
                `Follow-up sent to ${extra ?? "the trade"} for ${milestone.name} after the original booking went unanswered.`,
            ]);
        case activityKinds.materialOrdered:
            return pickMessage(seed, [
                `${extra ?? "Materials"} were ordered for ${milestone.name} to keep the next trade window moving.`,
                `Procurement for ${milestone.name} is locked in and the supplier has the order on the board.`,
            ]);
        case activityKinds.materialDelivered:
            return pickMessage(seed, [
                `${extra ?? "Materials"} landed on site for ${milestone.name} and the crew has staged them under cover.`,
                `Delivery for ${milestone.name} came through cleanly and the docket has been filed.`,
            ]);
        case activityKinds.materialInstalled:
            return pickMessage(seed, [
                `${extra ?? "Materials"} were installed for ${milestone.name} and the follow-on trade can now mobilise.`,
                `Installation for ${milestone.name} is complete and the package has moved into the next phase.`,
            ]);
        case activityKinds.inspectionBooked:
            return pickMessage(seed, [
                `${inspectionLabel} booked for ${milestone.name} once ${stageLabel} reached the hold point.`,
                `Inspection window reserved for ${milestone.name} and the certifier has been notified.`,
            ]);
        case activityKinds.inspectionPassed:
            return pickMessage(seed, [
                `${inspectionLabel} passed for ${milestone.name} and the next trade has been cleared to continue.`,
                `${milestone.name} cleared ${inspectionLabel} with no major comments and the site can keep moving.`,
            ]);
        case activityKinds.inspectionFailed:
            return pickMessage(seed, [
                `${inspectionLabel} failed on a minor detail for ${milestone.name} and the crew is back on site to fix it.`,
                `The certifier raised one issue on ${milestone.name}, so ${inspectionLabel} will need a recheck.`,
            ]);
        case activityKinds.customerWalkthroughCompleted:
            return pickMessage(seed, [
                `Customer walkthrough completed for ${milestone.name} with ${context.customerName} on site.`,
                `${context.customerName} completed a walkthrough for ${milestone.name} and confirmed the selections pack.`,
            ]);
        case activityKinds.defectsIssued:
            return pickMessage(seed, [
                `Defects list issued for ${milestone.name} and the follow-up items have been sent to the crew.`,
                `${milestone.name} now has a short defects list open for close-out before handover.`,
            ]);
        case activityKinds.defectsResolved:
            return pickMessage(seed, [
                `Defects for ${milestone.name} were resolved and the close-out photos were uploaded.`,
                `The outstanding items on ${milestone.name} have been cleared and the record is back to green.`,
            ]);
        case activityKinds.handoverCompleted:
            return pickMessage(seed, [
                `Handover completed for ${milestone.name} and the warranty pack has been issued to ${context.customerName}.`,
                `${milestone.name} reached practical completion and the keys were handed over with the final pack.`,
            ]);
        default:
            return `${context.projectName} activity recorded for ${milestone.name}.`;
    }
};

const generateMilestoneActivities = (context: ActivityGenerationContext) => {
    pushActivity({
        projectId: context.projectId,
        userId: context.managerId,
        type: activityKinds.projectCreated,
        message: lifecycleMessage(activityKinds.projectCreated, context, {
            ...context.projectSeed.milestones[0],
            id: context.projectId,
            targetDate: context.projectStart,
            actualDate: null,
        }, `${context.projectSlug}:project-created`),
        createdAt: context.projectStart,
    });

    for (const milestone of context.projectSeed.milestones) {
        const record = context.milestonesByOrder.get(milestone.order);
        if (!record) {
            continue;
        }

        pushActivity({
            projectId: context.projectId,
            userId: context.managerId,
            type: activityKinds.milestoneCreated,
            message: lifecycleMessage(activityKinds.milestoneCreated, context, record, `${context.projectSlug}:${milestone.order}:milestone-created`),
            createdAt: timelineDate(addDays(context.projectStart, milestone.order * 2), `${context.projectSlug}:${milestone.order}:milestone-created`, {
                after: 1,
                floor: context.projectStart,
            }),
        });

        if (record.status !== MilestoneStatus.PENDING) {
            pushActivity({
                projectId: context.projectId,
                userId: context.managerId,
                type: activityKinds.milestoneStarted,
                message: lifecycleMessage(activityKinds.milestoneStarted, context, record, `${context.projectSlug}:${milestone.order}:milestone-started`),
                createdAt: timelineDate(record.actualDate ?? record.targetDate, `${context.projectSlug}:${milestone.order}:milestone-started`, {
                    before: record.actualDate ? 3 : 2,
                    floor: context.projectStart,
                }),
            });
        }

        if (record.status === MilestoneStatus.ACTIVE && !record.actualDate && record.targetDate <= activityCutoff) {
            pushActivity({
                projectId: context.projectId,
                userId: context.managerId,
                type: activityKinds.milestoneDelayed,
                message: lifecycleMessage(activityKinds.milestoneDelayed, context, record, `${context.projectSlug}:${milestone.order}:milestone-delayed`),
                createdAt: timelineDate(record.targetDate, `${context.projectSlug}:${milestone.order}:milestone-delayed`, {
                    after: 2,
                    floor: context.projectStart,
                }),
            });
        }

        if (record.status === MilestoneStatus.DONE && record.actualDate) {
            pushActivity({
                projectId: context.projectId,
                userId: context.managerId,
                type: activityKinds.milestoneCompleted,
                message: lifecycleMessage(activityKinds.milestoneCompleted, context, record, `${context.projectSlug}:${milestone.order}:milestone-completed`),
                createdAt: timelineDate(record.actualDate, `${context.projectSlug}:${milestone.order}:milestone-completed`, {
                    after: 1,
                    floor: context.projectStart,
                }),
            });
        }

        if (["earthworks", "slab", "frame", "roof", "roughin", "linings", "fitout", "handover", "external", "renovation"].includes(milestone.fileProfile)) {
            pushActivity({
                projectId: context.projectId,
                userId: context.managerId,
                type: activityKinds.inspectionBooked,
                message: lifecycleMessage(activityKinds.inspectionBooked, context, record, `${context.projectSlug}:${milestone.order}:inspection-booked`),
                createdAt: timelineDate(record.actualDate ?? record.targetDate, `${context.projectSlug}:${milestone.order}:inspection-booked`, {
                    before: record.actualDate ? 2 : 7,
                    floor: context.projectStart,
                }),
            });

            if (record.status === MilestoneStatus.DONE && record.actualDate) {
                pushActivity({
                    projectId: context.projectId,
                    userId: context.managerId,
                    type: activityKinds.inspectionPassed,
                    message: lifecycleMessage(activityKinds.inspectionPassed, context, record, `${context.projectSlug}:${milestone.order}:inspection-passed`),
                    createdAt: timelineDate(record.actualDate, `${context.projectSlug}:${milestone.order}:inspection-passed`, {
                        after: 1,
                        floor: context.projectStart,
                    }),
                });
            }

            if (record.status === MilestoneStatus.ACTIVE && !record.actualDate && record.targetDate <= activityCutoff) {
                pushActivity({
                    projectId: context.projectId,
                    userId: context.managerId,
                    type: activityKinds.inspectionFailed,
                    message: lifecycleMessage(activityKinds.inspectionFailed, context, record, `${context.projectSlug}:${milestone.order}:inspection-failed`),
                    createdAt: timelineDate(record.targetDate, `${context.projectSlug}:${milestone.order}:inspection-failed`, {
                        after: 3,
                        floor: context.projectStart,
                    }),
                });
            }
        }

        if (["fitout", "handover"].includes(milestone.fileProfile) && record.status !== MilestoneStatus.PENDING) {
            pushActivity({
                projectId: context.projectId,
                userId: context.customerId,
                type: activityKinds.customerWalkthroughCompleted,
                message: lifecycleMessage(activityKinds.customerWalkthroughCompleted, context, record, `${context.projectSlug}:${milestone.order}:walkthrough`),
                createdAt: timelineDate(record.actualDate ?? record.targetDate, `${context.projectSlug}:${milestone.order}:walkthrough`, {
                    before: record.actualDate ? 2 : 4,
                    floor: context.projectStart,
                }),
            });
        }

        if (context.projectStatus === ProjectStatus.COMPLETED && milestone.order === context.projectSeed.milestones.length && record.actualDate) {
            const defectsIssuedAt = timelineDate(record.actualDate, `${context.projectSlug}:${milestone.order}:defects-issued`, {
                before: 5,
                floor: context.projectStart,
            });

            const defectsResolvedAt = timelineDate(record.actualDate, `${context.projectSlug}:${milestone.order}:defects-resolved`, {
                before: 1,
                floor: defectsIssuedAt,
            });

            pushActivity({
                projectId: context.projectId,
                userId: context.managerId,
                type: activityKinds.defectsIssued,
                message: lifecycleMessage(activityKinds.defectsIssued, context, record, `${context.projectSlug}:${milestone.order}:defects-issued`),
                createdAt: defectsIssuedAt,
            });

            pushActivity({
                projectId: context.projectId,
                userId: context.managerId,
                type: activityKinds.defectsResolved,
                message: lifecycleMessage(activityKinds.defectsResolved, context, record, `${context.projectSlug}:${milestone.order}:defects-resolved`),
                createdAt: defectsResolvedAt,
            });

            pushActivity({
                projectId: context.projectId,
                userId: context.managerId,
                type: activityKinds.handoverCompleted,
                message: lifecycleMessage(activityKinds.handoverCompleted, context, record, `${context.projectSlug}:${milestone.order}:handover-completed`),
                createdAt: timelineDate(record.actualDate, `${context.projectSlug}:${milestone.order}:handover-completed`, {
                    after: 1,
                    floor: defectsResolvedAt,
                }),
            });
        }
    }
};

const generateVariationActivities = (context: ActivityGenerationContext) => {
    for (const variation of context.projectSeed.variations) {
        const seed = `${context.projectSlug}:variation:${variation.description}`;
        const milestone = context.projectSeed.milestones[0];
        const record = context.milestonesByOrder.get(milestone.order);

        if (!record) {
            continue;
        }

        const requestedAt = timelineDate(addDays(context.projectStart, variation.requestedOffsetDays), `${seed}:requested`, {
            before: 1,
            floor: context.projectStart,
        });

        pushActivity({
            projectId: context.projectId,
            userId: context.customerId,
            type: activityKinds.variationRequested,
            message: lifecycleMessage(activityKinds.variationRequested, context, record, seed),
            createdAt: requestedAt,
        });

        if (variation.status === VariationStatus.APPROVED) {
            const approvedAt = timelineDate(addDays(context.projectStart, variation.approvedOffsetDays ?? variation.requestedOffsetDays + 2), `${seed}:approved`, {
                after: 1,
                floor: requestedAt,
            });

            pushActivity({
                projectId: context.projectId,
                userId: context.managerId,
                type: activityKinds.variationApproved,
                message: lifecycleMessage(activityKinds.variationApproved, context, record, seed),
                createdAt: approvedAt,
            });

            if (variation.delayDays > 0) {
                pushActivity({
                    projectId: context.projectId,
                    userId: context.managerId,
                    type: activityKinds.milestoneDelayed,
                    message: lifecycleMessage(
                        activityKinds.milestoneDelayed,
                        context,
                        record,
                        `${seed}:delay`,
                        `the approved variation added ${variation.delayDays} day${variation.delayDays === 1 ? "" : "s"} to the program`,
                    ),
                    createdAt: timelineDate(approvedAt, `${seed}:program-delay`, { after: 1, floor: requestedAt }),
                });
            }
        } else if (variation.status === VariationStatus.REJECTED) {
            pushActivity({
                projectId: context.projectId,
                userId: context.managerId,
                type: activityKinds.variationRejected,
                message: lifecycleMessage(activityKinds.variationRejected, context, record, seed),
                createdAt: timelineDate(addDays(context.projectStart, variation.requestedOffsetDays + 1), `${seed}:rejected`, {
                    after: 1,
                    floor: requestedAt,
                }),
            });
        }
    }
};

const generateMaterialActivities = (context: ActivityGenerationContext) => {
    const anchorProfileFor = (category: string): FileProfile => {
        const normalized = category.toLowerCase();

        if (normalized.includes("concrete") || normalized.includes("reinforcement")) {
            return "slab";
        }

        if (normalized.includes("structural") || normalized.includes("timber") || normalized.includes("steel") || normalized.includes("framing")) {
            return "frame";
        }

        if (normalized.includes("roof")) {
            return "roof";
        }

        if (normalized.includes("electrical") || normalized.includes("plumbing")) {
            return "roughin";
        }

        if (normalized.includes("insulation") || normalized.includes("lining") || normalized.includes("waterproof")) {
            return "linings";
        }

        if (normalized.includes("joinery") || normalized.includes("fixture") || normalized.includes("tile") || normalized.includes("paint")) {
            return "fitout";
        }

        if (normalized.includes("landscap") || normalized.includes("external") || normalized.includes("civil")) {
            return "external";
        }

        return "fitout";
    };

    for (const material of context.projectSeed.materials) {
        if (material.status === MaterialStatus.PENDING) {
            continue;
        }

        const anchorProfile = anchorProfileFor(material.category);
        const milestone = context.projectSeed.milestones.find((item) => item.fileProfile === anchorProfile) ?? context.projectSeed.milestones[0];
        const milestoneRecord = context.milestonesByOrder.get(milestone.order);

        if (!milestoneRecord) {
            continue;
        }

        const orderedAt = timelineDate(milestoneRecord.targetDate, `${context.projectSlug}:material:${material.name}:ordered`, {
            before: 14,
            floor: context.projectStart,
        });

        pushActivity({
            projectId: context.projectId,
            userId: context.managerId,
            type: activityKinds.materialOrdered,
            message: pickMessage(`${context.projectSlug}:${material.name}:ordered`, [
                `${material.name} ordered for ${milestone.name} so the next trade window stays on track.`,
                `${material.name} was locked in with the supplier ahead of ${milestone.name}.`,
            ]),
            createdAt: orderedAt,
        });

        if (material.status === MaterialStatus.DELIVERED || material.status === MaterialStatus.INSTALLED) {
            const deliveredAt = timelineDate(milestoneRecord.actualDate ?? milestoneRecord.targetDate, `${context.projectSlug}:material:${material.name}:delivered`, {
                before: 4,
                floor: orderedAt,
            });

            pushActivity({
                projectId: context.projectId,
                userId: context.managerId,
                type: activityKinds.materialDelivered,
                message: pickMessage(`${context.projectSlug}:${material.name}:delivered`, [
                    `${material.name} landed on site and the docket has been filed against ${milestone.name}.`,
                    `Delivery for ${material.name} came through cleanly and the crew has staged it under cover.`,
                ]),
                createdAt: deliveredAt,
            });

            if (material.status === MaterialStatus.INSTALLED) {
                pushActivity({
                    projectId: context.projectId,
                    userId: context.managerId,
                    type: activityKinds.materialInstalled,
                    message: pickMessage(`${context.projectSlug}:${material.name}:installed`, [
                        `${material.name} has been installed for ${milestone.name} and the follow-on trade can mobilise.`,
                        `Installation of ${material.name} is complete and ${milestone.name} can proceed to the next hold point.`,
                    ]),
                    createdAt: timelineDate(milestoneRecord.actualDate ?? milestoneRecord.targetDate, `${context.projectSlug}:material:${material.name}:installed`, {
                        after: 2,
                        floor: deliveredAt,
                    }),
                });
            }
        }
    }
};

const generateTradieActivities = (context: ActivityGenerationContext) => {
    for (const schedule of context.projectSeed.schedules) {
        const tradie = context.tradiesByKey.get(schedule.tradieKey);
        if (!tradie) {
            continue;
        }

        const milestone = schedule.milestoneOrder ? context.milestonesByOrder.get(schedule.milestoneOrder) : context.milestonesByOrder.get(context.projectSeed.milestones[0].order);
        if (!milestone) {
            continue;
        }

        const bookingDate = timelineDate(addDays(context.projectStart, schedule.offsetDays), `${context.projectSlug}:schedule:${schedule.tradieKey}:booking`, {
            before: 14,
            floor: context.projectStart,
        });

        pushActivity({
            projectId: context.projectId,
            userId: context.managerId,
            type: activityKinds.tradieScheduled,
            message: lifecycleMessage(
                activityKinds.tradieScheduled,
                context,
                milestone,
                `${context.projectSlug}:schedule:${schedule.tradieKey}:scheduled`,
                `${tradie.name} (${tradie.company})`,
            ),
            createdAt: bookingDate,
        });

        if (schedule.status === TradieScheduleStatus.CONFIRMED || schedule.status === TradieScheduleStatus.COMPLETED) {
            pushActivity({
                projectId: context.projectId,
                userId: context.managerId,
                type: activityKinds.tradieConfirmed,
                message: lifecycleMessage(
                    activityKinds.tradieConfirmed,
                    context,
                    milestone,
                    `${context.projectSlug}:schedule:${schedule.tradieKey}:confirmed`,
                    `${tradie.name} (${tradie.tradeType})`,
                ),
                createdAt: timelineDate(addDays(context.projectStart, schedule.offsetDays), `${context.projectSlug}:schedule:${schedule.tradieKey}:confirmed`, {
                    before: 9,
                    floor: bookingDate,
                }),
            });
        }

        if (schedule.status === TradieScheduleStatus.DECLINED) {
            pushActivity({
                projectId: context.projectId,
                userId: context.managerId,
                type: activityKinds.tradieDeclined,
                message: lifecycleMessage(
                    activityKinds.tradieDeclined,
                    context,
                    milestone,
                    `${context.projectSlug}:schedule:${schedule.tradieKey}:declined`,
                    `${tradie.name} (${tradie.tradeType})`,
                ),
                createdAt: timelineDate(addDays(context.projectStart, schedule.offsetDays), `${context.projectSlug}:schedule:${schedule.tradieKey}:declined`, {
                    before: 6,
                    floor: bookingDate,
                }),
            });
        }

        if (schedule.status === TradieScheduleStatus.NO_RESPONSE || schedule.status === TradieScheduleStatus.PENDING_RESPONSE || schedule.status === TradieScheduleStatus.PENDING) {
            pushActivity({
                projectId: context.projectId,
                userId: context.managerId,
                type: activityKinds.tradieNoResponse,
                message: lifecycleMessage(
                    activityKinds.tradieNoResponse,
                    context,
                    milestone,
                    `${context.projectSlug}:schedule:${schedule.tradieKey}:no-response`,
                    `${tradie.name} (${tradie.tradeType})`,
                ),
                createdAt: timelineDate(addDays(context.projectStart, schedule.offsetDays), `${context.projectSlug}:schedule:${schedule.tradieKey}:no-response`, {
                    before: 4,
                    floor: bookingDate,
                }),
            });
        }
    }
};

const generateSiteUpdateActivities = (context: ActivityGenerationContext) => {
    for (const update of context.projectSeed.updates) {
        const milestone = update.milestoneOrder ? context.milestonesByOrder.get(update.milestoneOrder) : undefined;
        if (!milestone) {
            continue;
        }

        pushActivity({
            projectId: context.projectId,
            userId: update.author === "customer" ? context.customerId : context.managerId,
            type: activityKinds.siteUpdatePosted,
            message: update.notes,
            createdAt: timelineDate(addDays(context.projectStart, update.offsetDays), `${context.projectSlug}:site-update:${update.offsetDays}`, {
                after: 0,
                floor: context.projectStart,
            }),
        });
    }
};

const generateProjectActivities = (context: ActivityGenerationContext) => {
    generateMilestoneActivities(context);
    generateVariationActivities(context);
    generateMaterialActivities(context);
    generateTradieActivities(context);
    generateSiteUpdateActivities(context);
};

const fileProfileTemplates: Record<FileProfile, FileTemplate[]> = {
    feasibility: [
        { filename: "site-survey-markup.pdf", fileType: "application/pdf", filesize: 248000, author: "admin" },
        { filename: "concept-plans-review.pdf", fileType: "application/pdf", filesize: 362000, author: "manager" },
        { filename: "budget-allowance-workbook.xlsx", fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filesize: 174000, author: "customer" },
    ],
    approvals: [
        { filename: "da-submission-receipt.pdf", fileType: "application/pdf", filesize: 231000, author: "admin" },
        { filename: "council-conditions-response.pdf", fileType: "application/pdf", filesize: 246000, author: "manager" },
        { filename: "consultant-comments.docx", fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", filesize: 138000, author: "manager" },
    ],
    earthworks: [
        { filename: "excavation-progress-01.jpg", fileType: "image/jpeg", filesize: 4180000, author: "manager" },
        { filename: "soil-compaction-report.pdf", fileType: "application/pdf", filesize: 268000, author: "admin" },
        { filename: "dial-before-you-dig-clearance.pdf", fileType: "application/pdf", filesize: 183000, author: "admin" },
    ],
    slab: [
        { filename: "slab-pour-overview-01.jpg", fileType: "image/jpeg", filesize: 4430000, author: "manager" },
        { filename: "concrete-docket.pdf", fileType: "application/pdf", filesize: 244000, author: "admin" },
        { filename: "reo-inspection-photo.jpg", fileType: "image/jpeg", filesize: 3860000, author: "manager" },
    ],
    frame: [
        { filename: "frame-inspection-01.jpg", fileType: "image/jpeg", filesize: 4070000, author: "manager" },
        { filename: "structural-engineer-note.pdf", fileType: "application/pdf", filesize: 238000, author: "admin" },
        { filename: "stage-claim-invoice.pdf", fileType: "application/pdf", filesize: 302000, author: "admin" },
    ],
    roof: [
        { filename: "roof-sheeting-progress-01.jpg", fileType: "image/jpeg", filesize: 4220000, author: "manager" },
        { filename: "roof-truss-layout.pdf", fileType: "application/pdf", filesize: 279000, author: "admin" },
        { filename: "weather-tightness-checklist.pdf", fileType: "application/pdf", filesize: 191000, author: "manager" },
    ],
    roughin: [
        { filename: "plumbing-rough-in-photo.jpg", fileType: "image/jpeg", filesize: 4010000, author: "manager" },
        { filename: "electrical-rough-in-checklist.pdf", fileType: "application/pdf", filesize: 251000, author: "admin" },
        { filename: "inspection-checklist.xlsx", fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filesize: 164000, author: "manager" },
    ],
    linings: [
        { filename: "plasterboard-delivery-01.jpg", fileType: "image/jpeg", filesize: 3690000, author: "manager" },
        { filename: "insulation-signoff.pdf", fileType: "application/pdf", filesize: 182000, author: "admin" },
        { filename: "fire-rating-certificate.pdf", fileType: "application/pdf", filesize: 203000, author: "admin" },
    ],
    fitout: [
        { filename: "cabinetry-install-01.jpg", fileType: "image/jpeg", filesize: 4250000, author: "manager" },
        { filename: "tile-selection-approval.pdf", fileType: "application/pdf", filesize: 214000, author: "customer" },
        { filename: "joinery-variation-signoff.pdf", fileType: "application/pdf", filesize: 196000, author: "manager" },
    ],
    handover: [
        { filename: "practical-completion-certificate.pdf", fileType: "application/pdf", filesize: 262000, author: "admin" },
        { filename: "defects-list.xlsx", fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filesize: 178000, author: "manager" },
        { filename: "warranty-pack.zip", fileType: "application/zip", filesize: 1180000, author: "admin" },
    ],
    renovation: [
        { filename: "demo-progress-01.jpg", fileType: "image/jpeg", filesize: 4020000, author: "manager" },
        { filename: "asbestos-clearance.pdf", fileType: "application/pdf", filesize: 224000, author: "admin" },
        { filename: "waste-disposal-docket.pdf", fileType: "application/pdf", filesize: 189000, author: "manager" },
    ],
    external: [
        { filename: "retaining-wall-01.jpg", fileType: "image/jpeg", filesize: 4110000, author: "manager" },
        { filename: "stormwater-plan.pdf", fileType: "application/pdf", filesize: 235000, author: "admin" },
        { filename: "engineer-certification.pdf", fileType: "application/pdf", filesize: 208000, author: "admin" },
    ],
    joinery: [
        { filename: "cabinetry-shop-drawing.pdf", fileType: "application/pdf", filesize: 246000, author: "manager" },
        { filename: "bench-top-template.jpg", fileType: "image/jpeg", filesize: 3540000, author: "customer" },
        { filename: "paint-schedule.xlsx", fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filesize: 162000, author: "manager" },
    ],
};

const makeMaterial = (
    name: string,
    category: string,
    quantity: number,
    unitCost: number,
    specifications: string,
    status: MaterialStatus,
): MaterialSeed => ({
    name,
    category,
    quantity,
    unitCost,
    totalCost: unitCost * quantity,
    specifications,
    status,
});

const makeMilestone = (
    name: string,
    order: number,
    description: string,
    targetOffsetDays: number,
    status: MilestoneStatus,
    fileProfile: FileProfile,
    options: { actualOffsetDays?: number; isPhotoRequired?: boolean; budget: number; spend?: number },
): MilestoneSeed => ({
    name,
    order,
    description,
    targetOffsetDays,
    actualOffsetDays: options.actualOffsetDays,
    status,
    isPhotoRequired: options.isPhotoRequired ?? true,
    budget: options.budget,
    spend: options.spend,
    fileProfile,
});

const makeUpdate = (
    milestoneOrder: number | undefined,
    author: FileAuthor,
    offsetDays: number,
    notes: string,
    photoUrls: string[],
): UpdateSeed => ({
    milestoneOrder,
    author,
    offsetDays,
    notes,
    photoUrls,
});

const makeVariation = (
    description: string,
    cost: number,
    requestedOffsetDays: number,
    status: VariationStatus,
    options: { approvedOffsetDays?: number; delayDays: number },
): VariationSeed => ({
    description,
    cost,
    requestedOffsetDays,
    approvedOffsetDays: options.approvedOffsetDays,
    delayDays: options.delayDays,
    status,
});

const makeSchedule = (
    tradieKey: string,
    milestoneOrder: number | undefined,
    offsetDays: number,
    durationDays: number,
    status: TradieScheduleStatus,
): ScheduleSeed => ({
    tradieKey,
    milestoneOrder,
    offsetDays,
    durationDays,
    status,
});

const fileSeedsForMilestone = (
    projectSlug: string,
    milestoneOrder: number,
    profile: FileProfile,
    authorIds: Record<FileAuthor, string>,
) =>
    fileProfileTemplates[profile].map((template) => ({
        filename: template.filename,
        fileType: template.fileType,
        filesize: template.filesize,
        url: asset(projectSlug, `milestones/m-${String(milestoneOrder).padStart(2, "0")}`, template.filename),
        uploadedBy: authorIds[template.author],
    }));

async function main() {
    await prisma.activityLog.deleteMany();
    await prisma.siteUpdate.deleteMany();
    await prisma.variation.deleteMany();
    await prisma.tradieSchedule.deleteMany();
    await prisma.file.deleteMany();
    await prisma.material.deleteMany();
    await prisma.milestone.deleteMany();
    await prisma.project.deleteMany();
    await prisma.tradie.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.user.deleteMany();

    const admin = await prisma.user.create({
        data: {
            name: "Guri Singh",
            email: "guri.singh@buildpro.com.au",
            phone: "+61 400 000 001",
            clerkId: "seed-admin-guri",
            role: Role.ADMIN,
        },
    });

    const siteManagers = await Promise.all(
        [
            { key: "amrit", name: "Amrit Singh", email: "amrit.singh@buildpro.com.au", phone: "+61 400 000 101" },
            { key: "deepak", name: "Deepak Sharma", email: "deepak.sharma@buildpro.com.au", phone: "+61 400 000 102" },
            { key: "gurpreet", name: "Gurpreet Mann", email: "gurpreet.mann@buildpro.com.au", phone: "+61 400 000 103" },
            { key: "jasbir", name: "Jasbir Kaur", email: "jasbir.kaur@buildpro.com.au", phone: "+61 400 000 104" },
            { key: "harjot", name: "Harjot Bassi", email: "harjot.bassi@buildpro.com.au", phone: "+61 400 000 105" },
            { key: "ravinder", name: "Ravinder Pal", email: "ravinder.pal@buildpro.com.au", phone: "+61 400 000 106" },
            { key: "simran", name: "Simran Dhillon", email: "simran.dhillon@buildpro.com.au", phone: "+61 400 000 107" },
        ].map(async (manager) => {
            const user = await prisma.user.create({
                data: {
                    name: manager.name,
                    email: manager.email,
                    phone: manager.phone,
                    clerkId: `seed-site-manager-${manager.key}`,
                    role: Role.SITE_MANAGER,
                },
            });

            return { ...manager, user };
        }),
    );

    const customers = await Promise.all(
        [
            { key: "harpreet", name: "Harpreet Kaur", email: "harpreet.kaur@email.com", phone: "+61 445 678 123" },
            { key: "rajesh", name: "Rajesh Kumar", email: "rajesh.k@email.com", phone: "+61 434 567 890" },
            { key: "sukhwinder", name: "Sukhwinder Singh", email: "sukh.singh@email.com", phone: "+61 412 789 456" },
            { key: "david", name: "David Chen", email: "david.chen@email.com", phone: "+61 434 901 234" },
            { key: "manjit", name: "Manjit Brar", email: "manjit.brar@email.com", phone: "+61 456 234 789" },
            { key: "aisha", name: "Aisha Rahman", email: "aisha.rahman@email.com", phone: "+61 402 555 019" },
            { key: "ben", name: "Benjamin Lowe", email: "ben.lowe@email.com", phone: "+61 403 888 204" },
            { key: "narelle", name: "Narelle O'Connor", email: "narelle.oconnor@email.com", phone: "+61 418 642 751" },
        ].map(async (customerSeed) => {
            const user = await prisma.user.create({
                data: {
                    name: customerSeed.name,
                    email: customerSeed.email,
                    phone: customerSeed.phone,
                    clerkId: `seed-customer-${customerSeed.key}`,
                    role: Role.CUSTOMER,
                },
            });

            const customer = await prisma.customer.create({
                data: {
                    userId: user.id,
                    name: customerSeed.name,
                    email: customerSeed.email,
                    phone: customerSeed.phone,
                },
            });

            await prisma.user.update({
                where: { id: user.id },
                data: { customerId: customer.id },
            });

            return { ...customerSeed, user, customer };
        }),
    );

    const tradieSeeds: TradieSeed[] = [
        { key: "excavation", name: "North Shore Earthworks", company: "North Shore Earthworks Pty Ltd", trade: "Excavator", tradeType: "Excavation", phone: "+61 408 100 201", email: "jobs@northshoreearthworks.com.au", hourlyRate: 165, rating: 4.8 },
        { key: "concreting", name: "Punjab Concreting", company: "Punjab Concreting", trade: "Concreter", tradeType: "Concreting", phone: "+61 408 100 202", email: "bookings@punjabconcreting.com.au", hourlyRate: 125, rating: 4.8 },
        { key: "carpentry", name: "Tims Framing Co", company: "Tims Framing Co", trade: "Carpenter", tradeType: "Carpentry", phone: "+61 408 100 203", email: "jobs@timsframingco.com.au", hourlyRate: 118, rating: 4.9 },
        { key: "roofing", name: "Apex Roofing NSW", company: "Apex Roofing NSW", trade: "Roofer", tradeType: "Roofing", phone: "+61 408 100 204", email: "quote@apexroofing.com.au", hourlyRate: 135, rating: 4.6 },
        { key: "plumbing", name: "Flow Right Plumbing", company: "Flow Right Plumbing Pty Ltd", trade: "Plumber", tradeType: "Plumbing", phone: "+61 408 100 205", email: "bookings@flowrightplumbing.com.au", hourlyRate: 128, rating: 4.8 },
        { key: "electrical", name: "NSW Spark Solutions", company: "NSW Spark Solutions", trade: "Electrician", tradeType: "Electrical", phone: "+61 408 100 206", email: "dispatch@nswspark.com.au", hourlyRate: 142, rating: 4.7 },
        { key: "plastering", name: "Smoothline Interiors", company: "Smoothline Interiors Pty Ltd", trade: "Plasterer", tradeType: "Plastering", phone: "+61 408 100 207", email: "service@smoothlineinteriors.com.au", hourlyRate: 112, rating: 4.7 },
        { key: "waterproofing", name: "SealGuard Waterproofing", company: "SealGuard Waterproofing", trade: "Waterproofer", tradeType: "Waterproofing", phone: "+61 408 100 208", email: "projects@sealguard.com.au", hourlyRate: 122, rating: 4.9 },
        { key: "tiling", name: "Precision Tiling", company: "Precision Tiling", trade: "Tiler", tradeType: "Tiling", phone: "+61 408 100 209", email: "team@precisiontiling.com.au", hourlyRate: 110, rating: 4.6 },
        { key: "cabinetry", name: "Harbour Joinery", company: "Harbour Joinery and Cabinetry", trade: "Cabinetmaker", tradeType: "Cabinetry", phone: "+61 408 100 210", email: "orders@harbourjoinery.com.au", hourlyRate: 138, rating: 4.8 },
        { key: "painting", name: "Coastline Painting", company: "Coastline Painting Group", trade: "Painter", tradeType: "Painting", phone: "+61 408 100 211", email: "jobs@coastlinepainting.com.au", hourlyRate: 98, rating: 4.5 },
        { key: "landscaping", name: "Greenline Landscapes", company: "Greenline Landscapes", trade: "Landscaper", tradeType: "Landscaping", phone: "+61 408 100 212", email: "hello@greenlinelandscapes.com.au", hourlyRate: 108, rating: 4.7 },
        { key: "glazing", name: "Clearview Glazing", company: "Clearview Glazing NSW", trade: "Glazier", tradeType: "Glazing", phone: "+61 408 100 213", email: "quotes@clearviewglazing.com.au", hourlyRate: 132, rating: 4.8 },
    ];

    const tradies = await Promise.all(
        tradieSeeds.map((tradieSeed) =>
            prisma.tradie.create({
                data: {
                    name: tradieSeed.name,
                    company: tradieSeed.company,
                    trade: tradieSeed.trade,
                    tradeType: tradieSeed.tradeType,
                    phone: tradieSeed.phone,
                    email: tradieSeed.email,
                    hourlyRate: decimal(tradieSeed.hourlyRate),
                    rating: decimal(tradieSeed.rating),
                },
            }),
        ),
    );

    const tradieMap = new Map(
        tradieSeeds.map((tradieSeed, index) => [
            tradieSeed.key,
            {
                id: tradies[index].id,
                name: tradieSeed.name,
                company: tradieSeed.company,
                tradeType: tradieSeed.tradeType,
            },
        ]),
    );

    const projectSeeds: ProjectSeed[] = [
        {
            name: "Penrith Residence",
            description: "Double storey family home with delayed roof works after a supply-side truss change and a tight joinery schedule.",
            buildingType: "Double Storey 4BR + Study",
            council: "Penrith City Council",
            lotSize: 452,
            location: "42 Railway St, Penrith NSW 2750",
            status: ProjectStatus.ACTIVE,
            budget: 560000,
            spent: 372800,
            startDate: "2025-10-14",
            estimatedEndDate: "2026-09-18",
            customerKey: "harpreet",
            managerKey: "amrit",
            requirements: [
                "4 bedrooms with built-in robes",
                "2 bathrooms and 1 ensuite",
                "Open-plan kitchen and living",
                "Double garage with internal access",
                "Covered alfresco with ceiling fans",
                "900mm induction cooktop and wall oven",
            ],
            milestones: [
                makeMilestone("Site establishment and survey setout", 1, "Setout completed and erosion controls installed before excavation crews moved in.", 0, MilestoneStatus.DONE, "feasibility", { actualOffsetDays: 1, budget: 18000, spend: 18000 }),
                makeMilestone("Excavation and footings", 2, "Bulk excavation and pier prep were completed after a short hold for service locating.", 22, MilestoneStatus.DONE, "earthworks", { actualOffsetDays: 25, budget: 41000, spend: 41000 }),
                makeMilestone("Slab pour and cure", 3, "Slab pour was signed off with the concrete finish left clean enough for follow-on trades.", 55, MilestoneStatus.DONE, "slab", { actualOffsetDays: 57, budget: 64000, spend: 63500 }),
                makeMilestone("Frame erection", 4, "Structural frame is complete and the certifier has cleared the roof package to proceed.", 110, MilestoneStatus.DONE, "frame", { actualOffsetDays: 114, budget: 93000, spend: 92000 }),
                makeMilestone("Roof installation", 5, "Roof trusses are booked and the roofing crew is waiting on a corrected sheet count.", 157, MilestoneStatus.ACTIVE, "roof", { budget: 72000, spend: 26400 }),
                makeMilestone("Rough-in services", 6, "Plumbing and electrical rough-in will follow once the roof is watertight and inspected.", 204, MilestoneStatus.PENDING, "roughin", { budget: 58000, spend: 0 }),
                makeMilestone("Linings and insulation", 7, "Insulation and plasterboard are scheduled after the rough-in sign-off window closes.", 246, MilestoneStatus.PENDING, "linings", { budget: 46000, spend: 0 }),
                makeMilestone("Kitchen fit-off and practical completion", 8, "Kitchen joinery and final fixtures will land after the measured-check approval is released.", 288, MilestoneStatus.PENDING, "fitout", { budget: 58000, spend: 0 }),
            ],
            updates: [
                makeUpdate(2, "manager", 27, "Excavation wrapped without drainage surprises. The only hold-up was a short wait for the service locator to clear the front boundary.", [asset("penrith-residence", "updates", "2025-11-10-excavation-progress-01.jpg")]),
                makeUpdate(3, "manager", 58, "Slab pour finished in a clean window and the curing covers stayed down through the weekend heat.", [asset("penrith-residence", "updates", "2025-12-11-slab-pour-01.jpg")]),
                makeUpdate(4, "manager", 116, "Frame inspection passed with one minor brace adjustment. The roof carpenter is booked once the truss pack is released.", [asset("penrith-residence", "updates", "2026-02-06-frame-inspection-01.jpg")]),
                makeUpdate(5, "manager", 158, "Roof trusses are staged on site and the material count is being reconciled before installation starts.", [asset("penrith-residence", "updates", "2026-03-20-roof-trusses-staged-01.jpg")]),
                makeUpdate(5, "customer", 170, "Client walkthrough completed for the kitchen selections. The island profile and splashback finish are now locked in.", [asset("penrith-residence", "updates", "2026-04-01-kitchen-selection-walkthrough-01.jpg")]),
            ],
            variations: [
                makeVariation("Kitchen island upgraded to a waterfall edge with extra drawer storage and a stone feature panel.", 5200, 167, VariationStatus.APPROVED, { approvedOffsetDays: 171, delayDays: 2 }),
                makeVariation("Add integrated data cabling to the study and a concealed charging drawer in the pantry.", 3850, 181, VariationStatus.PENDING, { delayDays: 1 }),
            ],
            schedules: [
                makeSchedule("roofing", 5, 160, 3, TradieScheduleStatus.CONFIRMED),
                makeSchedule("plumbing", 6, 208, 2, TradieScheduleStatus.PENDING_RESPONSE),
                makeSchedule("electrical", 6, 210, 2, TradieScheduleStatus.PENDING),
                makeSchedule("cabinetry", 8, 286, 4, TradieScheduleStatus.NO_RESPONSE),
            ],
            materials: [
                makeMaterial("32MPa Concrete", "Concrete", 48, 245, "Footings and slab pour allowance", MaterialStatus.DELIVERED),
                makeMaterial("SL82 Mesh", "Reinforcement", 30, 168, "Slab reinforcement and lap joints", MaterialStatus.DELIVERED),
                makeMaterial("LVL Beams", "Structural Timber", 22, 185, "Roof bearer and load-bearing lintel pack", MaterialStatus.DELIVERED),
                makeMaterial("Colorbond Roof Sheets", "Roofing", 96, 82, "Basalt finish with matching flashing", MaterialStatus.ORDERED),
                makeMaterial("R2.5 Insulation Batts", "Insulation", 240, 18, "External wall and ceiling batts", MaterialStatus.ORDERED),
                makeMaterial("Plasterboard Sheets", "Linings", 280, 29, "Standard and wet-area board mix", MaterialStatus.ORDERED),
                makeMaterial("Kitchen Cabinetry Package", "Joinery", 1, 46500, "Polyurethane fronts with soft-close hardware", MaterialStatus.PENDING),
                makeMaterial("Tapware and Fixtures", "Fixtures", 1, 18900, "Caroma and ABI mix for all wet areas", MaterialStatus.PENDING),
                makeMaterial("Electrical Rough-in Kit", "Electrical", 1, 14200, "Cabling, breakers and data rough-in supplies", MaterialStatus.ORDERED),
                makeMaterial("Plumbing Fittings and Drainage", "Plumbing", 1, 12500, "Copper, PVC and stormwater allowance", MaterialStatus.ORDERED),
            ],
        },
        {
            name: "Castle Hill Dual Occupancy",
            description: "Two high-spec homes on one title with council conditions still being worked through by consultants and the site manager.",
            buildingType: "Dual Occupancy | 2 x 4BR Homes",
            council: "The Hills Shire Council",
            lotSize: 612,
            location: "11 Old Northern Rd, Castle Hill NSW 2154",
            status: ProjectStatus.ON_TRACK,
            budget: 920000,
            spent: 588200,
            startDate: "2025-08-26",
            estimatedEndDate: "2026-11-24",
            customerKey: "rajesh",
            managerKey: "deepak",
            requirements: [
                "2 x 4 bedroom homes",
                "Separate garages and driveway access",
                "Premium facade package",
                "Stone kitchens with butler pantries",
                "Acoustic insulation between dwellings",
                "Shared stormwater and civil compliance package",
            ],
            milestones: [
                makeMilestone("Feasibility and consultant coordination", 1, "Architect, hydraulic and structural consultants have aligned the baseline design package.", 0, MilestoneStatus.DONE, "feasibility", { actualOffsetDays: 3, budget: 25000, spend: 25000 }),
                makeMilestone("DA submission and conditions review", 2, "Council conditions are in hand and the response pack has been filed.", 30, MilestoneStatus.DONE, "approvals", { actualOffsetDays: 34, budget: 42000, spend: 42000 }),
                makeMilestone("Excavation and retaining package", 3, "Bulk excavation is complete and the retaining wall contractor has tied into the civil drawings.", 72, MilestoneStatus.DONE, "earthworks", { actualOffsetDays: 75, budget: 82000, spend: 82000 }),
                makeMilestone("Slab pour", 4, "The slab pour passed inspection with the pier layout adjusted for the amended setback line.", 118, MilestoneStatus.DONE, "slab", { actualOffsetDays: 121, budget: 118000, spend: 116500 }),
                makeMilestone("Frame erection", 5, "Frame is complete and both dwellings are tracking to roof stage without material shortages.", 168, MilestoneStatus.DONE, "frame", { actualOffsetDays: 171, budget: 136000, spend: 135000 }),
                makeMilestone("Roof and cladding", 6, "Roofing is underway and cladding procurement was locked after a short lead-time review.", 214, MilestoneStatus.ACTIVE, "roof", { budget: 104000, spend: 40500 }),
                makeMilestone("Rough-in services", 7, "Plumbing and electrical rough-in are ready to book once the roof envelope is sealed.", 260, MilestoneStatus.PENDING, "roughin", { budget: 93000, spend: 0 }),
                makeMilestone("Cabinetry and fit-off", 8, "Joinery take-offs are being checked against the latest appliance schedule before manufacturing starts.", 304, MilestoneStatus.PENDING, "fitout", { budget: 90000, spend: 0 }),
            ],
            updates: [
                makeUpdate(2, "manager", 33, "DA conditions were cleared after a coordinated response from the engineer and stormwater consultant. No rework required on the envelope.", [asset("castle-hill-dual-occupancy", "updates", "2025-09-28-da-response-pack-01.jpg")]),
                makeUpdate(3, "manager", 79, "Retaining wall footings are in and the excavation crew has retained the finished levels without any overcut issues.", [asset("castle-hill-dual-occupancy", "updates", "2025-12-12-retaining-wall-footings-01.jpg")]),
                makeUpdate(4, "manager", 123, "Slab pour came through cleanly. The concrete supplier matched the agreed pour window and the finish is ready for frame lock-up.", [asset("castle-hill-dual-occupancy", "updates", "2026-02-24-slab-pour-01.jpg")]),
                makeUpdate(6, "manager", 214, "Roofing is active and the cladding order has been shortened after the builder confirmed the final window dimensions.", [asset("castle-hill-dual-occupancy", "updates", "2026-05-31-roof-and-cladding-01.jpg")]),
                makeUpdate(6, "customer", 221, "Client walkthrough focused on wet-area tile selections and the alfresco finishes. Selections are now locked for manufacture.", [asset("castle-hill-dual-occupancy", "updates", "2026-06-07-client-selection-walkthrough-01.jpg")]),
            ],
            variations: [
                makeVariation("Upgrade both kitchens to stone waterfall edges with under-cabinet LED lighting.", 14200, 218, VariationStatus.APPROVED, { approvedOffsetDays: 223, delayDays: 2 }),
                makeVariation("Add acoustic wall insulation between the dwellings and upgrade to a higher fire-rating plasterboard system.", 11750, 229, VariationStatus.PENDING, { delayDays: 3 }),
            ],
            schedules: [
                makeSchedule("waterproofing", 7, 248, 2, TradieScheduleStatus.CONFIRMED),
                makeSchedule("plumbing", 7, 252, 3, TradieScheduleStatus.PENDING_RESPONSE),
                makeSchedule("electrical", 7, 255, 3, TradieScheduleStatus.PENDING),
                makeSchedule("cabinetry", 8, 302, 5, TradieScheduleStatus.NO_RESPONSE),
            ],
            materials: [
                makeMaterial("40MPa Concrete", "Concrete", 58, 258, "Dual slab pour allowance", MaterialStatus.DELIVERED),
                makeMaterial("N16 Reinforcement", "Reinforcement", 42, 34, "Footings, beams and starter bars", MaterialStatus.DELIVERED),
                makeMaterial("Hebel Wall Panels", "Wall System", 180, 94, "Party wall and external envelope", MaterialStatus.ORDERED),
                makeMaterial("LVL Beam Pack", "Structural Timber", 28, 178, "Floor and roof load transfer package", MaterialStatus.DELIVERED),
                makeMaterial("Colorbond Roofing", "Roofing", 126, 88, "Basalt finish with matching guttering", MaterialStatus.ORDERED),
                makeMaterial("Acoustic Insulation Batts", "Insulation", 320, 22, "Between-dwelling acoustic package", MaterialStatus.ORDERED),
                makeMaterial("Window and Glazing Allowance", "Glazing", 1, 36400, "Double glazed frames and sliding doors", MaterialStatus.ORDERED),
                makeMaterial("Kitchen Cabinetry", "Joinery", 2, 58500, "Two separate kitchen fit-outs", MaterialStatus.PENDING),
                makeMaterial("Bathroom Fixtures", "Fixtures", 2, 14500, "Caroma and Phoenix mix", MaterialStatus.PENDING),
                makeMaterial("Electrical Rough-in Kit", "Electrical", 2, 18600, "Sub-boards, cabling and data allowance", MaterialStatus.ORDERED),
            ],
        },
        {
            name: "Blacktown Duplex",
            description: "Two-unit duplex with frame rectification work and a couple of trade sequencing issues after wet weather interrupted the roof program.",
            buildingType: "Duplex | 2 x 3BR Units",
            council: "Blacktown City Council",
            lotSize: 398,
            location: "18 Kildare Rd, Blacktown NSW 2148",
            status: ProjectStatus.NEEDS_ATTENTION,
            budget: 860000,
            spent: 546700,
            startDate: "2025-11-04",
            estimatedEndDate: "2026-12-15",
            customerKey: "sukhwinder",
            managerKey: "gurpreet",
            requirements: [
                "2 x 3 bedroom units",
                "Separate services and metering",
                "Matching street-facing facade",
                "Practical family layouts",
                "Fire separation and acoustic package",
            ],
            milestones: [
                makeMilestone("Demolition and asbestos clearance", 1, "The existing slab was cleared and the clearance certificate has been archived for council records.", 0, MilestoneStatus.DONE, "renovation", { actualOffsetDays: 4, budget: 28000, spend: 28000 }),
                makeMilestone("Earthworks and retaining walls", 2, "Site cut and retention are complete, with the engineer asking for one additional compaction photo set.", 25, MilestoneStatus.DONE, "earthworks", { actualOffsetDays: 29, budget: 71000, spend: 71000 }),
                makeMilestone("Slab pour", 3, "The slab pour passed with a small pump delay but no structural impact.", 66, MilestoneStatus.DONE, "slab", { actualOffsetDays: 69, budget: 108000, spend: 106000 }),
                makeMilestone("Frame erection", 4, "Frame is up, but a wall tie adjustment and a fire separation detail still need sign-off.", 117, MilestoneStatus.ACTIVE, "frame", { budget: 129000, spend: 56400 }),
                makeMilestone("Roof wrap and cladding", 5, "Roofing is booked once the wind-rated sheet pack arrives and the cladding variation is approved.", 170, MilestoneStatus.PENDING, "roof", { budget: 105000, spend: 0 }),
                makeMilestone("Rough-in services", 6, "Plumbing and electrical rough-in are queued behind the roof wrap and fire-separation fixes.", 212, MilestoneStatus.PENDING, "roughin", { budget: 98000, spend: 0 }),
                makeMilestone("Waterproofing and acoustic compliance", 7, "Wet-area membrane and acoustic checks will follow the amended inspection sign-off.", 254, MilestoneStatus.PENDING, "linings", { budget: 90000, spend: 0 }),
                makeMilestone("Final inspections and occupancy", 8, "Final inspection and compliance paperwork are pending once rectification items are closed out.", 308, MilestoneStatus.PENDING, "handover", { budget: 98000, spend: 0 }),
            ],
            updates: [
                makeUpdate(3, "manager", 71, "Slab pour completed but the wet weather pushed the curing window out by two days. No effect on the structural schedule.", [asset("blacktown-duplex", "updates", "2026-01-18-slab-weather-delay-01.jpg")]),
                makeUpdate(4, "manager", 124, "Frame inspection identified a small tie-down adjustment and the fire separation fix is being coordinated with the carpenter.", [asset("blacktown-duplex", "updates", "2026-03-14-frame-rectification-01.jpg")]),
                makeUpdate(4, "manager", 131, "Roof crew could not land the original booking because of a supplier hold on the wind-rated sheet profile.", [asset("blacktown-duplex", "updates", "2026-03-21-roof-supply-delay-01.jpg")]),
                makeUpdate(4, "customer", 140, "Client walkthrough was kept short and practical. They signed off on the facade colour decision but want the side gate hinge changed.", [asset("blacktown-duplex", "updates", "2026-03-30-client-walkthrough-01.jpg")]),
                makeUpdate(4, "manager", 149, "Fire separation details are now back with the certifier. The roof booking will be reissued once that markup is cleared.", [asset("blacktown-duplex", "updates", "2026-04-08-certifier-markup-01.jpg")]),
            ],
            variations: [
                makeVariation("Upgrade the separating wall system to a higher fire-rating package after the certifier requested an amended detail.", 9400, 133, VariationStatus.APPROVED, { approvedOffsetDays: 138, delayDays: 3 }),
                makeVariation("Switch the facade cladding to a premium fibre-cement profile for the street elevation.", 15200, 144, VariationStatus.PENDING, { delayDays: 4 }),
                makeVariation("Add imported timber slats to the entry screen and garage pier detail.", 6800, 152, VariationStatus.REJECTED, { delayDays: 0 }),
            ],
            schedules: [
                makeSchedule("carpentry", 4, 156, 3, TradieScheduleStatus.DECLINED),
                makeSchedule("roofing", 5, 168, 3, TradieScheduleStatus.PENDING_RESPONSE),
                makeSchedule("electrical", 6, 216, 2, TradieScheduleStatus.PENDING),
                makeSchedule("plumbing", 6, 219, 2, TradieScheduleStatus.NO_RESPONSE),
            ],
            materials: [
                makeMaterial("Site Hoarding and Fencing", "Site Setup", 1, 8200, "Temporary safety fence and access control", MaterialStatus.INSTALLED),
                makeMaterial("40MPa Concrete", "Concrete", 54, 252, "Slab and footing pours", MaterialStatus.DELIVERED),
                makeMaterial("N12 and N16 Rebar", "Reinforcement", 52, 38, "Footings and edge beams", MaterialStatus.DELIVERED),
                makeMaterial("Timber Framing Pack", "Structural Timber", 1, 82500, "Wall frames, roof trusses and lintels", MaterialStatus.ORDERED),
                makeMaterial("Colorbond Roofing", "Roofing", 118, 84, "Roof and flashings", MaterialStatus.ORDERED),
                makeMaterial("Fire-rated Plasterboard", "Linings", 260, 41, "Between-dwelling wall and wet area board", MaterialStatus.ORDERED),
                makeMaterial("Waterproofing Membrane", "Waterproofing", 18, 520, "Wet area and balcony membrane allowance", MaterialStatus.ORDERED),
                makeMaterial("Electrical Rough-in Kit", "Electrical", 2, 16400, "Metering, cabling and board allowance", MaterialStatus.ORDERED),
                makeMaterial("Plumbing Rough-in Kit", "Plumbing", 2, 14900, "Stormwater, waste and service fittings", MaterialStatus.ORDERED),
                makeMaterial("Facade Cladding", "External Finishes", 1, 34000, "Street-facing fibre-cement and trims", MaterialStatus.PENDING),
            ],
        },
        {
            name: "Parramatta Renovation",
            description: "Whole-home renovation with a slow-running waterproofing sequence and a couple of joinery revisions still being priced.",
            buildingType: "Whole-Home Renovation",
            council: "Cumberland City Council",
            lotSize: 310,
            location: "76 Church St, Parramatta NSW 2150",
            status: ProjectStatus.DELAYED,
            budget: 440000,
            spent: 305900,
            startDate: "2025-12-09",
            estimatedEndDate: "2026-08-29",
            customerKey: "david",
            managerKey: "amrit",
            requirements: [
                "Full kitchen reconfiguration",
                "New master ensuite and laundry",
                "Structural opening changes",
                "Internal paint and flooring refresh",
                "Waterproofing and tiling updates",
            ],
            milestones: [
                makeMilestone("Demolition and strip-out", 1, "Strip-out completed and the waste run was signed off by the skip contractor.", 0, MilestoneStatus.DONE, "renovation", { actualOffsetDays: 3, budget: 24000, spend: 24000 }),
                makeMilestone("Structural steel and openings", 2, "Structural openings were cut and the steel has been packed and inspected.", 18, MilestoneStatus.DONE, "frame", { actualOffsetDays: 22, budget: 52000, spend: 51500 }),
                makeMilestone("Rough-in services", 3, "Plumbing and electrical rough-in are complete but the bath layout change pushed the schedule back.", 58, MilestoneStatus.DONE, "roughin", { actualOffsetDays: 63, budget: 68000, spend: 67000 }),
                makeMilestone("Waterproofing and tiling", 4, "Waterproofing is active and the tiler is waiting on a last-minute shower hob detail.", 100, MilestoneStatus.ACTIVE, "linings", { budget: 62000, spend: 24000 }),
                makeMilestone("Cabinetry and joinery", 5, "The joiner is locked in, although the pantry configuration is still being costed against the revised kitchen plan.", 138, MilestoneStatus.PENDING, "joinery", { budget: 58000, spend: 0 }),
                makeMilestone("Painting and fit-off", 6, "Painter booking is held until the waterproofing inspection closes and the floors are protected.", 180, MilestoneStatus.PENDING, "fitout", { budget: 42000, spend: 0 }),
                makeMilestone("Practical completion", 7, "Final defects and certification will be done once the delayed joinery and shower screen pieces arrive.", 220, MilestoneStatus.PENDING, "handover", { budget: 36000, spend: 0 }),
            ],
            updates: [
                makeUpdate(3, "manager", 64, "The rough-in crew reported a supply delay on a specialty mixer, so the tiling sequence has been nudged back by a few days.", [asset("parramatta-renovation", "updates", "2026-02-11-supplier-delay-01.jpg")]),
                makeUpdate(4, "manager", 103, "Waterproofing is in progress and the membrane detail around the bath opening needed a minor redraw before sign-off.", [asset("parramatta-renovation", "updates", "2026-03-22-waterproofing-check-01.jpg")]),
                makeUpdate(4, "customer", 111, "Client walkthrough completed on site. The owners approved the revised laundry joinery but asked for one extra pantry shelf.", [asset("parramatta-renovation", "updates", "2026-03-30-client-walkthrough-01.jpg")]),
                makeUpdate(4, "manager", 124, "The tiler has been held back by a weather delay at another job, so the wet area finish is now tracking one week later than planned.", [asset("parramatta-renovation", "updates", "2026-04-12-weather-delay-01.jpg")]),
                makeUpdate(4, "manager", 140, "A defect rectification list was issued after the waterproofing inspection. It is minor, but it has pushed the schedule into the next month.", [asset("parramatta-renovation", "updates", "2026-04-28-defects-rectification-01.jpg")]),
            ],
            variations: [
                makeVariation("Add acoustic insulation to the bathroom wall set and upgrade the shower niche detailing.", 7900, 112, VariationStatus.APPROVED, { approvedOffsetDays: 116, delayDays: 2 }),
                makeVariation("Rework the kitchen island to include a concealed bin system and a larger stone overhang.", 10800, 126, VariationStatus.PENDING, { delayDays: 3 }),
                makeVariation("Import a bespoke rangehood panel in natural oak instead of the standard laminate option.", 5600, 130, VariationStatus.REJECTED, { delayDays: 0 }),
            ],
            schedules: [
                makeSchedule("waterproofing", 4, 153, 2, TradieScheduleStatus.CONFIRMED),
                makeSchedule("tiling", 4, 160, 3, TradieScheduleStatus.PENDING_RESPONSE),
                makeSchedule("cabinetry", 5, 186, 4, TradieScheduleStatus.PENDING),
                makeSchedule("painting", 6, 203, 4, TradieScheduleStatus.NO_RESPONSE),
            ],
            materials: [
                makeMaterial("Structural Steel Pack", "Structural", 1, 49500, "Beam and post package for new openings", MaterialStatus.INSTALLED),
                makeMaterial("Plumbing Fittings", "Plumbing", 1, 15400, "Rough-in and fit-off allowance", MaterialStatus.DELIVERED),
                makeMaterial("Electrical Cable and Board Kit", "Electrical", 1, 13800, "Rewire and upgrade allowance", MaterialStatus.DELIVERED),
                makeMaterial("Waterproofing Membrane", "Waterproofing", 22, 410, "Wet area membrane system", MaterialStatus.ORDERED),
                makeMaterial("Tiles", "Tiling", 86, 74, "Bathroom and laundry tile package", MaterialStatus.ORDERED),
                makeMaterial("Kitchen Cabinetry", "Joinery", 1, 34500, "Custom kitchen and pantry pack", MaterialStatus.PENDING),
                makeMaterial("Bathroom Fixtures", "Fixtures", 1, 17800, "Vanity, tapware and shower fittings", MaterialStatus.PENDING),
                makeMaterial("Paint and Surface Prep", "Painting", 1, 12900, "Primer, finish coats and fillers", MaterialStatus.PENDING),
                makeMaterial("Flooring Underlay and Boards", "Flooring", 1, 18900, "Hybrid floor re-lay across living areas", MaterialStatus.ORDERED),
            ],
        },
        {
            name: "Liverpool Estate",
            description: "Large family build now at practical completion with the last handover documents already circulating between the certifier and site manager.",
            buildingType: "Double Storey 6BR Family Home",
            council: "Liverpool City Council",
            lotSize: 620,
            location: "8 George St, Liverpool NSW 2170",
            status: ProjectStatus.COMPLETED,
            budget: 1040000,
            spent: 1040000,
            startDate: "2025-03-03",
            estimatedEndDate: "2026-03-28",
            customerKey: "manjit",
            managerKey: "jasbir",
            requirements: [
                "6 bedrooms across two storeys",
                "Home office and media room",
                "Butler pantry and island kitchen",
                "Two living areas plus alfresco",
                "Three bathrooms and two ensuites",
            ],
            milestones: [
                makeMilestone("Site preparation and setout", 1, "The block was cleared and the setout matched the civil plan with no boundary adjustments.", 0, MilestoneStatus.DONE, "earthworks", { actualOffsetDays: 2, budget: 32000, spend: 32000 }),
                makeMilestone("Foundations and slab", 2, "Foundations and slab were completed in one clean run after a short weather delay on the first pour window.", 40, MilestoneStatus.DONE, "slab", { actualOffsetDays: 43, budget: 122000, spend: 121000 }),
                makeMilestone("Ground floor frame", 3, "The ground floor frame was signed off and the follow-on trades were booked straight away.", 83, MilestoneStatus.DONE, "frame", { actualOffsetDays: 86, budget: 145000, spend: 144000 }),
                makeMilestone("Upper floor frame", 4, "Upper floor frame and trusses were completed without any structural rework.", 128, MilestoneStatus.DONE, "frame", { actualOffsetDays: 132, budget: 138000, spend: 138000 }),
                makeMilestone("Roofing and external envelope", 5, "Roofing, sarking and cladding were completed and the home reached lock-up.", 174, MilestoneStatus.DONE, "roof", { actualOffsetDays: 179, budget: 142000, spend: 141500 }),
                makeMilestone("Rough-in and linings", 6, "Rough-in and plasterboard passed inspection with only the usual punch list items.", 225, MilestoneStatus.DONE, "linings", { actualOffsetDays: 231, budget: 176000, spend: 175500 }),
                makeMilestone("Fit-out and fixtures", 7, "Cabinetry, tiles, sanitaryware and appliances were installed and signed off.", 270, MilestoneStatus.DONE, "fitout", { actualOffsetDays: 276, budget: 168000, spend: 168000 }),
                makeMilestone("Practical completion and handover", 8, "The final walkthrough was completed and the owners accepted handover with a short defects list.", 316, MilestoneStatus.DONE, "handover", { actualOffsetDays: 321, budget: 117000, spend: 117000 }),
            ],
            updates: [
                makeUpdate(2, "manager", 45, "Foundations were poured after a brief weather hold. The concrete truck arrived in the revised morning slot and the pour stayed on time.", [asset("liverpool-estate", "updates", "2025-04-17-foundations-pour-01.jpg")]),
                makeUpdate(4, "manager", 138, "Upper floor framing was signed off and the inspection note came back clean. The program moved straight into roof carpentry.", [asset("liverpool-estate", "updates", "2025-07-18-upper-frame-01.jpg")]),
                makeUpdate(6, "manager", 234, "Rough-in and insulation were completed. The only issue raised was a minor relocation of one downpipe to improve access at the rear path.", [asset("liverpool-estate", "updates", "2025-10-22-rough-in-01.jpg")]),
                makeUpdate(7, "customer", 286, "Client walkthrough went smoothly. They approved the kitchen finish and only asked for a different mirror profile in the ensuite.", [asset("liverpool-estate", "updates", "2025-12-13-client-walkthrough-01.jpg")]),
                makeUpdate(8, "manager", 324, "Practical completion was achieved after the last defects were cleared. The occupation paperwork and warranty pack have been lodged.", [asset("liverpool-estate", "updates", "2026-01-20-practical-completion-01.jpg")]),
            ],
            variations: [
                makeVariation("Add a solar battery package and extra roof set-down for future battery cabinetry.", 13500, 208, VariationStatus.APPROVED, { approvedOffsetDays: 215, delayDays: 4 }),
                makeVariation("Upgrade the alfresco screening to a hardwood feature system instead of the standard aluminium blades.", 8400, 249, VariationStatus.APPROVED, { approvedOffsetDays: 255, delayDays: 2 }),
            ],
            schedules: [
                makeSchedule("concreting", 2, 40, 1, TradieScheduleStatus.COMPLETED),
                makeSchedule("carpentry", 4, 129, 5, TradieScheduleStatus.COMPLETED),
                makeSchedule("plumbing", 6, 224, 3, TradieScheduleStatus.COMPLETED),
                makeSchedule("cabinetry", 7, 268, 4, TradieScheduleStatus.COMPLETED),
            ],
            materials: [
                makeMaterial("48MPa Concrete", "Concrete", 66, 265, "Foundations and slab package", MaterialStatus.INSTALLED),
                makeMaterial("Structural Steel", "Structural", 1, 118500, "Upper floor transfer package", MaterialStatus.INSTALLED),
                makeMaterial("LVL Framing Pack", "Structural Timber", 1, 94000, "External and internal wall framing", MaterialStatus.INSTALLED),
                makeMaterial("Colorbond Roof Package", "Roofing", 158, 89, "Roof sheets, flashings and gutters", MaterialStatus.INSTALLED),
                makeMaterial("Insulation Package", "Insulation", 420, 21, "Ceiling and wall insulation", MaterialStatus.INSTALLED),
                makeMaterial("Custom Cabinetry", "Joinery", 2, 64500, "Kitchen, pantry and laundry joinery", MaterialStatus.INSTALLED),
                makeMaterial("Bathroom Fixtures", "Fixtures", 3, 18500, "Three wet-area fit-out packs", MaterialStatus.INSTALLED),
                makeMaterial("Landscaping and External Works", "External Works", 1, 43200, "Turf, mulch and boundary treatments", MaterialStatus.INSTALLED),
            ],
        },
        {
            name: "Oran Park Granny Flat",
            description: "Compact granny flat build progressing cleanly with slab and framing completed ahead of a short winter joinery window.",
            buildingType: "Granny Flat + Alfresco",
            council: "Camden Council",
            lotSize: 218,
            location: "6 Kookaburra Ave, Oran Park NSW 2570",
            status: ProjectStatus.ON_TRACK,
            budget: 315000,
            spent: 151800,
            startDate: "2026-01-14",
            estimatedEndDate: "2026-09-22",
            customerKey: "aisha",
            managerKey: "harjot",
            requirements: [
                "2 bedroom granny flat",
                "Accessible bathroom",
                "Compact kitchen and living area",
                "Small covered alfresco",
                "Future-proofed electrical and solar conduit",
            ],
            milestones: [
                makeMilestone("Survey and service locating", 1, "Survey pegs are in and service locations were confirmed before excavation started.", 0, MilestoneStatus.DONE, "feasibility", { actualOffsetDays: 1, budget: 12000, spend: 12000 }),
                makeMilestone("Slab pour", 2, "The slab has cured and the site was left neat for the framing crew.", 23, MilestoneStatus.DONE, "slab", { actualOffsetDays: 25, budget: 39000, spend: 39000 }),
                makeMilestone("Frame erection", 3, "Frame is up and the roof package has been released for delivery.", 52, MilestoneStatus.ACTIVE, "frame", { budget: 48000, spend: 21500 }),
                makeMilestone("Roofing and insulation", 4, "Roofing and insulation are scheduled back-to-back once the truss delivery is confirmed.", 88, MilestoneStatus.PENDING, "roof", { budget: 31000, spend: 0 }),
                makeMilestone("Rough-in services", 5, "Plumbing and electrical rough-in will follow immediately after the roof is weatherproof.", 125, MilestoneStatus.PENDING, "roughin", { budget: 28000, spend: 0 }),
                makeMilestone("Linings and cabinetry", 6, "Joinery and plasterboard manufacturing have both been booked with separate lead times.", 168, MilestoneStatus.PENDING, "joinery", { budget: 31000, spend: 0 }),
                makeMilestone("Handover", 7, "Final handover will only be booked once the client selection sheet and occupancy pack are both finalised.", 206, MilestoneStatus.PENDING, "handover", { budget: 26000, spend: 0 }),
            ],
            updates: [
                makeUpdate(2, "manager", 27, "Slab pour completed without any delivery issues. The formwork stayed true and the finish is ready for the frame pack.", [asset("oran-park-granny-flat", "updates", "2026-02-10-slab-pour-01.jpg")]),
                makeUpdate(3, "manager", 54, "Framing has started and the crew is tracking well. The only current risk is the roof truss delivery window.", [asset("oran-park-granny-flat", "updates", "2026-03-09-frame-start-01.jpg")]),
                makeUpdate(3, "customer", 66, "Client walkthrough covered the kitchen footprint and the accessible bathroom layout. The owners were happy to keep the plan unchanged.", [asset("oran-park-granny-flat", "updates", "2026-03-21-client-walkthrough-01.jpg")]),
                makeUpdate(3, "manager", 82, "The roofing crew has been pencilled in for next week, but the tile selection needs to be confirmed before the ordering deadline.", [asset("oran-park-granny-flat", "updates", "2026-04-06-roof-booking-01.jpg")]),
            ],
            variations: [
                makeVariation("Add a battery-ready conduit run and an external data point for future EV charging.", 2750, 61, VariationStatus.APPROVED, { approvedOffsetDays: 64, delayDays: 1 }),
                makeVariation("Upgrade the bathroom tile allowance to a full-height feature wall.", 4400, 73, VariationStatus.PENDING, { delayDays: 1 }),
            ],
            schedules: [
                makeSchedule("carpentry", 3, 55, 2, TradieScheduleStatus.CONFIRMED),
                makeSchedule("roofing", 4, 90, 2, TradieScheduleStatus.PENDING_RESPONSE),
                makeSchedule("electrical", 5, 130, 1, TradieScheduleStatus.PENDING),
                makeSchedule("cabinetry", 6, 171, 3, TradieScheduleStatus.NO_RESPONSE),
            ],
            materials: [
                makeMaterial("Concrete", "Concrete", 24, 262, "Single slab and driveway apron", MaterialStatus.DELIVERED),
                makeMaterial("Framing Timber", "Structural Timber", 1, 32500, "Wall framing and roof pack", MaterialStatus.ORDERED),
                makeMaterial("Colorbond Roof Sheets", "Roofing", 62, 88, "Compact roof package", MaterialStatus.ORDERED),
                makeMaterial("Insulation Batts", "Insulation", 140, 18, "Wall and ceiling set", MaterialStatus.PENDING),
                makeMaterial("Plumbing Kit", "Plumbing", 1, 9400, "Bathroom, kitchen and laundry rough-in", MaterialStatus.ORDERED),
                makeMaterial("Electrical Kit", "Electrical", 1, 10800, "Rough-in and switchboard allowance", MaterialStatus.ORDERED),
                makeMaterial("Cabinetry Package", "Joinery", 1, 24500, "Kitchen and laundry joinery", MaterialStatus.PENDING),
                makeMaterial("Bathroom Fixtures", "Fixtures", 1, 11700, "Accessible bathroom fit-out allowance", MaterialStatus.PENDING),
            ],
        },
        {
            name: "Manly Knockdown Rebuild",
            description: "Coastal knockdown rebuild with the demolition complete and a coastal-grade envelope package now being locked in with the glazier and roofer.",
            buildingType: "Knockdown Rebuild | Coastal Family Home",
            council: "Northern Beaches Council",
            lotSize: 524,
            location: "14 Bower Ln, Manly NSW 2095",
            status: ProjectStatus.ACTIVE,
            budget: 1520000,
            spent: 438900,
            startDate: "2025-09-16",
            estimatedEndDate: "2027-01-28",
            customerKey: "ben",
            managerKey: "simran",
            requirements: [
                "Knockdown rebuild with coastal resilience details",
                "4 bedrooms plus guest retreat",
                "Open-plan kitchen and living",
                "Stone facade and feature glazing",
                "Stormwater and retaining works for sloping site",
            ],
            milestones: [
                makeMilestone("Demolition and site clearance", 1, "Demolition was completed with the asbestos clearance and waste tickets filed the same week.", 0, MilestoneStatus.DONE, "renovation", { actualOffsetDays: 5, budget: 68000, spend: 68000 }),
                makeMilestone("Retaining walls and footings", 2, "Retaining and footing works are done and the engineer has asked for one final drainage photo set.", 30, MilestoneStatus.DONE, "external", { actualOffsetDays: 35, budget: 124000, spend: 123000 }),
                makeMilestone("Slab and stormwater package", 3, "The slab is down and the stormwater works were coordinated with the civil crew in the same mobilisation.", 69, MilestoneStatus.DONE, "slab", { actualOffsetDays: 74, budget: 165000, spend: 163000 }),
                makeMilestone("Frame erection", 4, "Frame is active and the builder is waiting on the glazier to confirm the coastal-rated window schedule.", 116, MilestoneStatus.ACTIVE, "frame", { budget: 182000, spend: 82000 }),
                makeMilestone("Roof and coastal wrap", 5, "Roofing and wrap are queued behind the revised glazing spec and the exposed-site wind rating review.", 164, MilestoneStatus.PENDING, "roof", { budget: 148000, spend: 0 }),
                makeMilestone("Rough-in and glazing", 6, "Rough-in trades will start once the envelope is sealed and the glazing order is confirmed.", 212, MilestoneStatus.PENDING, "roughin", { budget: 149000, spend: 0 }),
                makeMilestone("Linings and joinery", 7, "Joinery and linings are pencilled in after the coastal hardware pack lands on site.", 260, MilestoneStatus.PENDING, "joinery", { budget: 171000, spend: 0 }),
                makeMilestone("Final fit-off and handover", 8, "Final fit-off is deferred until the defects list from the certifier and builder's warranty inspection is closed.", 312, MilestoneStatus.PENDING, "handover", { budget: 146000, spend: 0 }),
            ],
            updates: [
                makeUpdate(2, "manager", 38, "Retaining works are complete and the drainage line was rerouted to suit the sloping back boundary. The engineer is happy with the photos.", [asset("manly-knockdown-rebuild", "updates", "2025-10-24-retaining-works-01.jpg")]),
                makeUpdate(3, "manager", 77, "Stormwater and slab works are both tracking. The crew had a short hold for a coastal wind warning, but the pour still landed cleanly.", [asset("manly-knockdown-rebuild", "updates", "2025-12-02-stormwater-slab-01.jpg")]),
                makeUpdate(4, "manager", 124, "Frame erection is underway and the glazier is checking the coastal rating on the window pack before ordering the balance of the set.", [asset("manly-knockdown-rebuild", "updates", "2026-01-18-frame-start-01.jpg")]),
                makeUpdate(4, "customer", 136, "Owner walkthrough covered the facade and the deck line. They approved the revised window geometry and asked for a softer stair balustrade detail.", [asset("manly-knockdown-rebuild", "updates", "2026-01-30-owner-walkthrough-01.jpg")]),
                makeUpdate(4, "manager", 150, "Coastal-grade glazing is the current bottleneck. The replacement lead time is still acceptable, but the roof booking will move behind it.", [asset("manly-knockdown-rebuild", "updates", "2026-02-13-glazing-delay-01.jpg")]),
            ],
            variations: [
                makeVariation("Upgrade to a higher wind-rated glazing package with marine-grade fixings.", 21800, 132, VariationStatus.APPROVED, { approvedOffsetDays: 140, delayDays: 5 }),
                makeVariation("Add a basement wine room with dedicated ventilation and feature lighting.", 18500, 145, VariationStatus.PENDING, { delayDays: 4 }),
                makeVariation("Swap the entry cladding to imported timber battens.", 12600, 151, VariationStatus.REJECTED, { delayDays: 0 }),
            ],
            schedules: [
                makeSchedule("carpentry", 4, 158, 4, TradieScheduleStatus.CONFIRMED),
                makeSchedule("glazing", 5, 171, 2, TradieScheduleStatus.PENDING_RESPONSE),
                makeSchedule("electrical", 6, 216, 3, TradieScheduleStatus.PENDING),
                makeSchedule("plumbing", 6, 219, 3, TradieScheduleStatus.NO_RESPONSE),
            ],
            materials: [
                makeMaterial("Demolition and Waste Removal", "Site Clearance", 1, 62000, "Knockdown and disposal allowance", MaterialStatus.INSTALLED),
                makeMaterial("Retaining Wall System", "Civil", 1, 128000, "Engineered retaining and drainage package", MaterialStatus.INSTALLED),
                makeMaterial("Concrete and Rebar", "Concrete", 72, 272, "Slab, footings and edge beams", MaterialStatus.DELIVERED),
                makeMaterial("Coastal Timber Framing", "Structural Timber", 1, 148000, "Wind-rated framing pack", MaterialStatus.ORDERED),
                makeMaterial("Coastal Glazing Package", "Glazing", 1, 166000, "Marine-grade frames and glass", MaterialStatus.PENDING),
                makeMaterial("Waterproofing Membrane", "Waterproofing", 28, 480, "Wet area and balcony membrane package", MaterialStatus.PENDING),
                makeMaterial("Joinery Package", "Joinery", 1, 112000, "Kitchen, laundry and main bedroom joinery", MaterialStatus.PENDING),
                makeMaterial("Landscaping and Driveway", "External Works", 1, 59500, "Paving, soft landscaping and drainage finishes", MaterialStatus.PENDING),
            ],
        },
        {
            name: "Campbelltown Duplex",
            description: "Two-storey duplex completed in line with the handover pack, with the final landscaping and defects already resolved.",
            buildingType: "Two-Storey Duplex",
            council: "Campbelltown City Council",
            lotSize: 424,
            location: "23 Blaxland Rd, Campbelltown NSW 2560",
            status: ProjectStatus.COMPLETED,
            budget: 840000,
            spent: 840000,
            startDate: "2025-02-18",
            estimatedEndDate: "2026-04-24",
            customerKey: "narelle",
            managerKey: "ravinder",
            requirements: [
                "2 x 3 bedroom duplex dwellings",
                "Two separate entries and services",
                "Internal garage access",
                "Durable family finishes",
                "Low-maintenance landscaping and fencing",
            ],
            milestones: [
                makeMilestone("Survey and set-out", 1, "Survey controls were set up and the site levels were checked before earthworks started.", 0, MilestoneStatus.DONE, "feasibility", { actualOffsetDays: 1, budget: 18000, spend: 18000 }),
                makeMilestone("Earthworks and footings", 2, "Footings were poured and the compaction records were filed with the engineer.", 30, MilestoneStatus.DONE, "earthworks", { actualOffsetDays: 33, budget: 78000, spend: 77500 }),
                makeMilestone("Slab pour", 3, "The slab pour was completed in one clean window and both units were kept on the same level.", 70, MilestoneStatus.DONE, "slab", { actualOffsetDays: 73, budget: 102000, spend: 101500 }),
                makeMilestone("Frame erection", 4, "Frame erection, roof trusses and lintels were all signed off together.", 111, MilestoneStatus.DONE, "frame", { actualOffsetDays: 115, budget: 118000, spend: 117500 }),
                makeMilestone("Roofing and sarking", 5, "Roofing reached lock-up and the weatherproofing inspection came back clear.", 151, MilestoneStatus.DONE, "roof", { actualOffsetDays: 155, budget: 104000, spend: 104000 }),
                makeMilestone("Rough-in services", 6, "Plumbing, electrical and insulation were coordinated without any trade clashes.", 194, MilestoneStatus.DONE, "roughin", { actualOffsetDays: 199, budget: 128000, spend: 127500 }),
                makeMilestone("Linings, tiling and cabinetry", 7, "Wet areas, cabinetry and internal paint were all wrapped before the final walkthrough.", 236, MilestoneStatus.DONE, "fitout", { actualOffsetDays: 241, budget: 134000, spend: 134000 }),
                makeMilestone("Handover and defects close-out", 8, "The defects list was closed out and both dwellings were handed over to the owners.", 276, MilestoneStatus.DONE, "handover", { actualOffsetDays: 280, budget: 158000, spend: 158000 }),
            ],
            updates: [
                makeUpdate(3, "manager", 75, "Slab pour landed cleanly and the concrete supplier kept the pump booking inside the agreed window.", [asset("campbelltown-duplex", "updates", "2025-05-04-slab-pour-01.jpg")]),
                makeUpdate(4, "manager", 118, "Frame and roof package were signed off in one inspection. The builder moved straight into rough-in sequencing.", [asset("campbelltown-duplex", "updates", "2025-06-16-frame-roof-01.jpg")]),
                makeUpdate(6, "manager", 203, "Rough-in trades coordinated without overlap and the insulation batch arrived with the full compliance paperwork.", [asset("campbelltown-duplex", "updates", "2025-09-09-rough-in-01.jpg")]),
                makeUpdate(7, "customer", 246, "Client walkthrough covered the paint schedule and the appliance placement. They approved the final colour selections.", [asset("campbelltown-duplex", "updates", "2025-10-22-client-walkthrough-01.jpg")]),
                makeUpdate(8, "manager", 282, "Practical completion is closed out. Only the landscaping maintenance note remains in the file, and the owners have both keys.", [asset("campbelltown-duplex", "updates", "2025-11-27-handover-01.jpg")]),
            ],
            variations: [
                makeVariation("Upgrade the facade lighting to a dusk-to-dawn LED package across both entries.", 4600, 122, VariationStatus.APPROVED, { approvedOffsetDays: 126, delayDays: 1 }),
                makeVariation("Add a custom pergola and extra paving to the rear courtyard of both units.", 11900, 154, VariationStatus.APPROVED, { approvedOffsetDays: 160, delayDays: 3 }),
            ],
            schedules: [
                makeSchedule("concreting", 2, 31, 1, TradieScheduleStatus.COMPLETED),
                makeSchedule("carpentry", 4, 111, 4, TradieScheduleStatus.COMPLETED),
                makeSchedule("plumbing", 6, 193, 2, TradieScheduleStatus.COMPLETED),
                makeSchedule("painting", 7, 238, 3, TradieScheduleStatus.COMPLETED),
            ],
            materials: [
                makeMaterial("Concrete and Rebar", "Concrete", 58, 256, "Footings and slab allowance", MaterialStatus.INSTALLED),
                makeMaterial("Framing Timber", "Structural Timber", 1, 86500, "Wall frames and roof trusses", MaterialStatus.INSTALLED),
                makeMaterial("Colorbond Roof Package", "Roofing", 122, 87, "Roof sheeting and gutters", MaterialStatus.INSTALLED),
                makeMaterial("Plasterboard Package", "Linings", 270, 31, "Internal wall and ceiling linings", MaterialStatus.INSTALLED),
                makeMaterial("Cabinetry and Joinery", "Joinery", 2, 52000, "Kitchen, laundry and vanity packages", MaterialStatus.INSTALLED),
                makeMaterial("Painting and Finishes", "Painting", 1, 15900, "Primer and final coat materials", MaterialStatus.INSTALLED),
                makeMaterial("Landscaping", "External Works", 1, 26300, "Turf, paving and garden bed allowance", MaterialStatus.INSTALLED),
                makeMaterial("Fixtures and Appliances", "Fixtures", 1, 39700, "Tapware, sinks and appliance allowance", MaterialStatus.INSTALLED),
            ],
        },
    ];

    const customerMap = new Map(customers.map((customer) => [customer.key, customer]));
    const managerMap = new Map(siteManagers.map((manager) => [manager.key, manager]));
    // const tradieMap = new Map(
    //     tradies.map((tradie, index) => [
    //         ["excavation", "concreting", "carpentry", "roofing", "plumbing", "electrical", "plastering", "waterproofing", "tiling", "cabinetry", "painting", "landscaping", "glazing"][index],
    //         tradie,
    //     ]),
    // );

    for (const projectSeed of projectSeeds) {
        const customer = customerMap.get(projectSeed.customerKey);
        const manager = managerMap.get(projectSeed.managerKey);

        if (!customer || !manager) {
            throw new Error(`Missing seed reference for ${projectSeed.name}`);
        }

        const authorIds: Record<FileAuthor, string> = { admin: admin.id, manager: manager.user.id, customer: customer.user.id };
        const projectSlug = slugify(projectSeed.name);
        const projectStart = day(projectSeed.startDate);

        const project = await prisma.project.create({
            data: {
                name: projectSeed.name,
                description: projectSeed.description,
                buildingType: projectSeed.buildingType,
                council: projectSeed.council,
                lotSize: decimal(projectSeed.lotSize),
                customerId: customer.customer.id,
                location: projectSeed.location,
                siteManagerId: manager.user.id,
                status: projectSeed.status,
                totalBudget: decimal(projectSeed.budget),
                spent: decimal(projectSeed.spent),
                startDate: projectStart,
                estimatedEndDate: day(projectSeed.estimatedEndDate),
                requirements: projectSeed.requirements as Prisma.InputJsonValue,
            },
        });

        const milestonesByOrder = new Map<number, { id: string; name: string }>();

        for (const milestoneSeed of projectSeed.milestones) {
            const milestone = await prisma.milestone.create({
                data: {
                    projectId: project.id,
                    name: milestoneSeed.name,
                    order: milestoneSeed.order,
                    description: milestoneSeed.description,
                    targetDate: addDays(projectStart, milestoneSeed.targetOffsetDays),
                    actualDate: milestoneSeed.actualOffsetDays !== undefined ? addDays(projectStart, milestoneSeed.actualOffsetDays) : null,
                    budget: decimal(milestoneSeed.budget),
                    spend: milestoneSeed.spend !== undefined ? decimal(milestoneSeed.spend) : null,
                    status: milestoneSeed.status,
                    isPhotoRequired: milestoneSeed.isPhotoRequired ?? true,
                },
            });

            milestonesByOrder.set(milestoneSeed.order, { id: milestone.id, name: milestone.name });

            const files = fileSeedsForMilestone(projectSlug, milestoneSeed.order, milestoneSeed.fileProfile, authorIds);
            for (const fileSeed of files) {
                await prisma.file.create({
                    data: {
                        projectId: project.id,
                        milestoneId: milestone.id,
                        filename: fileSeed.filename,
                        fileType: fileSeed.fileType,
                        filesize: fileSeed.filesize,
                        url: fileSeed.url,
                        uploadedBy: fileSeed.uploadedBy,
                    },
                });
            }
        }

        for (const materialSeed of projectSeed.materials) {
            await prisma.material.create({
                data: {
                    projectId: project.id,
                    name: materialSeed.name,
                    category: materialSeed.category,
                    quantity: materialSeed.quantity,
                    unitCost: decimal(materialSeed.unitCost),
                    totalCost: decimal(materialSeed.totalCost),
                    specifications: materialSeed.specifications,
                    status: materialSeed.status,
                },
            });
        }

        for (const updateSeed of projectSeed.updates) {
            const milestone = updateSeed.milestoneOrder ? milestonesByOrder.get(updateSeed.milestoneOrder) : undefined;

            await prisma.siteUpdate.create({
                data: {
                    projectId: project.id,
                    milestoneId: milestone?.id,
                    authorId: authorIds[updateSeed.author],
                    notes: updateSeed.notes,
                    photoUrls: updateSeed.photoUrls,
                    createdAt: addDays(projectStart, updateSeed.offsetDays),
                },
            });
        }

        for (const variationSeed of projectSeed.variations) {
            await prisma.variation.create({
                data: {
                    projectId: project.id,
                    description: variationSeed.description,
                    cost: decimal(variationSeed.cost),
                    requestedDate: addDays(projectStart, variationSeed.requestedOffsetDays),
                    approvedDate: variationSeed.approvedOffsetDays !== undefined ? addDays(projectStart, variationSeed.approvedOffsetDays) : null,
                    delayDays: variationSeed.delayDays,
                    status: variationSeed.status,
                },
            });
        }

        for (const scheduleSeed of projectSeed.schedules) {
            const tradie = tradieMap.get(scheduleSeed.tradieKey);
            if (!tradie) {
                throw new Error(`Missing tradie seed for ${projectSeed.name}`);
            }

            const milestone = scheduleSeed.milestoneOrder ? milestonesByOrder.get(scheduleSeed.milestoneOrder) : undefined;

            await prisma.tradieSchedule.create({
                data: {
                    tradieId: tradie.id,
                    projectId: project.id,
                    milestoneId: milestone?.id,
                    scheduledDate: addDays(projectStart, scheduleSeed.offsetDays),
                    durationDays: scheduleSeed.durationDays,
                    status: scheduleSeed.status,
                },
            });
        }

        await prisma.activityLog.create({
            data: {
                projectId: project.id,
                authorId: manager.user.id,
                type: "seed",
                message: `${projectSeed.name} seeded with realistic milestone, material, file and schedule history.`,
            },
        });
    }

    await prisma.activityLog.create({
        data: {
            projectId: (await prisma.project.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } }))!.id,
            authorId: admin.id,
            type: "seed",
            message: "Seed completed for admin oversight.",
        },
    });

    const materialCount = await prisma.material.count();
    const milestoneCount = await prisma.milestone.count();
    const fileCount = await prisma.file.count();

    console.log(
        `Seeded ${customers.length} customers, ${siteManagers.length} site managers, ${tradies.length} tradies, ${projectSeeds.length} projects, ${milestoneCount} milestones, ${materialCount} materials and ${fileCount} files.`,
    );
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
