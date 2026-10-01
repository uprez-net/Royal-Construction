import assert from "node:assert/strict";
import { test } from "vitest";

import { defaultComplianceSubjectAddress } from "@/lib/domain/compliance/subject-address";
import {
  siteAddressCore,
  subjectMentionsSiteAddress,
} from "@/lib/graph/certifier-subject";

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

test("a location that already names the street is used as it is", () => {
  // Staging: "PROPOSED SINGLE STOREY DWELLING AT NO.20 MASSEY STREET, ..." was
  // prefixed, and a certifier's "20 Massey St" stopped matching the file.
  for (const project of [
    {
      location: "20 Massey St, Oran Park NSW 2570, Australia",
      name: "PROPOSED SINGLE STOREY DWELLING AT NO.20 MASSEY STREET, ORAN PARK NSW 2570 LOT 9907 DP 1281760",
    },
    {
      location: "39 Cuttriss Cres, Wilton NSW 2571, Australia",
      name: "Lot 221, 39 Cuttriss Crescent, Wilton NSW 2571",
    },
    {
      location: "3/45 Example Road, Casula NSW 2170",
      name: "Unit 3 build",
    },
  ]) {
    const address = defaultComplianceSubjectAddress(project);
    assert.equal(address, project.location);
    assert.equal(
      subjectMentionsSiteAddress(`RE: Job 1234 - ${project.location}`, address),
      true,
    );
  }
});
