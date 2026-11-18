import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { missingBuildStartDocuments } from "@/lib/domain/compliance/lifecycle";
import { projectHbcfCertificateFileId } from "@/lib/domain/insurance/hbcf-claims";

// The documents a build may not start without, and where the HBCF certificate
// may be held. Cover is raised on the Overview tab, often before a certifier is
// engaged, so a certificate uploaded there is held even when the compliance file
// has nothing on its Home Insurance row.

const certificate = {
  fileId: "file-hbcf",
  fileName: "HBCF.pdf",
  url: "https://blob.example/hbcf.pdf",
  kind: "hbcfInsurance" as const,
};

describe("projectHbcfCertificateFileId", () => {
  test("reads the certificate the Overview tab records", () => {
    assert.equal(
      projectHbcfCertificateFileId({ hbcfInsuranceDocument: certificate }),
      "file-hbcf",
    );
  });

  test("falls back to the first claim document on a payload with only the list", () => {
    assert.equal(
      projectHbcfCertificateFileId({
        hbcfInsuranceDocument: null,
        hbcfClaimDocuments: [
          {
            amountConfirmed: false,
            certificateNumber: null,
            claimAmount: null,
            coverStartDate: null,
            fileId: "file-claim",
            fileName: "Claim.pdf",
            url: "https://blob.example/claim.pdf",
          },
        ],
      }),
      "file-claim",
    );
  });

  test("is null when the project holds no certificate", () => {
    assert.equal(projectHbcfCertificateFileId(null), null);
    assert.equal(projectHbcfCertificateFileId({}), null);
    assert.equal(
      projectHbcfCertificateFileId({ hbcfInsuranceDocument: null }),
      null,
    );
  });
});

describe("missingBuildStartDocuments", () => {
  test("a certificate on the project counts as held with nothing on the compliance file", () => {
    assert.deepEqual(missingBuildStartDocuments(new Set(), true), [
      "construction certificate",
    ]);
  });

  test("a Home Insurance file on the compliance file counts as held", () => {
    assert.deepEqual(
      missingBuildStartDocuments(new Set(["HOME_INSURANCE"]), false),
      ["construction certificate"],
    );
  });

  test("with neither, both are missing; a CDC answers the certificate", () => {
    assert.deepEqual(missingBuildStartDocuments(new Set(), false), [
      "construction certificate",
      "HBCF certificate",
    ]);
    assert.deepEqual(
      missingBuildStartDocuments(
        new Set(["COMPLYING_DEVELOPMENT_CERTIFICATE"]),
        true,
      ),
      [],
    );
  });
});
