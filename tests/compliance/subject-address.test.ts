import assert from "node:assert/strict";
import { test } from "vitest";

import { defaultComplianceSubjectAddress } from "@/lib/domain/compliance/subject-address";
import { siteAddressCore } from "@/lib/graph/certifier-subject";

test("a new engagement is filed under the street, not just the suburb", () => {
  // #366: outreach went out as "[RCBSIX-…] Catherine Field NSW 2557, Australia".
  const project = {
    location: "Catherine Field NSW 2557, Australia",
    name: "Lot 9028 Sommerville Drive",
  };

  const address = defaultComplianceSubjectAddress(project);

  assert.equal(
    address,
    "Lot 9028 Sommerville Drive, Catherine Field NSW 2557, Australia",
  );
  // What inbound replies are matched on: the street, not "catherine field".
  assert.deepEqual(siteAddressCore(address), [
    "lot",
    "9028",
    "sommerville",
    "drive",
  ]);
});

test("an address already carried by one field is not repeated", () => {
  assert.equal(
    defaultComplianceSubjectAddress({
      location: "20 Massey St, Oran Park NSW 2570",
      name: "20 Massey St",
    }),
    "20 Massey St, Oran Park NSW 2570",
  );
  assert.equal(
    defaultComplianceSubjectAddress({
      location: "Wilton NSW 2571",
      name: "Lot 221, 39 Cuttriss Crescent, Wilton NSW 2571",
    }),
    "Lot 221, 39 Cuttriss Crescent, Wilton NSW 2571",
  );
  assert.equal(
    defaultComplianceSubjectAddress({ location: "Casula NSW 2170", name: " " }),
    "Casula NSW 2170",
  );
});
