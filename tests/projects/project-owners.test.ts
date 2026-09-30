import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { DomainValidationError } from "@/lib/domain/errors";
import { resolveCustomersForProject } from "@/lib/domain/identity/customers";
import { createProjectFromLead } from "@/lib/domain/projects/creation";
import {
  ownerContactsFromOwners,
  projectOwnerProblems,
  requireProjectOwners,
  type ProjectOwner,
} from "@/lib/domain/projects/owners";
import { validateCreateProjectForm } from "@/lib/projects/create-project-errors";
import {
  createEmptyProjectExtractionData,
  projectExtractionSchema,
} from "@/types/project-extraction";

import { adminPrincipal, recordingDb } from "../architecture/domain-harness";

// A contract can name several owners, and each becomes a customer on the
// project. The owner rule is shared by the wizard (before submit) and the
// domain command (before writing), so these run it the way both do.

const jane = {
  address: "1 Home St, Sydney NSW 2000",
  email: "jane@example.com",
  name: "Jane Owner",
  phone: "0400 111 222",
};
const john = {
  address: "1 Home St, Sydney NSW 2000",
  email: "john@example.com",
  name: "John Owner",
  phone: "0400 333 444",
};

const customerRow = (
  id: string,
  owner: Partial<ProjectOwner> & { name: string; email: string; phone: string },
) => ({
  address: null,
  createdAt: new Date(0),
  id,
  updatedAt: new Date(0),
  ...owner,
});

describe("the owner rule", () => {
  test("two complete owners pass", () => {
    assert.deepEqual(projectOwnerProblems([jane, john]), []);
  });

  test("no owners at all is refused, not filled from the lead", () => {
    const [problem] = projectOwnerProblems([]);
    assert.equal(problem.index, null);
    assert.match(problem.message, /at least one owner/);
  });

  test("an empty row the operator added is ignored, not refused", () => {
    assert.deepEqual(
      projectOwnerProblems([
        jane,
        { address: "", email: "", name: "", phone: "" },
      ]),
      [],
    );
  });

  test("every one of name, email, phone and address is required", () => {
    const problems = projectOwnerProblems([
      { ...jane, address: "  ", phone: "" },
    ]);
    assert.deepEqual(
      problems.map((problem) => [problem.index, problem.field]),
      [
        [0, "phone"],
        [0, "address"],
      ],
    );
  });

  test("a malformed email is named", () => {
    const problems = projectOwnerProblems([{ ...jane, email: "jane@" }]);
    assert.deepEqual(
      problems.map((problem) => problem.field),
      ["email"],
    );
  });

  test("two owners cannot share an email, whatever its case", () => {
    const problems = projectOwnerProblems([
      jane,
      { ...john, email: "JANE@example.com" },
    ]);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].index, 1);
    assert.equal(problems[0].field, "email");
    assert.match(problems[0].message, /same email as Owner 1/);
  });

  test("two owners cannot share a phone, however it is spaced", () => {
    const problems = projectOwnerProblems([
      jane,
      { ...john, phone: "0400111222" },
    ]);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].field, "phone");
  });

  test("requireProjectOwners trims, lower-cases the email and drops blank rows", () => {
    const owners = requireProjectOwners([
      { ...jane, email: "  Jane@Example.com ", name: " Jane Owner " },
      { address: "", email: "", name: "", phone: "" },
    ]);
    assert.deepEqual(owners, [{ ...jane }]);
  });

  test("requireProjectOwners throws a refusal naming the owner field", () => {
    assert.throws(
      () => requireProjectOwners([{ ...jane, address: "" }]),
      (error: unknown) =>
        error instanceof DomainValidationError
        && error.field === "legalAdministrationOwners"
        && /Owner 1 needs an address/.test(error.message),
    );
  });

  test("the persisted owner contacts line up owner by owner", () => {
    assert.deepEqual(ownerContactsFromOwners([jane, john]), {
      emails: [jane.email, john.email],
      names: [jane.name, john.name],
      phones: [jane.phone, john.phone],
    });
  });
});

