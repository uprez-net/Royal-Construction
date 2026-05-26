import { z } from "zod";

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
    company: z.string().nullable().optional(),
    tradeType: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
  })
  .loose();

export const tradiesResponseSchema = z.array(tradieItemSchema);

export const tradieScheduleItemSchema = z
  .object({
    id: z.string(),
    tradieId: z.string().optional(),
    tradieName: z.string().optional(),
    projectId: z.string().optional(),
    projectName: z.string().optional(),
    milestoneId: z.string().nullable().optional(),
    milestoneName: z.string().nullable().optional(),
    scheduledDate: z.string(),
    durationDays: z.number().optional(),
    status: z.string(),
  })
  .loose();

export const tradieScheduleResponseSchema = tradieScheduleItemSchema;

export const siteManagerLookupResponseSchema = paginatedLookupSchema(
  z
    .object({
      id: z.string(),
      name: z.string(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      createdAt: z.date(),
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
      createdAt: z.date(),
    })
    .loose(),
);

export const leadHistoryItemSchema = z
  .object({
    action: z.string(),
    detail: z.string().optional(),
    type: z.string(),
    actionDate: z.string().or(z.date()),
  })
  .loose();

export const leadItemSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    phone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
    stage: z.string().nullable().optional(),
    assigned: z.string().nullable().optional(),
    createdAt: z.date(),
    history: z.array(leadHistoryItemSchema).optional(),
  })
  .loose();

export const leadsResponseSchema = z.array(leadItemSchema);
export const leadResponseSchema = leadItemSchema;
export const deleteLeadResponseSchema = z.object({ success: z.boolean() }).loose();

export const projectCustomerSchema = z
  .object({ id: z.string(), name: z.string(), email: z.string().nullable(), phone: z.string().nullable(), createdAt: z.date() })
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
    targetDate: z.date(),
    actualDate: z.date().nullable(),
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
    requestedDate: z.date().optional(),
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
    query: z.object({}).optional(),
    pagination: z.object({ page: z.number(), limit: z.number(), totalCount: z.number(), totalPages: z.number() }).optional(),
    schedules: z.array(tradieScheduleItemSchema),
    summary: z.object({}).optional(),
    tabCounts: z.record(z.string(), z.number()).optional(),
    tradeOptions: z.array(z.string()).optional(),
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
