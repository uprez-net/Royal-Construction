import { z } from "zod";

/**
 * Zod → JSON Schema, for tool input schemas.
 *
 * WebMCP tools declare their parameters as JSON Schema, not Zod. The MCP SDK
 * does this conversion for us on the server; in the browser we do it ourselves.
 *
 * Two options matter:
 *  - `io: "input"` — several input schemas use `.default()` and `z.preprocess`
 *    (see nullableTrimmedString in utils/validators/lead.ts). We want the shape
 *    the *caller* supplies, not the shape parsing produces.
 *  - `unrepresentable: "any"` — some Zod constructs have no JSON Schema
 *    equivalent. Degrading those to `{}` is strictly better than throwing at
 *    registration time and silently costing us the whole tool list.
 *
 * Lives apart from ./json-schema so a screen registering its own tools against
 * a route validator (createLeadSchema, milestoneCreationSchema, …) can convert
 * without pulling in the shared manifest.
 */
export function toToolInputJsonSchema(schema: z.ZodType): Record<string, unknown> {
    return z.toJSONSchema(schema, {
        io: "input",
        unrepresentable: "any",
    }) as Record<string, unknown>;
}

/**
 * Converts a route validator and folds in the identifiers that travel as route
 * params over HTTP.
 *
 * `PATCH /api/projects/[projectId]/milestones/[milestoneId]/updates` validates
 * its *body* with milestoneUpdateSchema; the two ids are in the path. A tool has
 * one argument bag, so the ids have to join the body schema — and they are
 * always required, because there is no URL to carry them.
 */
export function toToolInputJsonSchemaWithParams(
    schema: z.ZodType,
    params: Record<string, { type: string; description: string }>,
): Record<string, unknown> {
    const converted = toToolInputJsonSchema(schema);
    const properties = {
        ...(converted.properties as Record<string, unknown> | undefined),
        ...params,
    };
    const required = [
        ...Object.keys(params),
        ...((converted.required as string[] | undefined) ?? []),
    ];

    return { ...converted, type: "object", properties, required };
}
