import type { ProjectAttention } from "@/lib/domain/projects/attention";
import type {
  TradeSelectionStatus,
  TradiePriceUnit,
  TradieQuoteGst,
  TradieQuoteSource,
  TradieRequestDeliveryStatus,
  TradieRequestKind,
} from "@prisma/client";
import {
  Milestone,
  Project,
  Tradie,
  Variation,
  File as ProjectFile,
  SiteUpdate,
  User,
  TradieSchedule,
  TradieScheduleStatus,
  Customer,
  ActivityLog,
  Material,
  ProjectStage,
  ProjectStatus,
  LeadEmails,
  Invoice,
} from "@prisma/client";
import { ProjectRequirementsPayload } from "./project-flow";
import type { CertifierEngagementDetail } from "./compliance";
import type { BookingBillingState } from "@/lib/domain/tradies/billing-rules";
import type { ProjectDocument } from "@/lib/domain/projects/document-tags";

export interface SafeProject extends Omit<
  Project,
  "totalBudget" | "spent" | "lotSize" | "requirements"
> {
  totalBudget: string;
  spent: string;
  lotSize?: string;
  requirements?: ProjectRequirementsPayload;
  /**
   * Set when the caller may not see the project's money (see
   * `canSeeProjectFinancials`). Every amount on the payload is then zero or
   * empty, which is "hidden" and not "free": a screen that finds this set
   * draws no money at all rather than a column of $0.
   */
  financialsHidden?: true;
}

/**
 * A progress claim across the RSC boundary.
 *
 * Every money field is a string: Prisma `Decimal`s are class instances and do
 * not survive serialization, so consumers do their own `Number(...)` — the same
 * contract `SafeProject` and `SafeMilestone` follow.
 */
export interface SafeInvoice extends Omit<
  Invoice,
  | "subTotal"
  | "totalTax"
  | "total"
  | "amountDue"
  | "amountPaid"
  | "amountCredited"
> {
  subTotal: string;
  totalTax: string;
  total: string;
  amountDue: string;
  amountPaid: string;
  amountCredited: string;
}

/**
 * A progress claim as it appears on the project LIST payload.
 *
 * A narrower row than `SafeInvoice`: the list feeds a quick-view summary, not
 * the claim ledger, so it carries only what a summary table shows. The full
 * rows live on `ProjectDetail`.
 */
export type ProjectListInvoice = {
  id: string;
  invoiceNumber: string | null;
  projectStage: ProjectStage;
  status: Invoice["status"];
  total: string;
  amountPaid: string;
  amountDue: string;
  issuedDate: Date;
  dueDate: Date;
};

/**
 * A project's invoicing position, rolled up from its claims.
 *
 * Carried on the list payload as well as the detail one because the project
 * card and the financial tab both show cleared money, and neither has the
 * invoice rows to add up themselves.
 */
export type ProjectInvoiceTotals = {
  /** Raised, whatever its payment state. */
  invoiced: string;
  /** Money actually received — the "cleared" figure. */
  paid: string;
  /** Still owed on claims that have not been voided. */
  outstanding: string;
  /** Claims still awaiting payment, i.e. the Payments tab badge. */
  pendingCount: number;
};

/**
 * Shared budget health classification. Derived purely from
 * `getBudgetStatus` (see `lib/utils/project-budget-status.ts`) so every
 * surface that shows a budget badge — stat cards, overview/financial tabs,
 * project card — agrees on whether spend is "not started", "on budget" or
 * "over budget".
 */
export type BudgetStatus = "NOT_STARTED" | "ON_BUDGET" | "OVER_BUDGET";

/**
 * Full budget summary surfaced by `selectActiveProjectBudgetSummary`. The
 * numeric fields are the derived figures other logic already depends on;
 * `status` is the shared classification so consumers stop re-deriving it.
 */
export type BudgetSummary = {
  totalBudget: number;
  spent: number;
  remaining: number;
  variance: number;
  spentPercent: number;
  status: BudgetStatus;
};

export interface SafeMaterial extends Omit<Material, "unitCost" | "totalCost"> {
  unitCost: string;
  totalCost: string;
}

export interface SafeTradie extends Omit<Tradie, "lastQuotedPrice" | "rating"> {
  lastQuotedPrice?: string;
  lastQuotedPriceUnit: TradiePriceUnit;
  rating?: string;
}

export interface SafeVariation extends Omit<
  Variation,
  | "cost"
  | "invoiceAmountPaid"
  | "invoiceTax"
  | "invoiceTotal"
  | "newPrice"
  | "previousPrice"
