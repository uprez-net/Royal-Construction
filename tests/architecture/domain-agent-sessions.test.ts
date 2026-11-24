import assert from "node:assert/strict";
import { test } from "vitest";

import { getAgentWorkspaceData } from "@/lib/domain/agent/sessions";
import { adminPrincipal, recordingDb } from "./domain-harness";

test("agent workspace reads only root sessions owned by the principal", async () => {
  const createdAt = new Date("2026-09-21T10:00:00.000Z");
  const recorder = recordingDb({
    "agentSession.findFirst": { eveSessionId: "eve_1" },
    // No approvals waiting (#617).
    "agentSessionEvent.findMany": [],
    "agentSession.findMany": [
      {
        agentName: "Royal assistant",
        createdAt,
        eveSessionId: "eve_1",
        lastEventAt: null,
        selectedContext: {
          annotationsByTurn: {
            turn_1: [
              {
                group: "lead",
                href: "/leads/1",
                id: "1",
                label: "Lead",
                type: "lead",
              },
            ],
          },
        },
        status: "ACTIVE",
        summary: "A session",
        title: "A title",
        updatedAt: createdAt,
      },
    ],
  });

  const result = await getAgentWorkspaceData(
    adminPrincipal("owner_1"),
    "eve_1",
    recorder.db,
  );

  assert.equal(result.sessions[0]?.eveSessionId, "eve_1");
  assert.equal(result.sessions[0]?.pendingApprovals, 0);
  const approvals = recorder.calls.find(
    (call) => call.operation === "agentSessionEvent.findMany",
  );
  assert.deepEqual(
    (approvals?.args as { where: { agentSession: unknown } }).where
      .agentSession,
    { ownerUserId: "owner_1", rootEveSessionId: { in: ["eve_1"] } },
    "the approvals read is scoped to the caller's own listed conversations",
  );
  assert.deepEqual(result.selectedAnnotationsByTurn.turn_1, [
    {
      group: "lead",
      href: "/leads/1",
      id: "1",
      label: "Lead",
      type: "lead",
    },
  ]);
  const query = recorder.calls.find(
    (call) => call.operation === "agentSession.findMany",
  );
  assert.deepEqual((query?.args as { where: unknown }).where, {
    archivedAt: null,
    ownerUserId: "owner_1",
    parentEveSessionId: null,
  });
});
