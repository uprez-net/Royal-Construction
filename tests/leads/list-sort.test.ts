import assert from "node:assert/strict";
import { test } from "vitest";
import { leadListOrderBy } from "@/lib/domain/leads/list-sort";
import { readLeadListSort, LEAD_LIST_SORT_VALUES } from "@/lib/leads/list-sort";
import { leadLookupParamSchema } from "@/utils/validators/lead";
import { queryOfferGroups } from "@/lib/domain/offers/listing";
import { recordingDb } from "../architecture/domain-harness";

test("lead sorting has deterministic ascending and descending page boundaries", () => {
  for (const field of ["name", "createdAt", "updatedAt"]) {
    for (const direction of ["asc", "desc"]) {
      const sort = readLeadListSort(`${field}-${direction}`);
      assert.deepEqual(leadListOrderBy(sort), [
        { [field]: direction },
        { id: direction },
      ]);
    }
  }
  assert.deepEqual(leadListOrderBy(), [{ createdAt: "desc" }, { id: "desc" }]);
  assert.equal(readLeadListSort("invalid"), "createdAt-desc");
  assert.equal(
    leadLookupParamSchema.safeParse({ sort: "invalid" }).success,
    false,
  );
});

test("offer group sorting reaches the database before pagination and keeps search and scope", async () => {
  for (const sort of LEAD_LIST_SORT_VALUES) {
    const recorder = recordingDb({
      // "all" is every lead whose offer is not rejected (issue #450).
      "$.queryRaw": [{ leadId: 1 }],
      "lead.findMany": [],
      "lead.count": 30,
      "offer.count": 42,
    });
    const result = await queryOfferGroups(
      recorder.db,
      2,
      10,
      "smith",
      "all",
      { assignedId: "staff_1" },
      sort,
    );
    const query = recorder.calls.find(
      (call) => call.operation === "lead.findMany",
    )?.args as {
      orderBy: unknown;
      skip: number;
      take: number;
      where: { assignedId: string; OR: unknown[] };
    };
    assert.deepEqual(query.orderBy, leadListOrderBy(sort));
    assert.equal(query.skip, 10);
    assert.equal(query.take, 10);
    assert.equal(query.where.assignedId, "staff_1");
    assert.ok(query.where.OR.length > 0);
    assert.equal(result.totalCount, 30);
    assert.equal(result.totalPages, 3);
    assert.deepEqual(recorder.writes(), []);
  }
});