> {
  cost: string;
  invoiceAmountPaid: string | null;
  invoiceTax: string | null;
  invoiceTotal: string | null;
  newPrice: string | null;
  previousPrice: string | null;
}

/** Who wrote a row, as the project detail carries it: the name is what shows. */
export type UserSummary = Pick<User, "id" | "name">;

/** The site manager as the project detail carries it. */
export type SiteManagerSummary = Pick<User, "id" | "name" | "email" | "phone">;

export interface SiteUpdateWithAuthor extends SiteUpdate {
  author: UserSummary;
}

/**
 * A staff note on one activity. Dates arrive as `Date` from the read and as
 * ISO strings once they have crossed to the browser, as everywhere else here.
 */
export interface MilestoneNoteItem {
  id: string;
  milestoneId: string;
  body: string;
  createdAt: Date | string;
  authorId: string | null;
  author: UserSummary | null;
}

export interface SiteUpdateWithAuthorAndMilestone extends SiteUpdateWithAuthor {
  milestone: SafeMilestone;
}

export interface TradieScheduleWithTradie extends TradieSchedule {
  tradie: SafeTradie;
}

/**
 * Where the request email a booking came from stands. Shared by every booking
 * the same email asked for, so it is keyed by `id`, not by the booking.
 */
export type TradieRequestDeliverySummary = {
  id: string;
  deliveryStatus: TradieRequestDeliveryStatus;
  attempts: number;
  lastAttemptAt: Date | null;
  nextAttemptAt: Date | null;
  sentAt: Date | null;
  lastError: string | null;
  toAddress: string;
  createdAt: Date;
  request: {
    id: string;
    createdAt: Date;
    subject: string;
    kind: TradieRequestKind;
  };
};

/** Where a booking's quoted amount came from. */
export type TradieQuoteSummary = {
  id: string;
  source: TradieQuoteSource;
  gstTreatment: TradieQuoteGst | null;
  quotedAt: Date;
  validUntil: Date | null;
  notes: string | null;
  enteredBy: { name: string } | null;
};

/** The activity a booking is for, as far as a booking row needs it. */
export type BookingMilestone = Pick<
  SafeMilestone,
  | "id"
  | "name"
  | "status"
  | "targetDate"
  | "startDate"
  | "budget"
  | "spend"
  | "parentId"
  | "order"
  | "projectStage"
>;

export interface TradieScheduleWithTradieAndMilestone extends TradieScheduleWithTradie {
  milestone?: BookingMilestone;
  /**
   * Where the booking is up to with its invoices. Null when it is neither
   * committed nor billed; absent on a row the store built itself.
   */
  billing?: BookingBillingState | null;
  requestRecipient?: TradieRequestDeliverySummary | null;
  quote?: TradieQuoteSummary | null;
}

/** The tradie chosen for a trade on a project. */
export type TradeSelectionSummary = {
  id: string;
  trade: string;
  tradeKey: string;
  tradieId: string;
  status: TradeSelectionStatus;
  selectedAt: Date;
  cancelledAt: Date | null;
  tradie: { name: string };
  selectedBy: { name: string } | null;
};

export interface TradieScheduleWithTradieMilestoneAndProject extends TradieScheduleWithTradieAndMilestone {
  project: SafeProject;
}

export interface SafeMilestone extends Omit<Milestone, "spend" | "budget"> {
  requiredTradeTypes?: { id: string; label: string }[];
  budget: string;
  spend?: string;
}

/** Authoritative consequences returned by the milestone command; the store never re-decides them. */
export type MilestoneUpdateResult = SafeMilestone & {
  effects: {
    parents: {
      id: string;
      status: Milestone["status"];
      spend?: string;
      actualDate?: Date;
      startDate?: Date;
    }[];
    projectStatus: ProjectStatus | null;
    projectSpent: string;
    projectStartDate: Date | null;
    /** Open activities re-planned from this one's completion (issue #422). */
    replanned: { id: string; targetDate: Date }[];
    settledBookings: { completed: string[]; cancelled: string[] };
  };
};

/**
 * A milestone on the project detail. Its bookings are not on it: they are
 * `ProjectDetail.tradieSchedules` with this `milestoneId`.
 */
export interface MilestoneWithFilesTradiesUpdates extends SafeMilestone {
  files: ProjectFile[];
  siteUpdates: SiteUpdateWithAuthor[];
  /** Staff notes, newest first. Always empty on a customer's payload. */
  notes: MilestoneNoteItem[];
}