describe("the wizard", () => {
  test("lists every owner problem under the owner field before submitting", () => {
    const errors = validateCreateProjectForm({
      extraction: {
        ...createEmptyProjectExtractionData(),
        legalAdministrationOwners: [
          { ...jane, phone: "" },
          { ...john, name: "" },
        ],
        legalAdministrationSignedDate: "2026-09-01",
        projectName: "Build",
      },
      hasLocation: true,
      hasSiteManager: true,
      hasSourceDocuments: true,
      selectedLeadId: 1,
      startDate: "2026-09-10",
    });
    assert.deepEqual(
      errors.map((error) => [error.field, error.message]),
      [
        ["legalAdministrationOwners", "Owner 1 needs a phone number."],
        ["legalAdministrationOwners", "Owner 2 needs a name."],
      ],
    );
  });

  test("the extraction keeps owner rows as typed, so a keystroke is never eaten", () => {
    const parsed = projectExtractionSchema.parse({
      ...createEmptyProjectExtractionData(),
      legalAdministrationOwners: [
        { address: "", email: "", name: "Jane ", phone: "" },
        { address: "", email: "", name: "", phone: "" },
        "not an owner",
      ],
    });
    assert.deepEqual(parsed.legalAdministrationOwners, [
      { address: "", email: "", name: "Jane ", phone: "" },
      { address: "", email: "", name: "", phone: "" },
    ]);
  });
});

