import assert from "node:assert/strict";

import { Role } from "@prisma/client";
import { test } from "vitest";

import {
  getAdminOfferContent,
  updateAdminOfferContentSection,
} from "@/lib/domain/admin/offer-content";
import {
  DomainAuthorizationError,
  DomainTransitionError,
} from "@/lib/domain/errors";
import { recordingDb } from "./domain-harness";

const admin = { kind: "user" as const, role: Role.ADMIN, userId: "u_admin" };
const customer = {
  kind: "user" as const,
  role: Role.CUSTOMER,
  userId: "u_customer",
};

test("admin offer content updates one section behind the version guard", async () => {
  const recorder = recordingDb({
    "adminOfferContent.findFirst": { id: "content_1" },
    "adminOfferContent.updateMany": { count: 1 },
  });

  const version = await updateAdminOfferContentSection(
    admin,
    {
      data: { buildScope: ["Site preparation"] },
      expectedVersion: 4,
    },
    recorder.db,
  );

  assert.equal(version, 5);
  const write = recorder.writes()[0].args as { data: unknown; where: unknown };
  assert.deepEqual(write.where, { id: "content_1", version: 4 });
  assert.deepEqual(write.data, {
    buildScope: ["Site preparation"],
    version: { increment: 1 },
  });
});

test("a stale admin offer-content version is a domain transition failure", async () => {
  const recorder = recordingDb({
    "adminOfferContent.findFirst": { id: "content_1" },
    "adminOfferContent.updateMany": { count: 0 },
  });

  await assert.rejects(
    () =>
      updateAdminOfferContentSection(
        admin,
        { data: { buildScope: ["Changed"] }, expectedVersion: 4 },
        recorder.db,
      ),
    DomainTransitionError,
  );
});

test("offer-content writes are administrator-only in the shared command", async () => {
  await assert.rejects(
    () =>
      updateAdminOfferContentSection(
        customer,
        { data: { buildScope: ["Not allowed"] } },
        recordingDb().db,
      ),
    DomainAuthorizationError,
  );
});

test("offer defaults can be read through the domain coercion boundary", async () => {
  const content = await getAdminOfferContent(
    customer,
    recordingDb({
      "adminOfferContent.findFirst": {
        buildScope: ["Site preparation"],
        costSchedule: { rows: [], rateConstants: {} },
        hbcfClaim: {
          claimAmount: 100,
          loadingChargePercent: 10,
          totalPremiumToBePaid: 110,
        },
        offerContent: {
          exclusions: [],
          headline: "A clear offer",
          inclusionSchedule: [],
          inclusions: [],
          introText: "Intro",
          termsAndConditions: "Terms",
        },
        offerScope: { allowances: [], exclusions: [] },
        version: 3,
      },
    }).db,
  );

  assert.equal(content.version, 3);
  assert.equal(content.hbcfClaim.totalPremiumToBePaid, 110);
});
