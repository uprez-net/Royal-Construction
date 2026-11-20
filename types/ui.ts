import type { ReactNode } from "react";

export type NavItem = {
  slug: string;
  label: string;
  icon: ReactNode;
  checkAdmin?: boolean;
  /** Sales side: leads, offers, the operations agent. Not for a site manager. */
  officeOnly?: boolean;
};

export type ProjectDetailKpi = {
  id: string;
  label: string;
  value: string;
  note: string;
  trend?: string;
  trendTone?: "success" | "warning" | "danger" | "neutral";
};

export type ProjectBudgetPoint = {
  month: string;
  planned: number;
  actual: number;
  contract: number;
};

export type ProjectMilestoneMix = {
  status: "Completed" | "In Progress" | "Upcoming";
  count: number;
  color: string;
};

export type ProjectActivityItem = {
  id: string;
  title: string;
  description: string;
  author: string;
  timestamp: string;
  state: "done" | "active" | "upcoming";
};

export type ProjectMaterialItem = {
  id: string;
  category: string;
  product: string;
  specification: string;
  quantity: string;
  unitCost: string;
  totalCost: string;
  orderedStatus: "Yes" | "Partial" | "Pending" | "Not Yet";
  deliveredStatus: "Yes" | "Partial" | "No";
};

// `ProjectPaymentItem` and `WorkerAttendanceItem` were removed here along with
// the `projectPaymentsMock` / `workerAttendanceMock` fixtures they shaped. Both
// described features with no backing Prisma model — there is no Invoice/Payment
// table, and no attendance/check-in table — so they were fabricated data
// structures, not a schema contract. If either feature is built for real, model
// it from the schema rather than resurrecting these.

export type QuoteRequestItem = {
  id: string;
  quoteNumber: string;
  type: "Initial" | "Variation" | "Revised";
  createdOn: string;
  description: string;
  amount: number;
  gst: number;
  sentOn: string;
  approvedOn?: string;
  status: "Approved" | "Pending Approval";
};

export type VariationImpactTone = "neutral" | "warning" | "danger";

export type VariationTimelineImpact = {
  tone: VariationImpactTone;
  title: string;
  totalDelayDays: number;
  approvedVariationCount: number;

  originalDurationPercent: number;
  delayPercent: number;
  visualOriginalPercent: number;
  visualDelayPercent: number;

  startDateLabel: string;
  originalEndLabel: string;
  adjustedEndLabel: string;
  summary: string;
  styles: {
    card: string;
    iconWrapper: string;
    icon: string;
    title: string;
    originalBar: string;
    delayBar: string;
  };
};

export type SiteUpdateItem = {
  id: string;
  title: string;
  description: string;
  by: string;
  time: string;
  photos: number;
};

export type TradieItem = {
  id: string;
  trade: string;
  contact: string;
  needed: string;
  scheduled: string;
  reminder: string;
  confirmed: "Yes" | "Not Yet" | "Pending";
  status:
    | "Completed"
    | "On Site"
    | "Needs Attention"
    | "Yet to Connect"
    | "Scheduled";
};
