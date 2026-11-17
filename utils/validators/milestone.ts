import { MilestoneStatus, ProjectStage } from "@prisma/client";
import { z } from "zod";

import { hasAtMostTwoDecimalPlaces } from "./common";

export const milestoneCreationSchema = z.object({
  name: z.string().min(1, "Milestone name is required"),
  description: z.string().optional(),
  targetDate: z.iso.date(),
  budget: z.coerce.number().positive("Budget must be a positive number"),
  parentId: z.string().optional(),
  // Project Stage
  projectStage: z.enum(ProjectStage),
});

export type MilestoneCreationData = z.infer<typeof milestoneCreationSchema>;

export const milestoneUpdateSchema = z
  .object({
    status: z.enum(MilestoneStatus),

    // The date this activity is due. Seeded activities get an auto-spaced
    // placeholder (project start + order * 4 days), so it has to be
    // editable or "overdue" is measured against a date nobody chose.
    targetDate: z.iso.date().optional(),

    // Required when milestone becomes ACTIVE or DONE
    startDate: z.iso.date().optional(),

    // Required only when DONE
    actualDate: z.iso.date().optional(),

    // Required only when DONE
    spend: z.coerce
      .number({
        message: "Spend must be a number",
      })
      .nonnegative("Spend cannot be negative")
      .optional(),
  })
  .superRefine((data, ctx) => {
    const { status, startDate, actualDate, spend } = data;

    // ACTIVE milestone validation
    if (status === "ACTIVE") {
      if (!startDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["startDate"],
          message: "Start date is required when milestone is active",
        });
      }
      return; // No need to check further if status is ACTIVE
    }

    // DONE milestone validation
    if (status === "DONE") {
      if (!startDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["startDate"],
          message: "Start date is required when milestone is completed",
        });
      }

      if (!actualDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["actualDate"],
          message: "Actual completion date is required",
        });
      }

      if (spend === undefined || spend === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["spend"],
          message: "Spend is required when a milestone is completed",
        });
      }

      // Optional extra validation
      if (
        startDate
        && actualDate
        && new Date(actualDate) < new Date(startDate)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["actualDate"],
          message: "Completion date cannot be before start date",
        });
      }
    }
  });

export type MilestoneUpdateData = z.infer<typeof milestoneUpdateSchema>;

export const milestonePictureUploadSchema = z.object({
  fileIds: z.array(z.string()).min(1, "At least one file must be uploaded"),
});

export type MilestonePictureUploadData = z.infer<
  typeof milestonePictureUploadSchema
>;

/**
 * The Financials tab's inline price edit. Dollars as typed, to the cent; the
 * action converts to cents. `previousPriceCents` is the figure on screen, so
 * the command can refuse an edit made over a price that has since moved.
 */
export const milestonePriceSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  milestoneId: z.string().min(1, "Milestone ID is required"),
  price: z
    .number({ error: "Enter a price" })
    .nonnegative("The price cannot be negative")
    .refine(hasAtMostTwoDecimalPlaces, "Enter the price to the cent"),
  previousPriceCents: z.number().int().nonnegative(),
});

export type MilestonePriceInput = z.infer<typeof milestonePriceSchema>;

/**
 * The Financials tab's inline edit of an activity's own tradie quoted or total
 * invoiced figure, ex GST. `amount` null clears it back to what the bookings
 * say; `previousCents` is the typed figure on screen, null when there was none.
 */
export const milestoneTradieFigureSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  milestoneId: z.string().min(1, "Milestone ID is required"),
  figure: z.enum(["quoted", "invoiced"]),
  amount: z
    .number({ error: "Enter an amount" })
    .nonnegative("The amount cannot be negative")
    .refine(hasAtMostTwoDecimalPlaces, "Enter the amount to the cent")
    .nullable(),
  previousCents: z.number().int().nonnegative().nullable(),
});

export type MilestoneTradieFigureInput = z.infer<
  typeof milestoneTradieFigureSchema
>;
