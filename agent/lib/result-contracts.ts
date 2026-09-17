import { z } from "zod";

export const entityTypeSchema = z.enum([
  "lead",
  "offer",
  "offerRevision",
  "project",
  "tradie",
  "tradieSchedule",
  "approval",
  "adminContent",
  "teamMember",
  "xeroConnection",
  "file",
  "milestone",
  "complianceDocument",
]);

export const entityReferenceSchema = z.object({
  type: entityTypeSchema,
  id: z.string().trim().min(1).max(200),
  display: z.object({
    label: z.string().trim().min(1).max(200),
    secondaryText: z.string().trim().max(300).optional(),
    href: z.string().trim().startsWith("/").max(500).optional(),
  }),
});

export type EntityReference = z.infer<typeof entityReferenceSchema>;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const agentResultKindSchema = z.enum([
  "entity-summary",
  "timeline",
  "task-list",
  "file-list",
  "confirmation",
  "milestone-list",
  "tradie-summary",
  "schedule-list",
  "admin-summary",
  "compliance-status",
  "follow-up-status",
  "error",
]);

export const agentResultEnvelopeSchema = z.object({
  version: z.literal(1),
  kind: agentResultKindSchema,
  entityRef: entityReferenceSchema.optional(),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(2_000),
  actions: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(100),
        label: z.string().trim().min(1).max(100),
        operation: z.string().trim().min(1).max(100),
        destructive: z.boolean().default(false),
      }),
    )
    .max(12)
    .default([]),
  links: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(100),
        href: z.string().trim().startsWith("/").max(500),
      }),
    )
    .max(20)
    .default([]),
  data: z.record(z.string(), jsonValueSchema).default({}),
  warnings: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  requiresApproval: z.boolean().default(false),
});

export type AgentResultEnvelope = z.infer<typeof agentResultEnvelopeSchema>;
