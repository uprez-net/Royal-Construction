import assert from "node:assert/strict";
import test from "node:test";

import { ComplianceDocumentType } from "@prisma/client";

import { reviveComplianceEngagementDates } from "../../lib/compliance/engagement-dates";
import { complianceStageFlow } from "../../lib/compliance/stage-flow";
import type { CertifierEngagementDetail } from "../../types/compliance";

const apiEngagement = () =>
  ({
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
    documents: [
      {
        documentType: ComplianceDocumentType.SURVEY,
        createdAt: "2026-09-14T00:00:00.000Z",
        updatedAt: "2026-09-14T00:00:00.000Z",
        files: [
          {
            createdAt: "2026-09-14T00:00:00.000Z",
            updatedAt: "2026-09-14T00:00:00.000Z",
          },
        ],
      },
    ],
    emails: [],
    outreaches: [
      {
        sentAt: "2026-09-14T00:00:00.000Z",
        meetings: [
          {
            scheduledFor: "2026-09-15T00:00:00.000Z",
            heldAt: null,
          },
        ],
      },
    ],
    externalApplications: [
      {
        appliedAt: "2026-09-14T00:00:00.000Z",
        submissions: [{ submittedAt: "2026-09-14T00:00:00.000Z" }],
      },
    ],
    alerts: [
      {
        createdAt: "not-a-date",
        resolvedAt: "not-a-date",
      },
    ],
  }) as unknown as CertifierEngagementDetail;

test("revives compliance dates returned as JSON strings", () => {
  const revived = reviveComplianceEngagementDates(apiEngagement());

  assert.ok(revived);
  assert.ok(revived.createdAt instanceof Date);
  assert.ok(revived.documents[0].files[0].createdAt instanceof Date);
  assert.ok(revived.outreaches[0].meetings[0].scheduledFor instanceof Date);
  assert.ok(
    revived.externalApplications[0].submissions[0].submittedAt instanceof Date,
  );
});

test("the revived engagement can drive the stage flow after a mutation", () => {
  const revived = reviveComplianceEngagementDates(apiEngagement());

  assert.doesNotThrow(() => complianceStageFlow(revived!, new Date()));
});

test("invalid compliance dates become null", () => {
  const revived = reviveComplianceEngagementDates(apiEngagement());

  assert.ok(revived);
  assert.equal(revived.alerts[0].createdAt, null);
  assert.equal(revived.alerts[0].resolvedAt, null);
});

test("leaves an engagement with Date values usable", () => {
  const original = reviveComplianceEngagementDates({
    ...apiEngagement(),
    createdAt: new Date("2026-09-14T00:00:00.000Z"),
  });

  assert.ok(original);
  assert.equal(original.createdAt.toISOString(), "2026-09-14T00:00:00.000Z");
});
