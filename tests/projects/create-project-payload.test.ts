import assert from "node:assert/strict";
import { test } from "node:test";

import { createProjectWithLeadSchema } from "../../utils/validators/projects";

// createProjectWithLeadAction hands the browser's payload straight to
// createProjectWithLead, which writes `parties` onto Project.parties, trusts
// siteManagerId and runs new Date() over both date strings. The schema guards
// that boundary — and these fixtures are the shape the create-project wizard
// actually sends (components/projects/create-project-modal.tsx), because a
// schema that rejects the only caller takes the whole handoff down without a
// single test failing.

const wizardPayload = () => ({
  projectName: "42 Example St",
  leadId: 12,
  lotSize: 0,
  // format(new Date(), "yyyy-MM-dd") — date-only, never a datetime.
  startDate: "2026-09-17",
  estimatedEndDate: "2027-05-17",
  address: "42 Example St, Sydney",
  council: "Inner West",
  siteManagerId: "user_2abc",
  extraction: { legalAdministrationSiteAddress: "42 Example St" },
  sourceDocuments: {
    tender: {
      fileId: "f1",
      fileName: "tender.pdf",
      url: "https://x.public.blob.vercel-storage.com/t.pdf",
      kind: "tender",
    },
    contract: {
      fileId: "f2",
      fileName: "contract.pdf",
      url: "https://x.public.blob.vercel-storage.com/c.pdf",
      kind: "contract",
    },
  },
  confirmDateBlockers: false,
});

test("the wizard's own payload passes", () => {
  const result = createProjectWithLeadSchema.safeParse(wizardPayload());
  assert.equal(
    result.success,
    true,
    result.success
      ? ""
      : result.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
  );
});

test("dates take yyyy-MM-dd and a full ISO datetime alike", () => {
  for (const [startDate, estimatedEndDate] of [
    ["2026-09-17", "2027-05-17"],
    ["2026-09-17T00:00:00.000Z", "2027-05-17T00:00:00.000Z"],
  ]) {
    const result = createProjectWithLeadSchema.safeParse({
      ...wizardPayload(),
      startDate,
      estimatedEndDate,
    });
    assert.equal(result.success, true, `${startDate} was refused`);
  }
});

test("a malformed payload names the field that failed", () => {
  const cases: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
    [{ startDate: "not-a-date" }, "startDate"],
    [{ siteManagerId: "   " }, "siteManagerId"],
    [{ leadId: 0 }, "leadId"],
    [{ projectName: "" }, "projectName"],
    [{ sourceDocuments: { tender: null, contract: null } }, "sourceDocuments"],
  ];

  assert.equal(cases.length, 5);
  for (const [patch, field] of cases) {
    const result = createProjectWithLeadSchema.safeParse({
      ...wizardPayload(),
      ...patch,
    });
    assert.equal(result.success, false, `${field} was accepted`);
    if (result.success) continue;
    const paths = result.error.issues.map((issue) => issue.path[0]);
    assert.ok(paths.includes(field), `${field} not named, got ${paths.join(",")}`);
  }
});

test("the structural pass-throughs are carried unchanged", () => {
  const parties = [{ name: "A Owner", email: "a@example.com" }];
  const result = createProjectWithLeadSchema.safeParse({
    ...wizardPayload(),
    parties,
    customerName: null,
    customerEmail: null,
  });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.data.parties, parties);
});
