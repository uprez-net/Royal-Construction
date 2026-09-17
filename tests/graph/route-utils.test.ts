import assert from "node:assert/strict";
import test from "node:test";
import { requireAdminToken } from "@/lib/graph/route-utils";

const TOKEN = "s3cr3t-admin-token";

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/graph/subscribe", {
    method: "POST",
    headers,
  });
}

// The regression this guards against: the previous implementation returned
// null (allow) whenever adminToken was falsy, so an environment missing
// GRAPH_ADMIN_TOKEN silently exposed every route relying on this guard.
test("an unconfigured token rejects instead of allowing", async () => {
  for (const configured of [undefined, ""]) {
    const result = requireAdminToken(
      req({ "x-graph-admin-token": TOKEN }),
      configured,
    );
    assert.ok(
      result,
      `expected a rejection when the configured token is ${JSON.stringify(configured)}`,
    );
    assert.equal(result.status, 401);
  }
});

test("the correct token is accepted in either header shape", () => {
  assert.equal(
    requireAdminToken(req({ "x-graph-admin-token": TOKEN }), TOKEN),
    null,
  );
  assert.equal(
    requireAdminToken(req({ authorization: `Bearer ${TOKEN}` }), TOKEN),
    null,
  );
});

test("a missing, wrong, or malformed token is rejected", async () => {
  const rejected = [
    req(),
    req({ "x-graph-admin-token": "wrong" }),
    req({ authorization: `Bearer wrong` }),
    // Right value, wrong scheme.
    req({ authorization: TOKEN }),
    req({ authorization: "Basic " + Buffer.from(TOKEN).toString("base64") }),
    // Length mismatch must not throw out of timingSafeEqual.
    req({ "x-graph-admin-token": TOKEN + "extra" }),
    req({ "x-graph-admin-token": TOKEN.slice(0, -1) }),
    req({ "x-graph-admin-token": "" }),
  ];

  for (const request of rejected) {
    const result = requireAdminToken(request, TOKEN);
    assert.ok(result, "expected a rejection");
    assert.equal(result.status, 401);
    assert.deepEqual(await result.json(), { error: "Unauthorized" });
  }
});

test("the x-graph-admin-token header wins over authorization", () => {
  // Both are accepted, so a request carrying a valid value in either header
  // must not be able to smuggle a bad one past the check in the other.
  assert.equal(
    requireAdminToken(
      req({ "x-graph-admin-token": TOKEN, authorization: "Bearer wrong" }),
      TOKEN,
    ),
    null,
  );
  const result = requireAdminToken(
    req({ "x-graph-admin-token": "wrong", authorization: `Bearer ${TOKEN}` }),
    TOKEN,
  );
  assert.ok(result);
  assert.equal(result.status, 401);
});
