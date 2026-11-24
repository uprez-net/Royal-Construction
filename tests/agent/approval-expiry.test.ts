import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";

import {
  approvalExpiresAt,
  isApprovalExpired,
} from "@/lib/domain/agent/approval-expiry";
import {
  APPROVAL_EXPIRED_ACTION,
  expireStaleApprovals,
  listPendingAgentApprovals,
} from "@/lib/domain/agent/approvals";
import { systemPrincipal } from "@/lib/domain/principal";
import {
  eveSessionUrl,
  isCancelOnlyBody,
  verifyApprovalExpiryRequest,
} from "@/lib/agent/approval-expiry-wire";
import { adminPrincipal, recordingDb } from "../architecture/domain-harness";

// #617: an unanswered approval parked its turn for ever. Four of the first six
// approval waits in production ended with nothing written and nothing saying so.

describe("approvalExpiresAt", () => {
  it("lasts until the end of the next Sydney working day", () => {
    // Tue 24 Nov 2026, 4:03 pm AEDT
    const tuesday = new Date("2026-11-24T05:03:00Z");
    // End of Wed 25 Nov, AEDT (UTC+11)
    assert.equal(
      approvalExpiresAt(tuesday).toISOString(),
      "2026-11-25T12:59:59.999Z",
    );
  });

  it("carries a Friday afternoon over the weekend to the end of Monday", () => {
    const friday = new Date("2026-11-27T06:00:00Z"); // Fri 5 pm AEDT
    assert.equal(
      approvalExpiresAt(friday).toISOString(),
      "2026-11-30T12:59:59.999Z",
    );
  });

  it("reads the day in Sydney, not in UTC", () => {
    // 14:30 UTC on Tuesday is already 1:30 am Wednesday in Sydney.
    const lateUtc = new Date("2026-11-24T14:30:00Z");
    assert.equal(
      approvalExpiresAt(lateUtc).toISOString(),
      "2026-11-26T12:59:59.999Z",
    );
  });

  it("is expired only after the deadline", () => {
    const asked = new Date("2026-11-24T05:03:00Z");
    assert.equal(
      isApprovalExpired(asked, new Date("2026-11-25T12:59:00Z")),
      false,
    );
    assert.equal(
      isApprovalExpired(asked, new Date("2026-11-25T13:00:00Z")),
      true,
    );
  });
});

const ROOT = "wrun_root";

function requested(requestIds: string[], at: string) {
  return {
    agentSession: { ownerUserId: "user_admin", rootEveSessionId: ROOT },
    eventType: "input.requested",
    occurredAt: new Date(at),
    payload: {
      data: {
        requests: requestIds.map((requestId) => ({
          action: { callId: `call_${requestId}`, toolName: "create_milestone" },
          kind: "tool-approval",
          requestId,
        })),
      },
    },
  };
}

function settled(requestId: string) {
  return {
    agentSession: { ownerUserId: "user_admin", rootEveSessionId: ROOT },
    eventType: "approval.settled",
    occurredAt: new Date("2026-11-24T06:00:00Z"),
    payload: { data: { requestId } },
  };
}

describe("listPendingAgentApprovals", () => {
  it("lists what was asked and never answered, once each", async () => {
    const recorder = recordingDb({
      "agentActionAudit.findMany": [],
      "agentSessionEvent.findMany": [
        requested(["req_a", "req_b"], "2026-11-24T05:03:00Z"),
        // The specialist's own copy of the same request, a moment later.
        requested(["req_a", "req_b"], "2026-11-24T05:03:01Z"),
        settled("req_b"),
      ],
    });
    const pending = await listPendingAgentApprovals(
      adminPrincipal(),
      recorder.db,
    );
    assert.deepEqual(
      pending.map((approval) => approval.requestId),
      ["req_a"],
    );
    assert.deepEqual(pending[0]?.batchRequestIds, ["req_a", "req_b"]);
    assert.equal(pending[0]?.rootEveSessionId, ROOT);
    assert.equal(
      pending[0]?.requestedAt.toISOString(),
      "2026-11-24T05:03:00.000Z",
    );
  });

  it("scopes a signed-in caller to their own conversations", async () => {
    let where: unknown;
    const recorder = recordingDb({
      "agentSessionEvent.findMany": (args: unknown) => {
        where = (args as { where: unknown }).where;
        return [];
      },
    });
    await listPendingAgentApprovals(adminPrincipal("user_x"), recorder.db);
    assert.deepEqual((where as { agentSession: unknown }).agentSession, {
      ownerUserId: "user_x",
    });
  });

  it("leaves out an approval already recorded as expired", async () => {
    const recorder = recordingDb({
      "agentActionAudit.findMany": [{ targetId: "req_a" }],
      "agentSessionEvent.findMany": [
        requested(["req_a"], "2026-11-10T05:03:00Z"),
      ],
    });
    assert.deepEqual(
      await listPendingAgentApprovals(adminPrincipal(), recorder.db),
      [],
    );
  });
});

