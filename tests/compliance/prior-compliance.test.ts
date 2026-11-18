import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import { describe, test } from "vitest";

import {
  activateAfterPriorCompliance,
  openPriorComplianceFile,
} from "@/lib/domain/compliance/prior-compliance";
import { isRecordedOutsideCrm } from "@/lib/domain/compliance/recorded-outside";
import { assessOverdueConditions } from "@/lib/domain/compliance/overdue";
import {
  DomainAuthorizationError,
  DomainValidationError,
} from "@/lib/domain/errors";
import type { CertifierEngagementDetail } from "@/types/compliance";

import { adminPrincipal, recordingDb } from "../architecture/domain-harness";

// Compliance done before the job came into the CRM: a compliance file with no
// certifier, opened at COMPLETED, holding the documents the office uploads.
// The job moves to Active once its certificate and HBCF cover are both held.

const PROJECT = "project-1";

/** What `authorizeComplianceAccess` reads. */
function accessRow(engagement: { id: string; status: string } | null) {
  return {
    id: PROJECT,
    customerId: "customer-1",
    siteManagerId: null,
    location: "1 Example St, Oran Park NSW",
    Lead: null,
    certifierEngagement: engagement,
  };
}

describe("isRecordedOutsideCrm", () => {
  test("a file with no certifier was recorded as done elsewhere", () => {
    assert.equal(isRecordedOutsideCrm({ certifierEmail: null }), true);
    assert.equal(
      isRecordedOutsideCrm({ certifierEmail: "pc@certifier.example" }),
      false,
    );
    assert.equal(isRecordedOutsideCrm(null), false);
  });
});

describe("openPriorComplianceFile", () => {
  test("opens a COMPLETED file with no certifier and no required rows", async () => {
    const recorder = recordingDb({
      "project.findUnique": accessRow(null),
      "certifierEngagement.findUnique": null,
      "certifierEngagement.create": { id: "engagement-1" },
    });
    const result = await openPriorComplianceFile(
      adminPrincipal(),
      { projectId: PROJECT },
      recorder.transactionalDb,
    );
    assert.deepEqual(result, { engagementId: "engagement-1", opened: true });
    const [create] = recorder.writes();
    const data = (create.args as { data: Record<string, unknown> }).data;
    assert.equal(data.status, "COMPLETED");
    assert.equal(data.certifierEmail, null);
    assert.equal(data.documents, undefined);
  });

  test("reuses the file already recorded this way", async () => {
    const recorder = recordingDb({
      "project.findUnique": accessRow({
        id: "engagement-1",
        status: "COMPLETED",
      }),
      "certifierEngagement.findUnique": {
        id: "engagement-1",
        certifierEmail: null,
      },
    });
    const result = await openPriorComplianceFile(
      adminPrincipal(),
      { projectId: PROJECT },
      recorder.transactionalDb,
    );
    assert.deepEqual(result, { engagementId: "engagement-1", opened: false });
    assert.deepEqual(recorder.writes(), []);
  });

  test("is refused when a certifier is engaged, and writes nothing", async () => {
    const recorder = recordingDb({
      "project.findUnique": accessRow({
        id: "engagement-1",
        status: "OUTREACH_SENT",
      }),
      "certifierEngagement.findUnique": {
        id: "engagement-1",
        certifierEmail: "pc@certifier.example",
      },
    });
    await assert.rejects(
      openPriorComplianceFile(
        adminPrincipal(),
        { projectId: PROJECT },
        recorder.transactionalDb,
      ),
      DomainValidationError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("a customer who can see the file cannot record it as done", async () => {
    const recorder = recordingDb({ "project.findUnique": accessRow(null) });
    await assert.rejects(
      openPriorComplianceFile(
        {
          kind: "user",
          role: Role.CUSTOMER,
          userId: "user_customer",
          customerId: "customer-1",
        } as never,
        { projectId: PROJECT },
        recorder.transactionalDb,
      ),
      DomainAuthorizationError,
    );
    assert.deepEqual(recorder.writes(), []);
  });
});

describe("activateAfterPriorCompliance", () => {
  const priorProject = (
    status: string,
    documents: { documentType: string; files: number }[],
    hbcfOnProject = false,
  ) => ({
    status,
    requirements: hbcfOnProject
      ? {
          legalAdministration: {
            hbcfInsuranceDocument: {
              fileId: "file-hbcf",
              fileName: "HBCF.pdf",
              url: "https://blob.example/hbcf.pdf",
              kind: "hbcfInsurance",
            },
          },
        }
      : {},
    certifierEngagement: {
      certifierEmail: null,
      documents: documents.map((document) => ({
        documentType: document.documentType,
        _count: { files: document.files },
      })),
    },
  });

  const run = (project: unknown, moved = 1) => {
    const recorder = recordingDb({
      "project.findUnique": accessRow({
        id: "engagement-1",
        status: "COMPLETED",
      }),
      "project.findUniqueOrThrow": project,
      "project.updateMany": { count: moved },
    });
    return {
      recorder,
      result: activateAfterPriorCompliance(
        adminPrincipal(),
        { projectId: PROJECT },
        recorder.db,
      ),
    };
  };

  test("a CDC and the HBCF certificate held on the project make the job Active", async () => {
    const { recorder, result } = run(
      priorProject(
        "DRAFT",
        [{ documentType: "COMPLYING_DEVELOPMENT_CERTIFICATE", files: 1 }],
        true,
      ),
    );
    assert.deepEqual(await result, {
      status: "ACTIVE",
      activated: true,
      missing: [],
    });
    const [update] = recorder.writes();
    assert.equal(update.operation, "project.updateMany");
    assert.deepEqual((update.args as { data: unknown }).data, {
      status: "ACTIVE",
    });
  });

  test("without the HBCF certificate the status is left, and says why", async () => {
    const { recorder, result } = run(
      priorProject("DRAFT", [
        { documentType: "CONSTRUCTION_CERTIFICATE", files: 1 },
      ]),
    );
    assert.deepEqual(await result, {
      status: "DRAFT",
      activated: false,
      missing: ["HBCF certificate"],
    });
    assert.deepEqual(recorder.writes(), []);
  });

  test("a job already Active, Delayed or finished is never moved", async () => {
    const { recorder, result } = run(
      priorProject("DELAYED", [
        { documentType: "CONSTRUCTION_CERTIFICATE", files: 1 },
        { documentType: "HOME_INSURANCE", files: 1 },
      ]),
    );
    assert.equal((await result).activated, false);
    assert.deepEqual(recorder.writes(), []);
  });

  test("is refused on a file run with a certifier", async () => {
    const { recorder, result } = run({
      ...priorProject("DRAFT", []),
      certifierEngagement: {
        certifierEmail: "pc@certifier.example",
        documents: [],
      },
    });
    await assert.rejects(result, DomainValidationError);
    assert.deepEqual(recorder.writes(), []);
  });
});

describe("the nightly overdue sweep", () => {
  test("raises nothing on compliance done before the CRM", () => {
    const engagement = {
      id: "engagement-1",
      projectId: PROJECT,
      status: "COMPLETED",
      certifierEmail: null,
      createdAt: new Date("2024-01-01T00:00:00Z"),
      updatedAt: new Date("2024-01-01T00:00:00Z"),
      documents: [],
      emails: [],
      outreaches: [],
      alerts: [],
      externalApplications: [],
    } as unknown as CertifierEngagementDetail;
    assert.deepEqual(
      assessOverdueConditions(engagement, new Date("2026-11-18T00:00:00Z")),
      { raise: [], resolve: [] },
    );
  });
});
