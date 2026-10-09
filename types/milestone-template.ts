import type { ProjectStage } from "@prisma/client";

export type TemplateActivity = {
  id: string;
  name: string;
  order: number;
  parentId: string | null;
  projectStage: ProjectStage;
  relatedCostLines: string[];
  estimatedDays: number;
  requiredTradeTypeId: string | null;
};

export type MilestoneTemplateSnapshot = {
  revision: string;
  activities: TemplateActivity[];
};
