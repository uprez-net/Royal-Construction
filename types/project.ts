import { Milestone, Project, Tradie, Variation, File, SiteUpdate, User, TradieSchedule, Customer, ActivityLog } from "@prisma/client";

export interface SafeProject extends Omit<Project, "totalBudget" | "spent" | "lotSize"> {
    totalBudget: string;
    spent: string;
    lotSize?: string;
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
    milestone: Milestone;
}

export interface TradieScheduleWithTradie extends TradieSchedule {
    tradie: SafeTradie;
}

export interface TradieScheduleWithTradieAndMilestone extends TradieScheduleWithTradie {
    milestone?: Milestone;
}

export interface TradieScheduleWithTradieMilestoneAndProject extends TradieScheduleWithTradieAndMilestone {
    project: SafeProject;
}

export interface MilestoneWithFilesTradiesUpdates extends Milestone {
    files: File[];
    siteUpdates: SiteUpdateWithAuthor[];
    tradieSchedules: TradieScheduleWithTradie[];
}

export interface ProjectWithStats extends SafeProject {
  customer: Customer;
  siteManager: User | null;
  milestones: {
    status: Milestone["status"];
  }[];
  milestoneCount: number;
  completedMilestoneCount: number;
  progressPercent: number;
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
  files: File[];
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
