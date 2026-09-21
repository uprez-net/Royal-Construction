import assert from "node:assert/strict";
import { test } from "node:test";

import { getActiveHbcfClaims } from "../../lib/domain/insurance/hbcf";
import { recordingDb } from "./domain-harness";

test("active HBCF claims are read through the explicit domain database", async () => {
  const claims = await getActiveHbcfClaims(
    recordingDb({
      "project.findMany": [
        {
          id: "p_later",
          name: "Later build",
          totalBudget: 400000,
          requirements: {
            legalAdministration: {
              insuranceClaimEndDate: "2027-06-30",
              insuranceClaimStartDate: "2027-01-01",
            },
            commercialsAndClaims: { totalContractSum: 410000 },
          },
          Lead: { name: "Jones" },
        },
        {
          id: "p_earlier",
          name: "Earlier build",
          totalBudget: 300000,
          requirements: {
            legalAdministration: {
              insuranceClaimEndDate: "2026-12-31",
              insuranceClaimStartDate: "2026-01-01",
            },
          },
          Lead: null,
        },
      ],
    }).db,
  );

  assert.deepEqual(
    claims.map((claim) => [claim.projectId, claim.claimAmount, claim.leadName]),
    [
      ["p_earlier", 300000, null],
      ["p_later", 410000, "Jones"],
    ],
  );
});
