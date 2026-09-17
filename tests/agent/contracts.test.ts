import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentResultEnvelopeSchema,
  entityReferenceSchema,
} from "../../agent/lib/result-contracts";

test("entity references use a discriminated, stable ID contract", () => {
  const parsed = entityReferenceSchema.parse({
    type: "lead",
    id: "42",
    display: { label: "Harpreet Kaur", href: "/leads/42" },
  });

  assert.equal(parsed.type, "lead");
  assert.equal(parsed.id, "42");
});

test("entity references reject unknown types and external links", () => {
  assert.equal(
    entityReferenceSchema.safeParse({
      type: "customer",
      id: "42",
      display: { label: "Harpreet Kaur" },
    }).success,
    false,
  );
  assert.equal(
    entityReferenceSchema.safeParse({
      type: "lead",
      id: "42",
      display: { label: "Harpreet Kaur", href: "https://example.com" },
    }).success,
    false,
  );
});

test("result envelopes remain versioned and JSON serializable", () => {
  const result = agentResultEnvelopeSchema.parse({
    version: 1,
    kind: "entity-summary",
    entityRef: {
      type: "lead",
      id: "42",
      display: { label: "Harpreet Kaur", href: "/leads/42" },
    },
    title: "Lead summary",
    summary: "Qualified lead",
    data: { stage: "QUALIFIED", value: 250000 },
  });

  assert.doesNotThrow(() => JSON.stringify(result));
  assert.deepEqual(result.actions, []);
  assert.equal(result.requiresApproval, false);
});

test("result envelopes reject non-JSON values", () => {
  const result = agentResultEnvelopeSchema.safeParse({
    version: 1,
    kind: "entity-summary",
    title: "Lead summary",
    summary: "Qualified lead",
    data: { fetchedAt: new Date() },
  });

  assert.equal(result.success, false);
});
