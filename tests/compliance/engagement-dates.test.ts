import assert from "node:assert/strict";

import {
  ComplianceDocumentType,
  ComplianceOutreachMode,
  ComplianceOutreachStatus,
  CompliancePartyType,
} from "@prisma/client";
import { test } from "vitest";

import { reviveComplianceEngagementDates } from "@/lib/domain/compliance/engagement-dates";
import { complianceStageFlow } from "@/lib/domain/compliance/stage-flow";
import type { CertifierEngagementDetail } from "@/types/compliance";

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

/**
 * A surveyor mid-outreach, as JSON leaves them.
 *
 * The stage flow measures this outreach in Sydney business days, and a
 * business day is counted off an instant rather than off text -- so the string
 * JSON leaves behind reaches `Intl.DateTimeFormat.formatToParts`, which throws
 * rather than returning anything. Nothing about the shape says so: every other
 * consumer of the engagement reformats its dates and takes a string happily.
 */
const apiSurveyorOutreach = () =>
  ({
    ...apiEngagement(),
    documents: [],
    outreaches: [
      {
        id: "outreach-surveyor",
        party: CompliancePartyType.SURVEYOR,
        mode: ComplianceOutreachMode.OUTREACH,
        status: ComplianceOutreachStatus.SENT,
        sentAt: "2026-09-14T00:00:00.000Z",
        emails: [],
        meetings: [],
        revisions: [],
        deliverables: [],
      },
    ],
  }) as unknown as CertifierEngagementDetail;

test("a stringly-dated outreach is what takes the stage flow down", () => {
  // Pinned so the reason the store revives on the way in stays written down.
  // A PATCH of /api/projects/:id -- the Overview tab's save, the insurance
  // claim dates modal -- hands the whole project back as JSON, and before
  // `setActiveProject` normalised it the Compliance tab threw
  // "RangeError: Invalid time value" on the next render and took the project
  // page with it.
  assert.throws(
    () => complianceStageFlow(apiSurveyorOutreach(), new Date()),
    RangeError,
  );
});

test("the revived outreach carries the clock the Dates would have", () => {
  const revived = reviveComplianceEngagementDates(apiSurveyorOutreach());
  assert.ok(revived);

  const now = new Date("2026-09-21T00:00:00.000Z");
  const surveyor = complianceStageFlow(revived, now).find(
    (stage) => stage.id === "SURVEYOR",
  );

  assert.ok(surveyor);
  // Monday 14 September to Monday 21 September, five working days apart.
  assert.equal(surveyor.elapsedBusinessDays, 5);
});