describe("resolving owners to customers", () => {
  test("new owners become new customers, in order, with every field", async () => {
    const recorder = recordingDb({
      "customer.create": (args: unknown) =>
        customerRow(
          `c-${(args as { data: ProjectOwner }).data.name}`,
          (args as { data: ProjectOwner }).data,
        ),
      "customer.findFirst": null,
      "customer.findUnique": null,
    });

    const resolved = await resolveCustomersForProject(
      [jane, john],
      recorder.db,
    );

    assert.deepEqual(
      resolved.map((entry) => [entry.customer.name, entry.created]),
      [
        ["Jane Owner", true],
        ["John Owner", true],
      ],
    );
    assert.deepEqual(
      recorder.writes().map((call) => (call.args as { data: unknown }).data),
      [jane, john],
    );
  });

  test("an existing customer is patched to the contract's details", async () => {
    const existing = customerRow("c-1", {
      address: "Old address",
      email: "Jane@Example.com",
      name: "Jane",
      phone: jane.phone,
    });
    const recorder = recordingDb({
      "customer.findFirst": existing,
      "customer.findUnique": existing,
      "customer.update": (args: unknown) => ({
        ...existing,
        ...(args as { data: object }).data,
      }),
    });

    const [resolved] = await resolveCustomersForProject([jane], recorder.db);

    assert.equal(resolved.created, false);
    assert.equal(resolved.changed, true);
    // The email differs only in case, so it is not rewritten.
    assert.deepEqual(recorder.writes(), [
      {
        args: {
          data: { address: jane.address, name: jane.name },
          where: { id: "c-1" },
        },
        operation: "customer.update",
      },
    ]);
  });

  test("an email on one customer and a phone on another is refused, and nothing is written", async () => {
    const recorder = recordingDb({
      "customer.findFirst": customerRow("c-email", {
        ...jane,
        phone: "0499 000 000",
      }),
      "customer.findUnique": customerRow("c-phone", {
        ...jane,
        email: "other@example.com",
      }),
    });

    await assert.rejects(
      resolveCustomersForProject([jane], recorder.db),
      (error: unknown) =>
        error instanceof DomainValidationError
        && error.field === "legalAdministrationOwners"
        && /Jane Owner's email is on file for one customer/.test(error.message),
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("a customer already taken by one owner is never reused for another", async () => {
    // Defensive: this lookup keeps answering with the record Jane claimed,
    // where a real transaction would already see Jane's patch to it.
    const shared = customerRow("c-shared", { ...jane, phone: john.phone });
    const recorder = recordingDb({
      "customer.findFirst": (args: unknown) =>
        JSON.stringify(args).includes(jane.email) ? shared : null,
      "customer.findUnique": (args: unknown) =>
        JSON.stringify(args).includes(john.phone) ? shared : null,
      "customer.update": (args: unknown) => ({
        ...shared,
        ...(args as { data: object }).data,
      }),
    });

    await assert.rejects(
      resolveCustomersForProject([jane, john], recorder.db),
      /John Owner and Jane Owner match the same customer on file/,
    );
  });
});

describe("creating a project from a lead", () => {
  const sourceDocuments = {
    contract: {
      fileId: "f2",
      fileName: "c.pdf",
      kind: "contract" as const,
      url: "https://x/c.pdf",
    },
    tender: {
      fileId: "f1",
      fileName: "t.pdf",
      kind: "tender" as const,
      url: "https://x/t.pdf",
    },
  };
  const baseInput = (owners: unknown[]) => ({
    address: "9 Site Rd, Sydney",
    confirmDateBlockers: true,
    council: "Inner West",
    estimatedEndDate: "2027-05-10",
    extraction: {
      ...createEmptyProjectExtractionData(),
      legalAdministrationOwners: owners as never,
      legalAdministrationPcaInspector: "Certifier Co",
      legalAdministrationSignedDate: "2026-09-01",
      projectName: "9 Site Rd",
    },
    leadId: 7,
    lotSize: 450,
    projectName: "9 Site Rd",
    siteManagerId: "user_sm",
    sourceDocuments,
    startDate: "2026-09-10",
  });
  const script = () => ({
    "customer.create": (args: unknown) => {
      const data = (args as { data: ProjectOwner }).data;
      return customerRow(`c-${data.name}`, data);
    },
    "customer.findFirst": null,
    "customer.findUnique": null,
    // The lead's contact is the enquirer, not an owner; it must not surface.
    "lead.findUnique": {
      email: "enquirer@example.com",
      id: 7,
      name: "Enquirer",
      phone: "0411 999 999",
      project: null,
    },
    "project.create": {
      id: "p-1",
      location: "9 Site Rd, Sydney",
      name: "9 Site Rd",
      status: "DRAFT",
    },
    "user.findFirst": { id: "user_sm", name: "Site Manager", role: "ADMIN" },
    "user.findUnique": { id: "user_sm", name: "Site Manager", role: "ADMIN" },
  });

  test("every owner on the contract becomes a linked customer, in order", async () => {
    const recorder = recordingDb(script());

    const result = await createProjectFromLead(
      adminPrincipal(),
      baseInput([jane, john]),
      recorder.db,
    );

    assert.deepEqual(
      result.customers.map((customer) => customer.name),
      ["Jane Owner", "John Owner"],
    );
    assert.equal(result.customer.id, "c-Jane Owner");

    const projectCreate = recorder.calls.find(
      (call) => call.operation === "project.create",
    );
    const data = (projectCreate?.args as { data: Record<string, unknown> })
      .data;
    assert.equal(data.customerId, "c-Jane Owner");
    assert.deepEqual(data.customers, {
      create: [
        { customerId: "c-Jane Owner", position: 0 },
        { customerId: "c-John Owner", position: 1 },
      ],
    });
    const requirements = data.requirements as {
      legalAdministration: { ownerContacts: unknown };
    };
    assert.deepEqual(
      requirements.legalAdministration.ownerContacts,
      ownerContactsFromOwners([jane, john]),
    );
    assert.doesNotMatch(
      JSON.stringify(recorder.writes()),
      /enquirer@example\.com|Enquirer/,
    );
  });

  test("an incomplete owner is refused before anything is written", async () => {
    const recorder = recordingDb(script());

    await assert.rejects(
      createProjectFromLead(
        adminPrincipal(),
        baseInput([{ ...jane, address: "" }]),
        recorder.db,
      ),
      (error: unknown) =>
        error instanceof DomainValidationError
        && error.field === "legalAdministrationOwners",
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("no owners is refused rather than filled from the lead", async () => {
    const recorder = recordingDb(script());

    await assert.rejects(
      createProjectFromLead(adminPrincipal(), baseInput([]), recorder.db),
      /at least one owner/,
    );
    assert.deepEqual(recorder.writes(), []);
  });
});
