import { MilestoneStatus } from "@prisma/client";
import { z } from "zod";


const dateField = z
    .string()
    .trim()
    .refine((date) => !isNaN(Date.parse(date)), {
        message: "Invalid date format",
    });

export const milestoneCreationSchema = z.object({
    name: z.string().min(1, "Milestone name is required"),
    description: z.string().optional(),
    targetDate: dateField,
    budget: z.coerce.number().positive("Budget must be a positive number"),
    parentId: z.string().optional(),
});

export type MilestoneCreationData = z.infer<typeof milestoneCreationSchema>;

export const milestoneUpdateSchema = z
    .object({
        status: z.enum(MilestoneStatus),

        // Required when milestone becomes ACTIVE or DONE
        startDate: dateField.optional(),

        // Required only when DONE
        actualDate: dateField.optional(),

        // Required only when DONE
        spend: z.coerce
            .number({
                message: "Spend must be a number",
            })
            .positive("Spend must be greater than 0")
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
                    message: "Spend is required when milestone is completed",
                });
            }

            // Optional extra validation
            if (
                startDate &&
                actualDate &&
                new Date(actualDate) < new Date(startDate)
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

export type MilestonePictureUploadData = z.infer<typeof milestonePictureUploadSchema>;