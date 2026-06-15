import { z } from "zod";
import { isoDateStringSchema } from "./common";
import { LeadRichTextNode } from "@/lib/leads/types";
import { TradieScheduleStatus } from "@prisma/client";

export const paginatedLookupSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    page: z.number(),
    limit: z.number(),
    totalCount: z.number(),
    totalPages: z.number(),
  });

export const tradieItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    company: z.string().nullable(),
    tradeType: z.string(),
    phone: z.string(),
    email: z.string(),
  });

export const tradiesResponseSchema = z.array(tradieItemSchema);

export const tradieScheduleItemSchema = z.object({
  id: z.string(),

  tradieId: z.string(),
  tradieName: z.string(),

  company: z.string().nullable(),

  tradeType: z.string(),

  projectId: z.string(),
  projectName: z.string(),

  milestoneId: z.string().optional(),
  milestoneName: z.string().optional(),

  taskLabel: z.string(),

  scheduledDate: isoDateStringSchema,

  durationDays: z.number(),

  status: z.string(),

  reminderSentAt: isoDateStringSchema.optional(),

  updatedAt: isoDateStringSchema,

  hourtlyRate: z.string().optional(),

  rating: z.string().optional(),

  contact: z.object({
    email: z.string(),
    phone: z.string(),
  }),

  siteManager: z.object({
    name: z.string(),
    email: z.string(),
    phone: z.string(),
  }),
});

export const tradieUrgentReminderItemSchema = z.object({
  id: z.string(),

  tradieName: z.string(),
  tradeType: z.string(),

  projectName: z.string(),

  milestoneName: z.string().optional(),

  taskLabel: z.string(),

  scheduledDate: isoDateStringSchema,

  daysLeft: z.number(),

  status: z.string(),

  reminderSentAt: isoDateStringSchema.optional(),

  company: z.string().nullable(),

  contact: z.object({
    email: z.string(),
    phone: z.string(),
  }),

  hourtlyRate: z.string().optional(),

  rating: z.string().optional(),

  siteManager: z.object({
    name: z.string(),
    email: z.string(),
    phone: z.string(),
  }),
});

export const tradieUrgentRemindersResponseSchema = z.array(
  tradieUrgentReminderItemSchema
);

export const tradieScheduleResponseSchema = tradieScheduleItemSchema;

export const siteManagerLookupResponseSchema = paginatedLookupSchema(
  z
    .object({
      id: z.string(),
      name: z.string(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      createdAt: isoDateStringSchema,
    })
    .loose(),
);

export const projectLookupResponseSchema = paginatedLookupSchema(
  z
    .object({
      id: z.string(),
      name: z.string(),
      location: z.string().nullable(),
    })
    .loose(),
);

export const customerLookupResponseSchema = paginatedLookupSchema(
  z
    .object({
      id: z.string(),
      name: z.string(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      createdAt: isoDateStringSchema,
    })
    .loose(),
);

export const leadHistoryItemSchema = z.object({
  date: z.string(),
  time: z.string(),
  action: z.string(),
  detail: z.string(),
  type: z.enum([
    "system",
    "call",
    "email",
    "referral",
  ]),
});

export const leadRichTextNodeSchema: z.ZodType<LeadRichTextNode> = z.lazy(() =>
  z.object({
    type: z.string().optional(),
    text: z.string().optional(),
    key: z.unknown().optional(),
    value: z.unknown().optional(),
    children: z.array(leadRichTextNodeSchema).optional(),
  }).catchall(z.unknown())
);

export const leadRichTextDocumentSchema = z.object({
  version: z.literal(1),
  html: z.string(),
  plainText: z.string(),
  value: z.array(leadRichTextNodeSchema),
});

export const leadNoteAnnotationSchema = z.object({
  id: z.string(),
  selectedText: z.string(),
  comment: z.string(),
  mentionedUserIds: z.array(z.string()),
  status: z.enum(["open", "resolved"]),
  createdAt: isoDateStringSchema,
  resolvedAt: isoDateStringSchema.nullable().optional(),
});

export const leadNoteAnnotationInputSchema = z.object({
  selectedText: z.string(),
  comment: z.string(),
  mentionedUserIds: z.array(z.string()),
});

export const assignedUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

export const leadItemSchema = z.object({
  id: z.number(),

  name: z.string(),
  phone: z.string(),
  email: z.string(),
  location: z.string(),

  source: z.string(),
  sourceDetail: z.string(),

  stage: z.string(),

  assignedId: z.string().nullable().optional(),
  assignedUser: assignedUserSchema.nullable().optional(),

  budget: z.string(),

  type: z.string(),

  notes: z.string(),

  notesDoc: leadRichTextDocumentSchema.nullable().optional(),

  noteAnnotations: z
    .array(leadNoteAnnotationSchema)
    .optional(),

  followupDate: z.string().nullable(),

  followupTime: z.string().nullable(),

  followupNotes: z.string(),

  lostReason: z.string().optional(),

  history: z.array(leadHistoryItemSchema),

  created: z.string(),

  urgent: z.boolean(),

  creatingOffer: z.boolean(),

  runId: z.string().nullable(),

  runStatus: z.string().nullable(),
});

export const leadsResponseSchema = paginatedLookupSchema(leadItemSchema);
export const leadResponseSchema = leadItemSchema;
export const deleteLeadResponseSchema = z.object({ success: z.boolean() }).loose();

export const projectCustomerSchema = z
  .object({ id: z.string(), name: z.string(), email: z.string().nullable(), phone: z.string().nullable(), createdAt: isoDateStringSchema })
  .loose();

export const projectSiteManagerSchema = z
  .object({ id: z.string(), name: z.string().nullable(), email: z.string().nullable(), phone: z.string().nullable() })
  .nullable();

export const projectMilestoneSchema = z
  .object({ id: z.string(), name: z.string(), status: z.string(), order: z.number(), isPhotoRequired: z.boolean().optional() })
  .loose();

export const projectListMilestoneSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    targetDate: isoDateStringSchema,
    actualDate: isoDateStringSchema.nullable().optional(),
    status: z.string(),
    tradies: z.array(
      z
        .object({
          name: z.string(),
          company: z.string().nullable(),
          tradeType: z.string(),
        })
        .loose(),
    ),
  })
  .loose();

