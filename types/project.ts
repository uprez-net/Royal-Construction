import { Milestone, Project, Tradie, Variation, File as ProjectFile, SiteUpdate, User, TradieSchedule, TradieScheduleStatus, Customer, ActivityLog, Material } from "@prisma/client";

export interface SafeProject extends Omit<Project, "totalBudget" | "spent" | "lotSize"> {
  totalBudget: string;
  spent: string;
  lotSize?: string;
}

export interface SafeMaterial extends Omit<Material, "unitCost" | "totalCost"> {
  unitCost: string;
  totalCost: string;
}

export interface SafeTradie extends Omit<Tradie, "hourlyRate" | "rating"> {
  hourlyRate?: string;
  rating?: string;
}

export interface SafeVariation extends Omit<Variation, "cost"> {
  cost: string;
}

export interface SiteUpdateWithAuthor extends SiteUpdate {
  author: User;
}

export interface SiteUpdateWithAuthorAndMilestone extends SiteUpdateWithAuthor {
  milestone: SafeMilestone;
}

export interface TradieScheduleWithTradie extends TradieSchedule {
  tradie: SafeTradie;
}

export interface TradieScheduleWithTradieAndMilestone extends TradieScheduleWithTradie {
  milestone?: SafeMilestone;
}

export interface TradieScheduleWithTradieMilestoneAndProject extends TradieScheduleWithTradieAndMilestone {
  project: SafeProject;
}

export interface SafeMilestone extends Omit<Milestone, "spend" | "budget"> {
  budget: string;
  spend?: string;
}

export interface MilestoneWithFilesTradiesUpdates extends SafeMilestone {
  files: ProjectFile[];
  siteUpdates: SiteUpdateWithAuthor[];
  tradieSchedules: TradieScheduleWithTradie[];
}

export interface ProjectWithStats extends SafeProject {
  customer: Customer;
  siteManager: User | null;
  milestones: {
    id: string;
    name: string;
    targetDate: Date;
    actualDate: Date | null;
    status: Milestone["status"];
    tradies: {
      name: string;
      company: string | null;
      tradeType: string;
    }[]
  }[];
  milestoneCount: number;
  completedMilestoneCount: number;
  progressPercent: number;
  approvedVariationSpend: string;
}

export interface ActivityLogWithAuthor extends ActivityLog {
  author: User | null;
}

export interface ProjectDetail extends SafeProject {
  customer: Customer;
  siteManager: User | null;
  activityLogs: ActivityLogWithAuthor[];
  milestones: MilestoneWithFilesTradiesUpdates[];
  siteUpdates: SiteUpdateWithAuthorAndMilestone[];
  variations: SafeVariation[];
  tradieSchedules: TradieScheduleWithTradieAndMilestone[];
  files: ProjectFile[];
  materials: SafeMaterial[];
}

export type ProjectKPIs = {
  totalActive: number;
  onTrack: number;
  needsAttention: number;
  delayed: number;
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

export type TradieCoordinationTab = "all" | "week" | "confirmed" | "pending" | "overdue" | "completed";

export type TradieCoordinationSortBy = "scheduledDate" | "tradieName" | "tradeType" | "projectName" | "status";

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
  tradieId: string;
  tradieName: string;
  company: string | null;
  tradeType: string;
  projectId: string;
  projectName: string;
  milestoneId?: string;
  milestoneName?: string;
  taskLabel: string;
  scheduledDate: string;
  durationDays: number;
  status: TradieScheduleStatus;
  reminderSentAt?: string;
  updatedAt: string;
  hourtlyRate?: string;
  rating?: string;
  contact: {
    email: string;
    phone: string;
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
  projectName: string;
  milestoneName?: string;
  taskLabel: string;
  scheduledDate: string;
  daysLeft: number;
  status: TradieScheduleStatus;
  reminderSentAt?: string;
  company: string | null;
  contact: {
    email: string;
    phone: string;
  };
  hourtlyRate?: string;
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

export type ProjectUploadStatus = "queued" | "uploading" | "completed" | "failed";

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

export type CreateVariationRequest = {
  projectId: string;
  description: string;
  cost: number;
  requestedDate?: string;
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