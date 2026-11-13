import { z } from "zod";
import { isInternalHref } from "@/utils/safe-links";

const internalHrefSchema = z.string().trim().refine(isInternalHref, {
  message: "Links must use an internal path.",
});

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
    href: internalHrefSchema.max(500).optional(),
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
        href: internalHrefSchema.max(500),
      }),
    )
    .max(20)
    .default([]),
  data: z.record(z.string(), jsonValueSchema).default({}),
  warnings: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  requiresApproval: z.boolean().default(false),
});

export type AgentResultEnvelope = z.infer<typeof agentResultEnvelopeSchema>;

/**
 * What a specialist's model is asked to write as its final answer.
 *
 * The same envelope as `agentResultEnvelopeSchema`, minus everything that
 * could reject an answer whose substance is fine: length caps, closed key
 * sets, the `kind` enum and the internal-link check. eve validates the hidden
 * `final_output` call against this schema and, when it fails, has the model
 * write the whole answer again. On staging that happened in 14 of 25
 * specialist runs: every project read wrote its 1,500-token answer two or
 * three times, about 13 seconds each, and two gave up with a four-character
 * title and summary (#429).
 *
 * The strict envelope is still what leaves `delegate`:
 * `normalizeSpecialistResult` caps, filters and folds this into it, so a long
 * answer is shortened instead of thrown away.
 */
export const specialistResultSchema = z
  .object({
    version: z.literal(1).optional(),
    kind: z
      .string()
      .describe(`One of: ${agentResultKindSchema.options.join(", ")}.`),
    entityRef: z
      .object({
        type: z
          .string()
          .describe(`One of: ${entityTypeSchema.options.join(", ")}.`),
        id: z.union([z.string(), z.number()]),
        display: z
          .object({
            label: z.string(),
            secondaryText: z.string().optional(),
            href: z.string().optional(),
          })
          .loose(),
      })
      .loose()
      .optional(),
    title: z.string().describe("A few words, for people."),
    summary: z
      .string()
      .describe("The answer for people: short, under about 800 characters."),
    actions: z
      .array(
        z
          .object({
            id: z.string(),
            label: z.string(),
            operation: z.string(),
            destructive: z.boolean().optional(),
          })
          .loose(),
      )
      .optional(),
    links: z
      .array(z.object({ label: z.string(), href: z.string() }).loose())
      .optional(),
    data: z.record(z.string(), jsonValueSchema).optional(),
    warnings: z.array(z.string()).optional(),
    requiresApproval: z.boolean().optional(),
  })
  .loose();

const ENVELOPE_KEYS: ReadonlySet<string> = new Set([
  "version",
  "kind",
  "entityRef",
  "title",
  "summary",
  "actions",
  "links",
  "data",
  "warnings",
  "requiresApproval",
]);

function clamp(value: unknown, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function jsonClone(value: unknown): JsonValue {
  try {
    return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
  } catch {
    return null;
  }
}

/**
 * A specialist's answer as the strict envelope everything downstream reads.
 *
 * Never throws: an answer that has a title and a summary is an answer, and
 * losing it to a formatting slip is the silent failure this replaces. Keys the
 * model put beside `data` are moved into it rather than dropped.
 */
export function normalizeSpecialistResult(value: unknown): AgentResultEnvelope {
  const input = record(value);
  if (!input) {
    return {
      version: 1,
      kind: "entity-summary",
      title: "Specialist result",
      summary: clamp(typeof value === "string" ? value : "", 2_000),
      actions: [],
      links: [],
      data: {},
      warnings: [],
      requiresApproval: false,
    };
  }

  const kind = agentResultKindSchema.safeParse(input.kind);
  const data: Record<string, JsonValue> = {};
  const providedData = record(input.data);
  if (providedData) {
    for (const [key, item] of Object.entries(providedData)) {
      data[key] = jsonClone(item);
    }
  }
  for (const [key, item] of Object.entries(input)) {
    if (!ENVELOPE_KEYS.has(key) && !(key in data)) data[key] = jsonClone(item);
  }

  let entityRef: EntityReference | undefined;
  const ref = record(input.entityRef);
  const display = record(ref?.display);
  if (ref && display) {
    const parsed = entityReferenceSchema.safeParse({
      type: ref.type,
      id: ref.id === undefined || ref.id === null ? "" : String(ref.id),
      display: {
        label: clamp(display.label, 200),
        ...(typeof display.secondaryText === "string"
        && display.secondaryText.trim()
          ? { secondaryText: clamp(display.secondaryText, 300) }
          : {}),
        ...(typeof display.href === "string" && isInternalHref(display.href)
          ? { href: display.href.trim().slice(0, 500) }
          : {}),
      },
    });
    if (parsed.success) entityRef = parsed.data;
  }

  const links = (Array.isArray(input.links) ? input.links : [])
    .map(record)
    .filter(
      (link): link is Record<string, unknown> =>
        link !== null
        && typeof link.href === "string"
        && link.href.trim().length <= 500
        && isInternalHref(link.href)
        && clamp(link.label, 100).length > 0,
    )
    .slice(0, 20)
    .map((link) => ({
      label: clamp(link.label, 100),
      href: (link.href as string).trim(),
    }));

  const actions = (Array.isArray(input.actions) ? input.actions : [])
    .map(record)
    .filter(
      (action): action is Record<string, unknown> =>
        action !== null
        && clamp(action.id, 100).length > 0
        && clamp(action.label, 100).length > 0
        && clamp(action.operation, 100).length > 0,
    )
    .slice(0, 12)
    .map((action) => ({
      id: clamp(action.id, 100),
      label: clamp(action.label, 100),
      operation: clamp(action.operation, 100),
      destructive: action.destructive === true,
    }));

  const warnings = (Array.isArray(input.warnings) ? input.warnings : [])
    .map((warning) => clamp(warning, 500))
    .filter((warning) => warning.length > 0)
    .slice(0, 20);

  return {
    version: 1,
    kind: kind.success ? kind.data : "entity-summary",
    ...(entityRef ? { entityRef } : {}),
    title: clamp(input.title, 200) || "Specialist result",
    summary: clamp(input.summary, 2_000),
    actions,
    links,
    data,
    warnings,
    requiresApproval: input.requiresApproval === true,
  };
}