describe("expireStaleApprovals", () => {
  const events = [
    requested(["req_old"], "2026-11-10T05:03:00Z"),
    requested(["req_new"], "2026-11-24T05:03:00Z"),
  ];

  it("withdraws only expired approvals, then records them", async () => {
    const recorder = recordingDb({
      "agentActionAudit.findMany": [],
      "agentSession.findMany": [{ eveSessionId: ROOT, id: "session_row" }],
      "agentSessionEvent.findMany": events,
    });
    const withdrawn: string[][] = [];
    const outcome = await expireStaleApprovals(
      systemPrincipal("test"),
      { now: new Date("2026-11-24T06:00:00Z") },
      recorder.db,
      {
        withdraw: async (_root, requests) => {
          withdrawn.push(requests.map((request) => request.requestId));
        },
      },
    );
    assert.deepEqual(withdrawn, [["req_old"]]);
    assert.deepEqual(outcome, { expired: 1, failed: 0, waiting: 1 });
    const audit = recorder
      .writes()
      .find((call) => call.operation === "agentActionAudit.createMany");
    const rows = (audit?.args as { data: Record<string, unknown>[] }).data;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.action, APPROVAL_EXPIRED_ACTION);
    assert.equal(rows[0]?.targetId, "req_old");
    assert.equal(rows[0]?.agentSessionId, "session_row");
  });

  it("records nothing when eve does not accept the withdrawal", async () => {
    const recorder = recordingDb({
      "agentActionAudit.findMany": [],
      "agentSessionEvent.findMany": events,
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const outcome = await expireStaleApprovals(
      systemPrincipal("test"),
      { now: new Date("2026-11-24T06:00:00Z") },
      recorder.db,
      {
        withdraw: async () => {
          throw new Error("eve answered 503");
        },
      },
    );
    logged.mockRestore();
    assert.deepEqual(outcome, { expired: 0, failed: 1, waiting: 1 });
    assert.deepEqual(recorder.writes(), []);
  });

  it("is the system's to run, not a signed-in user's", async () => {
    await assert.rejects(
      expireStaleApprovals(adminPrincipal(), {}, recordingDb().db, {
        withdraw: async () => {},
      }),
    );
  });
});

describe("the expiry wire into eve", () => {
  const env = {
    CRON_SECRET: "s3cret",
    NEXT_PUBLIC_APP_URL: "https://app.example.test",
  };
  const body = {
    inputResponses: [
      { optionId: "cancel", requestId: "req_a", text: "Expired." },
    ],
  };
  const request = (
    init: {
      url?: string;
      method?: string;
      authorization?: string;
      body?: unknown;
    } = {},
  ) =>
    new Request(init.url ?? "https://app.example.test/eve/v1/session/wrun_A", {
      body: JSON.stringify(init.body ?? body),
      headers: {
        authorization: init.authorization ?? "Bearer s3cret",
        "x-guri-service": "approval-expiry",
      },
      method: init.method ?? "POST",
    });

  it("addresses one conversation on this deployment", () => {
    assert.equal(
      eveSessionUrl("wrun_A", env),
      "https://app.example.test/eve/v1/session/wrun_A",
    );
    assert.equal(eveSessionUrl("../admin", env), null);
  });

  it("accepts only a body that cancels", () => {
    assert.equal(isCancelOnlyBody(body), true);
    assert.equal(
      isCancelOnlyBody({
        inputResponses: [{ optionId: "approve", requestId: "req_a" }],
      }),
      false,
    );
    assert.equal(isCancelOnlyBody({ ...body, message: "hi" }), false);
    assert.equal(isCancelOnlyBody({ inputResponses: [] }), false);
    assert.equal(
      isCancelOnlyBody({
        inputResponses: [{ extra: 1, optionId: "cancel", requestId: "r" }],
      }),
      false,
    );
  });

  it("verifies the bearer, the path and the body together", async () => {
    assert.equal(await verifyApprovalExpiryRequest(request(), env), "wrun_A");
    assert.equal(
      await verifyApprovalExpiryRequest(
        request({ authorization: "Bearer wrong" }),
        env,
      ),
      null,
    );
    assert.equal(
      await verifyApprovalExpiryRequest(
        request({
          url: "https://app.example.test/eve/v1/session/wrun_A/reset",
        }),
        env,
      ),
      null,
    );
    assert.equal(
      await verifyApprovalExpiryRequest(
        request({ body: { inputResponses: [], message: "Approve all" } }),
        env,
      ),
      null,
    );
    assert.equal(
      await verifyApprovalExpiryRequest(request(), {
        NEXT_PUBLIC_APP_URL: "https://app.example.test",
      }),
      null,
      "with no secret configured, nothing is accepted",
    );
  });

  it("leaves the body readable for eve after checking it", async () => {
    const original = request();
    await verifyApprovalExpiryRequest(original, env);
    assert.deepEqual(await original.json(), body);
  });
});