export interface ProjectWithStats extends SafeProject {
  customer: Customer;
  siteManager: User | null;
  milestones: {
    id: string;
    name: string;
    targetDate: Date;
    actualDate: Date | null;
    projectStage: Milestone["projectStage"];
    status: Milestone["status"];
    tradies: {
      name: string;
      tradeType: string;
    }[];
  }[];
  milestoneCount: number;
  completedMilestoneCount: number;
  progressPercent: number;
  approvedVariationSpend: string;
  invoiceTotals: ProjectInvoiceTotals;
  invoices: ProjectListInvoice[];
  /**
   * What on this project needs somebody, derived live (issue #452). Null for
   * a completed project, which is never assessed.
   */
  attention: ProjectAttention | null;
}

export interface ActivityLogWithAuthor extends ActivityLog {
  author: UserSummary | null;
}

export interface ProjectDetail extends SafeProject {
  customer: Customer;
  siteManager: SiteManagerSummary | null;
  lead: {
    id: number;
    email: string;
    type: string;
    location: string;
    emails: LeadEmails[];
  };
  activityLogs: ActivityLogWithAuthor[];
  milestones: MilestoneWithFilesTradiesUpdates[];
  siteUpdates: SiteUpdateWithAuthorAndMilestone[];
  variations: SafeVariation[];
  tradieSchedules: TradieScheduleWithTradieAndMilestone[];
  files: ProjectFile[];
  /**
   * Every document the project holds, from every place one can be put, with
   * its tags. The Documents tab's rows; `files` stays the project's own uploads.
   */
  documents: ProjectDocument[];
  materials: SafeMaterial[];
  /** Null until someone presses "Connect with Certifier". */
  certifierEngagement: CertifierEngagementDetail | null;
  /** Progress claims raised against this project, newest first. */
  invoices: SafeInvoice[];
  /** Who is selected for each trade, newest first, cancelled ones included. */
  tradeSelections: TradeSelectionSummary[];
}

/**
 * "All" on the projects list: every project that is not finished (issue #450).
 *
 * Not a `ProjectStatus` and not the absence of a filter. The list's "All" chip
 * used to send no status at all, which listed every completed job alongside
 * the live ones; a finished build is history, and it has its own Completed
 * chip. Absent still means every project, so Eve's project search and the CSV
 * export are unchanged.
 *
 * It lives here rather than beside the query it feeds because that module is
 * imported by `"use server"` code and client components alike, and the chip
 * that sends this value is a client component.
 */
export const OPEN_PROJECTS_FILTER = "OPEN";

/**
 * Drafting: not finished, and no activity on it has started (issue #452).
 *
 * It replaced the "Pre-construction" chip, which asked the same question of
 * the status column -- DRAFT, COMPLIANCE_STARTED or COMPLIANCE_COMPLETED --
 * and so lost every project whose status had been overwritten with
 * NEEDS_ATTENTION or DELAYED before a spade went in. The milestones are the
 * fact; see `draftingProjectWhere`.
 */
export const DRAFTING_FILTER = "DRAFTING";

/** The retired chip's value, still read from old links as Drafting. */
export const LEGACY_PRE_CONSTRUCTION_FILTER = "PRE_CONSTRUCTION";

export type ProjectKPIs = {
  totalActive: number;
  active: number;
  onTrack: number;
  needsAttention: number;
  delayed: number;
  completed: number;
  /**
   * Projects that are not finished and have no activity started -- the
   * Drafting chip (issue #452). A drafting project can also need attention;
   * the two counts overlap on purpose.
   */
  drafting: number;
};

export type TradieKPIs = {
  totalScheduled: number;
  pending: number;
  pendingResponse: number;
  confirmed: number;
  noResponse: number;
  declined: number;
  completed: number;
};

export type TradieCoordinationTab =
  | "all"
  | "week"
  | "confirmed"
  | "pending"
  | "overdue"
  | "completed";

export type TradieCoordinationSortBy =
  | "scheduledDate"
  | "tradieName"
  | "tradeType"
  | "projectName"
  | "status";

export type TradieCoordinationQuery = {
  page?: number;
  limit?: number;
  search?: string;
  projectId?: string | null;
  tradeType?: string | null;
  status?: TradieScheduleStatus | null;
  tab?: TradieCoordinationTab;
  sortBy?: TradieCoordinationSortBy;
  sortOrder?: "asc" | "desc";
};

export type TradieScheduleListItem = {
  id: string;
  abn: string;
  tradieId: string;
  tradieName: string;
  tradeType: string;
  projectId: string;
  projectName: string;
  milestoneId?: string;
  milestoneName?: string;
  taskLabel: string;
  scheduledDate: string;
  durationDays: number;
  status: TradieScheduleStatus;
  isFavourite: boolean;
  note: string | null;
  reminderSentAt?: string;
  updatedAt: string;
  lastQuotedPrice?: string;
  lastQuotedPriceUnit: TradiePriceUnit;
  rating?: string;
  requiresQuote: boolean;
  quotedPrice?: string;
  /** The booking's reply reference, quoted on every email about it. */
  refToken?: string | null;
  contact: {
    email: string;
    phone: string;
    additionalEmails: string[];
  };
  siteManager: {
    name: string;
    email: string;
    phone: string;
  };
};

