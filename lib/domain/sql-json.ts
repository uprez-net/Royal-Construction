import { Prisma } from "@prisma/client";

// Reads that build their result as JSON in Postgres (`jsonb_agg`,
// `to_jsonb(row)`) pay one round trip instead of Prisma's statement per
// relation per level. JSON has no Date and no Decimal, so the result is turned
// back into exactly what Prisma would have returned, using Prisma's own
// description of each model. Issue #411 has the measurements.

type FieldInfo = { kind: string; type: string; isList: boolean };

const MODELS = new Map<string, Map<string, FieldInfo>>(
  Prisma.dmmf.datamodel.models.map((model) => [
    model.name,
    new Map(
      model.fields.map((field) => [
        field.name,
        { kind: field.kind, type: field.type, isList: field.isList },
      ]),
    ),
  ]),
);

/**
 * `value`, a row of `model` (or a list of them) as JSON, with Prisma's types
 * restored: a `DateTime` becomes a `Date`, a `Decimal` a `Prisma.Decimal`, and
 * relations are walked by their own model. Keys the model does not have are
 * passed through untouched.
 */
export function reviveRow(value: unknown, model: string): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => reviveRow(item, model));
  const fields = MODELS.get(model);
  if (!fields) throw new Error(`reviveRow: no model named ${model}`);
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const field = fields.get(key);
    if (!field || raw === null) {
      out[key] = raw;
    } else if (field.kind === "object") {
      out[key] = reviveRow(raw, field.type);
    } else if (field.type === "DateTime") {
      out[key] = field.isList
        ? (raw as string[]).map(toDate)
        : toDate(raw as string);
    } else if (field.type === "Decimal") {
      out[key] = field.isList
        ? (raw as (string | number)[]).map((item) => new Prisma.Decimal(item))
        : new Prisma.Decimal(raw as string | number);
    } else {
      out[key] = raw;
    }
  }
  return out;
}

/**
 * Every `DateTime` in this schema is a `timestamp(3)` holding UTC with no
 * offset, and `to_jsonb` prints it without one, so the `Z` is put back. A
 * value that already carries an offset is read as it is.
 */
function toDate(text: string): Date {
  return new Date(/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(text) ? text : `${text}Z`);
}
