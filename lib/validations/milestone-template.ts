import { ProjectStage } from "@prisma/client";
import { z } from "zod";

const activityIdSchema = z.string().trim().min(1).max(100);
const fieldsSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  projectStage: z.enum(ProjectStage),
  relatedCostLines: z
    .array(z.string().trim().max(200))
    .max(100)
    .transform((lines) => lines.filter(Boolean)),
  estimatedDays: z.number().int().min(1).max(365),
  requiredTradeTypeIds: z
    .array(activityIdSchema)
    .max(20)
    .transform((ids) => [...new Set(ids)]),
});

export const milestoneTemplateSnapshotSchema = z.strictObject({
  revision: z
    .string()
    .regex(
      /^[a-f0-9]{64}$/,
      "Read the current build sequence revision before saving.",
    ),
  activities: z
    .array(
      fieldsSchema.extend({
        id: activityIdSchema,
        order: z.number().int().positive(),
        parentId: activityIdSchema.nullable(),
      }),
    )
    .min(1)
    .max(500),
});

export const milestoneTemplateEditSchema = z.strictObject({
  revision: milestoneTemplateSnapshotSchema.shape.revision,
  changes: z
    .array(
      z.discriminatedUnion("type", [
        z.strictObject({
          type: z.literal("add"),
          activity: fieldsSchema.extend({
            id: z.string().uuid().optional(),
            parentId: activityIdSchema.nullable().default(null),
            estimatedDays: fieldsSchema.shape.estimatedDays.default(5),
            requiredTradeTypeIds:
              fieldsSchema.shape.requiredTradeTypeIds.default([]),
            relatedCostLines: fieldsSchema.shape.relatedCostLines.default([]),
          }),
        }),
        z.strictObject({
          type: z.literal("update"),
          activityId: activityIdSchema,
          patch: fieldsSchema
            .partial()
            .refine(
              (patch) =>
                Object.values(patch).some((value) => value !== undefined),
              "Choose at least one activity field to change.",
            ),
        }),
        z
          .strictObject({
            type: z.literal("move"),
            activityId: activityIdSchema,
            targetId: activityIdSchema.nullable(),
            mode: z.enum(["before", "child", "root"]),
          })
          .refine(
            (change) =>
              change.mode === "root"
                ? change.targetId === null
                : change.targetId !== null,
            "Root moves have no target; other moves need a target activity ID.",
          ),
        z.strictObject({
          type: z.literal("remove"),
          activityId: activityIdSchema,
        }),
      ]),
    )
    .min(1)
    .max(100),
});