export type TradieCoordinationSummary = {
  registeredTradies: number;
  registeredTrendDelta: number;
  scheduledThisWeek: number;
  scheduledWeekDelta: number;
  confirmedBookings: number;
  pendingNoResponse: number;
  activeTradies: number;
  inactiveTradies: number;
  completionRate: number;
};

export type TradieStatusMetric = {
  label: string;
  value: number;
  status: TradieScheduleStatus;
};

export type TradieTradeBreakdownItem = {
  tradeType: string;
  total: number;
  confirmedRate: number;
};

export type TradieProjectAllocationItem = {
  projectId: string;
  projectName: string;
  allocationCount: number;
};

export type TradieUtilizationTrendPoint = {
  weekLabel: string;
  utilization: number;
  target: number;
};

export type TradieActivityItem = {
  id: string;
  type: "done" | "warn" | "urgent";
  message: string;
  createdAt: string;
};

export type TradieUrgentReminderItem = {
  id: string;
  tradieName: string;
  tradeType: string;
  abn: string;
  projectName: string;
  milestoneName?: string;
  taskLabel: string;
  scheduledDate: string;
  daysLeft: number;
  status: TradieScheduleStatus;
  reminderSentAt?: string;
  /** The booking's reply reference, for a reminder sent from here. */
  refToken?: string | null;
  contact: {
    email: string;
    phone: string;
    additionalEmails: string[];
  };
  lastQuotedPrice?: string;
  lastQuotedPriceUnit: TradiePriceUnit;
  rating?: string;
  siteManager: {
    name: string;
    email: string;
    phone: string;
  };
};

export type TradieTabCounts = Record<TradieCoordinationTab, number>;

export type TradieCoordinationDashboard = {
  query: {
    page: number;
    limit: number;
    search: string;
    projectId: string | null;
    tradeType: string | null;
    status: TradieScheduleStatus | null;
    tab: TradieCoordinationTab;
    sortBy: TradieCoordinationSortBy;
    sortOrder: "asc" | "desc";
  };
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
  schedules: TradieScheduleListItem[];
  summary: TradieCoordinationSummary;
  tabCounts: TradieTabCounts;
  tradeOptions: string[];
  statusMetrics: TradieStatusMetric[];
  tradeBreakdown: TradieTradeBreakdownItem[];
  projectAllocations: TradieProjectAllocationItem[];
  utilizationTrend: TradieUtilizationTrendPoint[];
  activity: TradieActivityItem[];
  urgentReminders: TradieUrgentReminderItem[];
};

export type ProjectMutationStatus = "idle" | "pending" | "succeeded" | "failed";

export type ProjectMutationState = {
  status: ProjectMutationStatus;
  error: string | null;
};

export type ProjectUploadStatus =
  | "queued"
  | "uploading"
  | "completed"
  | "failed";

export type ProjectUploadRecord = {
  id: string;
  fileName: string;
  fileSize: number;
  progress: number;
  status: ProjectUploadStatus;
  url: string | null;
  error: string | null;
};

export type CreateProjectRequest = {
  name: string;
  propertyType: string;
  customerMode: "existing" | "new";
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  location: string;
  council?: string;
  siteManagerId?: string | null;
  budget: number;
  lotSize: number;
  startDate: string;
  estimatedEndDate?: string | null;
  notes?: string;
  quoteFile?: File | null;
};

export type AddProjectUpdateRequest = {
  projectId: string;
  notes: string;
  milestoneId?: string | null;
  photoUrls: string[];
};

export interface UIMilestone extends MilestoneWithFilesTradiesUpdates {
  childrenMilestones: UIMilestone[];
}

export const PROJECT_STAGE_LABELS: Record<ProjectStage, string> = {
  Deposit: "Deposit",
  Slab: "Slab",
  Frame: "Frame",
  Lockup: "Lock Up",
  Interior_Fit_Out: "Interior Fit-Out",
  Final: "Final",
};

export const PROJECT_STAGE_PERCENTAGE: Record<ProjectStage, number> = {
  Deposit: 0.05,
  Slab: 0.15,
  Frame: 0.25,
  Lockup: 0.25,
  Interior_Fit_Out: 0.2,
  Final: 0.1,
};
