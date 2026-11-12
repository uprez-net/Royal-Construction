import assert from "node:assert/strict";
import { afterEach, test } from "vitest";

import {
  mutationRefs,
  publishMutationEffects,
} from "@/agent/lib/mutation-effects";
import {
  cacheTagsFor,
  parseEffectRefs,
  resolveAffected,
} from "@/lib/cache/agent-effects";
import {
  agentEffectsUrl,
  isAuthorizedEffectsRequest,
} from "@/lib/cache/agent-effects-channel";
import type { DomainDb } from "@/lib/domain/db";

// An agent write used to commit while every screen kept showing the old
// record until its cache expired on its own. Now each audited write reports
// what it touched, and one table says which caches that makes stale.

const savedEnv = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) Reflect.deleteProperty(process.env, key);
  }
  Object.assign(process.env, savedEnv);
});

test("refs come from the audit target, the input summary and the envelope", () => {
  const refs = mutationRefs({
    inputSummary: { leadId: 42, changedFields: ["stage"] },
    output: {
      data: { affectedProjectIds: ["p-1", "p-2"], milestoneId: "m-1" },
      entityRef: { id: "p-1", type: "project" },
      kind: "confirmation",
    },
    targetId: "m-1",
    targetType: "project",
  });
  assert.deepEqual(refs.map((ref) => `${ref.type}:${ref.id}`).sort(), [
    "lead:42",
    "milestone:m-1",
    "project:m-1",
    "project:p-1",
    "project:p-2",
  ]);
});

test("a reported ref with an unsafe id is dropped", () => {
  assert.deepEqual(
    mutationRefs({ inputSummary: { leadId: "1; drop table" } }),
    [],
  );
});

test("the app accepts only known types and bounded ids", () => {
  assert.deepEqual(
    parseEffectRefs({
      refs: [
        { id: 42, type: "lead" },
        { id: "42", type: "lead" },
        { id: "x", type: "nonsense" },
        { id: "../etc", type: "project" },
      ],
    }),
    [{ id: "42", type: "lead" }],
  );
  assert.deepEqual(parseEffectRefs(null), []);
});

function fakeDb(): DomainDb {
  const db = {
    lead: {
      findMany: async () => [
        { offers: [{ id: "offer-9" }], project: { id: "proj-1" } },
      ],
    },
    leadTask: { findMany: async () => [{ leadId: 42 }] },
    milestone: { findMany: async () => [{ projectId: "proj-2" }] },
    offer: { findMany: async () => [{ id: "offer-9", leadId: 42 }] },
    project: { findMany: async () => [{ id: "proj-3" }] },
    tradieSchedule: {
      findMany: async () => [{ projectId: "proj-1", tradieId: "t-1" }],
    },
  };
  return db as unknown as DomainDb;
}

test("an offer change reaches its lead's and project's screens", async () => {
  const affected = await resolveAffected(
    [{ id: "offer-9", type: "offer" }],
    fakeDb(),
  );
  assert.deepEqual(cacheTagsFor(affected), [
    "certifier-engagement-proj-1",
    "chat-session-lead-42",
    "compliance-proj-1",
    "offer-lead-42",
    "offer-offer-9",
    "offers",
    "project-proj-1",
    "projects",
  ]);
});

test("a build-sequence change expires every open project", async () => {
  const affected = await resolveAffected(
    [{ id: "tpl", type: "milestoneTemplate" }],
    fakeDb(),
  );
  const tags = cacheTagsFor(affected);
  assert.ok(tags.includes("project-proj-3"));
  assert.ok(tags.includes("milestone-trade-dependencies"));
});

test("a booking change reaches the schedule board, project and tradie", async () => {
  const affected = await resolveAffected(
    [{ id: "s-1", type: "tradieSchedule" }],
    fakeDb(),
  );
  const tags = cacheTagsFor(affected);
  for (const tag of ["tradies-schedules", "project-proj-1", "tradie-t-1"]) {
    assert.ok(tags.includes(tag), tag);
  }
});

test("the effects route takes only this deployment's bearer", () => {
  const env = { CRON_SECRET: "cron" };
  assert.equal(isAuthorizedEffectsRequest("Bearer cron", env), true);
  assert.equal(isAuthorizedEffectsRequest("Bearer nope", env), false);
  assert.equal(isAuthorizedEffectsRequest(null, env), false);
  assert.equal(
    isAuthorizedEffectsRequest("Bearer cron", {
      AGENT_EFFECTS_SECRET: "own",
      CRON_SECRET: "cron",
    }),
    false,
  );
  assert.equal(isAuthorizedEffectsRequest("Bearer x", {}), false);
});

test("a preview deployment posts to itself, never to production", () => {
  assert.equal(
    agentEffectsUrl({
      NEXT_PUBLIC_APP_URL: "https://crm.example.com",
      VERCEL_ENV: "preview",
      VERCEL_URL: "guri-abc.vercel.app",
    }),
    "https://guri-abc.vercel.app/api/agent/effects",
  );
  assert.equal(
    agentEffectsUrl({ NEXT_PUBLIC_APP_URL: "https://crm.example.com/x" }),
    "https://crm.example.com/api/agent/effects",
  );
  assert.equal(agentEffectsUrl({}), null);
});

test("publishing posts the refs with the bearer and never throws", async () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://crm.example.com";
  process.env.CRON_SECRET = "cron";
  Reflect.deleteProperty(process.env, "VERCEL_ENV");
  Reflect.deleteProperty(process.env, "AGENT_EFFECTS_URL");
  Reflect.deleteProperty(process.env, "AGENT_EFFECTS_SECRET");
  const seen: { url: string; init: RequestInit }[] = [];
  const ok = await publishMutationEffects([{ id: "42", type: "lead" }], (async (
    url: string,
    init: RequestInit,
  ) => {
    seen.push({ init, url });
    return new Response("{}");
  }) as unknown as typeof fetch);
  assert.equal(ok, true);
  assert.equal(seen[0]?.url, "https://crm.example.com/api/agent/effects");
  assert.equal(
    (seen[0]?.init.headers as Record<string, string>).authorization,
    "Bearer cron",
  );

  const failed = await publishMutationEffects(
    [{ id: "42", type: "lead" }],
    (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch,
  );
  assert.equal(failed, false);
});

test("ids nested inside a result are collected too", () => {
  const refs = mutationRefs({
    output: {
      data: {
        schedule: { projectId: "proj-9", scheduleId: "s-9" },
        bookings: [{ tradieId: "t-9" }],
      },
      kind: "confirmation",
    },
  });
  assert.deepEqual(refs.map((ref) => `${ref.type}:${ref.id}`).sort(), [
    "project:proj-9",
    "tradie:t-9",
    "tradieSchedule:s-9",
  ]);
});