export const projectListItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string().nullable().optional(),
    totalBudget: z.string(),
    spent: z.string(),
    lotSize: z.string().optional(),
    customer: projectCustomerSchema,
    siteManager: projectSiteManagerSchema,
    milestones: z.array(projectListMilestoneSchema).optional(),
    milestoneCount: z.number(),
    completedMilestoneCount: z.number(),
    progressPercent: z.number(),
    approvedVariationSpend: z.string(),
  })
  .loose();

export const projectsResponseSchema = paginatedLookupSchema(projectListItemSchema);

export const variationSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    description: z.string(),
    cost: z.string(),
    requestedDate: isoDateStringSchema.optional(),
    status: z.string(),
  })
  .loose();

export const projectResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string().nullable().optional(),
    totalBudget: z.string(),
    spent: z.string(),
    customer: projectCustomerSchema,
    siteManager: projectSiteManagerSchema,
    milestones: z.array(projectMilestoneSchema).optional(),
    variations: z.array(variationSchema).optional(),
  })
  .loose();

export const projectDetailResponseSchema = projectResponseSchema.loose();
export const variationResponseSchema = variationSchema;

export const milestoneResponseSchema = projectMilestoneSchema;

export const milestoneDetailResponseSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    budget: z.string(),
    spend: z.string().optional(),
  })
  .loose();

export const milestoneUpdateResponseSchema = milestoneDetailResponseSchema;

export const milestoneAddPhotosResponseSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    files: z.array(z.object({ id: z.string() }).loose()),
  })
  .loose();

export const materialResponseSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    category: z.string(),
    quantity: z.number(),
    unitCost: z.string(),
    totalCost: z.string(),
  })
  .loose();

export const tradieCoordinationResponseSchema = z
  .object({
    pagination: z.object({ page: z.number(), limit: z.number(), totalCount: z.number(), totalPages: z.number() }).optional(),
    schedules: z.array(tradieScheduleItemSchema),
    tradeOptions: z.array(z.string()),
    statusMetrics: z.array(z.object({ label: z.string(), value: z.number(), status: z.enum(TradieScheduleStatus) })),
    tradeBreakdown: z.array(z.object({ tradeType: z.string(), total: z.number(), confirmedRate: z.number() })),
    projectAllocations: z.array(z.object({ projectId: z.string(), projectName: z.string(), allocationCount: z.number() })),
    urgentReminders: z.array(tradieUrgentReminderItemSchema)
  })
  .loose();

export const tradieScheduleWriteResponseSchema = z.object({
  id: z.string(),
}).loose();

export const updateTradieScheduleResponseSchema = z
  .object({
    schedule: z.object({ id: z.string() }).loose(),
    requiresReplacement: z.boolean(),
  })
  .loose();
