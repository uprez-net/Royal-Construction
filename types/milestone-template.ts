import type { ProjectStage } from "@prisma/client";

export type TemplateActivity = {
  id: string;
  name: string;
  order: number;
  parentId: string | null;
  projectStage: ProjectStage;
  relatedCostLines: string[];
  estimatedDays: number;
  /** Every trade the activity needs. Empty means no tradie dependency. */
  requiredTradeTypeIds: string[];
};

export type MilestoneTemplateSnapshot = {
  revision: string;
  activities: TemplateActivity[];
};

export type TemplateActivityFields = Omit<
  TemplateActivity,
  "id" | "order" | "parentId"
>;

/** Targeted edits preserve activities the operator did not ask to change. */
export type MilestoneTemplateChange =
  | {
      type: "add";
      activity: TemplateActivityFields & {
        id?: string;
        parentId: string | null;
      };
    }
  | {
      type: "update";
      activityId: string;
      patch: Partial<TemplateActivityFields>;
    }
  | {
      type: "move";
      activityId: string;
      targetId: string | null;
      mode: "before" | "child" | "root";
    }
  | { type: "remove"; activityId: string };

export type MilestoneTemplateEdit = {
  revision: string;
  changes: MilestoneTemplateChange[];
};
