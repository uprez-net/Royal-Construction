import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { DomainValidationError } from "@/lib/domain/errors";
import { resolveCustomersForProject } from "@/lib/domain/identity/customers";
import { createProjectFromLead } from "@/lib/domain/projects/creation";
import {
  builderDetailsOf,
  canonicalPhone,
  ownerContactsFromOwners,
  ownerFieldPath,
  ownerRowsToSubmit,
  parseOwnerFieldPath,
  projectOwnerProblems,
  requireProjectOwners,
  withoutBuilderDetails,
  type ProjectOwner,
} from "@/lib/domain/projects/owners";
import {
  failureFromThrownError,
  fieldPathToFormField,
  validateCreateProjectForm,
} from "@/lib/projects/create-project-errors";
import { mergeExtractedOwners } from "@/lib/projects/extracted-owners";
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

  test("name, email and address are required", () => {
    const problems = projectOwnerProblems([
      { ...jane, address: "  ", email: "", name: "" },
    ]);
    assert.deepEqual(
      problems.map((problem) => [problem.index, problem.field]),
      [
        [0, "name"],
        [0, "email"],
        [0, "address"],
      ],
    );
  });

  test("an owner with no phone passes: some clients give none", () => {
    assert.deepEqual(projectOwnerProblems([{ ...jane, phone: "" }]), []);
    assert.deepEqual(requireProjectOwners([{ ...jane, phone: "  " }]), [
      { ...jane, phone: "" },
    ]);
  });

  test("two owners with no phone are not 'sharing' one", () => {
    assert.deepEqual(
      projectOwnerProblems([
        { ...jane, phone: "" },
        { ...john, phone: "" },
      ]),
      [],
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

  test("requireProjectOwners trims, lower-cases the email, canonicalises the phone and drops blank rows", () => {
    const owners = requireProjectOwners([
      { ...jane, email: "  Jane@Example.com ", name: " Jane Owner " },
      { address: "", email: "", name: "", phone: "" },
    ]);
    assert.deepEqual(owners, [{ ...jane, phone: "0400111222" }]);
  });

  test("a phone is one canonical form however it was typed", () => {
    assert.equal(canonicalPhone(" 0400 111 222 "), "0400111222");
    assert.equal(canonicalPhone("(0400) 111-222"), "0400111222");
    // The "+" is kept, and no country code is guessed for a local number.
    assert.equal(canonicalPhone("+61 400 111 222"), "+61400111222");
    assert.equal(canonicalPhone("no digits"), "");
  });

  test("a phone with no digits is named, rather than saved as no phone", () => {
    const problems = projectOwnerProblems([{ ...jane, phone: "TBC" }]);
    assert.deepEqual(
      problems.map((problem) => [problem.field, problem.message]),
      [
        [
          "phone",
          '"TBC" is not a phone number. Leave it blank if Owner 1 has none.',
        ],
      ],
    );
  });

  test("requireProjectOwners throws a refusal naming the owner's row and input", () => {
    assert.throws(
      () => requireProjectOwners([jane, { ...john, address: "" }]),
      (error: unknown) =>
        error instanceof DomainValidationError
        && error.field === "legalAdministrationOwners.1.address"
        && /Owner 2 needs an address/.test(error.message),
    );
  });

  test("a refusal about the whole list names the bare owner field", () => {
    assert.throws(
      () => requireProjectOwners([]),
      (error: unknown) =>
        error instanceof DomainValidationError
        && error.field === "legalAdministrationOwners",
    );
  });

  test("an owner field path round-trips, and other paths are not owner paths", () => {
    assert.deepEqual(parseOwnerFieldPath(ownerFieldPath(2, "email")), {
      field: "email",
      index: 2,
    });
    assert.deepEqual(parseOwnerFieldPath(ownerFieldPath(0)), {
      field: null,
      index: 0,
    });
    assert.deepEqual(parseOwnerFieldPath(ownerFieldPath(null)), {
      field: null,
      index: null,
    });
    assert.equal(parseOwnerFieldPath("legalAdministration.signedDate"), null);
    assert.equal(
      fieldPathToFormField("legalAdministrationOwners.1.phone"),
      "legalAdministrationOwners",
    );
  });

  test("blank rows are not submitted, so the rule and the screen number owners alike", () => {
    const blank = { address: "", email: "", name: "", phone: "" };
    assert.deepEqual(ownerRowsToSubmit([blank, jane, blank, john]), [
      jane,
      john,
    ]);
  });

  test("the persisted owner contacts line up owner by owner", () => {
    assert.deepEqual(ownerContactsFromOwners([jane, john]), {
      emails: [jane.email, john.email],
      names: [jane.name, john.name],
      phones: [jane.phone, john.phone],
    });
  });
});

describe("the builder is never an owner", () => {
  const builderRow = {
    address: "38/62 Turner Road, Smeaton Grange NSW 2567",
    email: "info@royalconstructions.com.au",
    name: "ROYAL CONSTRUCTIONS PTY LTD",
    phone: "1300 832 355",
  };

  test("every builder detail is recognised however it is printed", () => {
    assert.deepEqual(builderDetailsOf(builderRow), [
      "name",
      "email",
      "phone",
      "address",
    ]);
    assert.deepEqual(builderDetailsOf({ phone: "0406-555-565" }), ["phone"]);
    assert.deepEqual(builderDetailsOf(jane), []);
  });

  test("a row that is the builder is refused with one message saying so", () => {
    const problems = projectOwnerProblems([jane, builderRow]);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].index, 1);
    assert.match(problems[0].message, /Owner 2 is the builder/);
  });

  test("a builder phone or email on a client's row is refused on that input", () => {
    const problems = projectOwnerProblems([
      { ...jane, email: "admin@RoyalConstructions.com.au" },
      { ...john, phone: "0406 555 565" },
    ]);
    assert.deepEqual(
      problems.map((problem) => [problem.index, problem.field]),
      [
        [0, "email"],
        [1, "phone"],
      ],
    );
    assert.match(problems[0].message, /builder's/);
  });

  test("extraction drops the builder's row and blanks builder details on a client's", () => {
    const result = withoutBuilderDetails([
      { ...jane, phone: "1300 832 355" },
      builderRow,
      john,
    ]);
    assert.equal(result.droppedRows, 1);
    assert.equal(result.clearedDetails, 1);
    assert.deepEqual(result.owners, [{ ...jane, phone: "" }, john]);
  });

  test("only the builder's exact name is the builder, with or without Pty Ltd", () => {
    assert.deepEqual(builderDetailsOf({ name: "Royal Constructions" }), [
      "name",
    ]);
    assert.deepEqual(
      builderDetailsOf({ name: "Royal Constructions Pty. Ltd." }),
      ["name"],
    );
    // A client whose name contains the builder's is still a client.
    const client = { ...jane, name: "Royal Constructions Family Trust" };
    assert.deepEqual(builderDetailsOf(client), []);
    const result = withoutBuilderDetails([client]);
    assert.equal(result.droppedRows, 0);
    assert.deepEqual(result.owners, [client]);
  });
});

describe("merging the owners each extraction chunk found", () => {
  const blank = { address: "", email: "", name: "", phone: "" };

  test("the first chunk to name owners decides who they are", () => {
    const fromWhoSection = [jane, john];
    const fromSignaturePage = [{ ...blank, name: "Some Witness" }];
    assert.deepEqual(mergeExtractedOwners(fromWhoSection, fromSignaturePage), [
      jane,
      john,
    ]);
  });

  test("a later chunk fills only the details still blank on an owner of the same name", () => {
    const merged = mergeExtractedOwners(
      [{ ...jane, phone: "" }],
      [
        {
          ...jane,
          address: "Somewhere else",
          name: "JANE OWNER",
          phone: "0400 999 999",
        },
      ],
    );
    assert.deepEqual(merged, [{ ...jane, phone: "0400 999 999" }]);
  });

  test("nothing found yet takes the next chunk's owners", () => {
    assert.deepEqual(mergeExtractedOwners([blank], [jane]), [jane]);
  });
});

describe("the wizard", () => {
  test("lists every owner problem under the owner field before submitting", () => {
    const errors = validateCreateProjectForm({
      extraction: {
        ...createEmptyProjectExtractionData(),
        legalAdministrationOwners: [
          { ...jane, address: "" },
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
      errors.map((error) => [error.field, error.message, error.owner]),
      [
        [
          "legalAdministrationOwners",
          "Owner 1 needs an address.",
          { field: "address", index: 0 },
        ],
        [
          "legalAdministrationOwners",
          "Owner 2 needs a name.",
          { field: "name", index: 1 },
        ],
      ],
    );
  });

  test("a server refusal about one owner comes back on that owner's row and input", () => {
    const failure = failureFromThrownError(
      new DomainValidationError(
        "Owner 2 (John Owner): this phone number is already on file for a customer with a different name.",
        ownerFieldPath(1, "phone"),
      ),
    );
    assert.equal(failure.code, "VALIDATION");
    assert.equal(failure.title, "Owner 2 needs correcting");
    assert.deepEqual(
      failure.fieldErrors.map((entry) => entry.owner),
      [{ field: "phone", index: 1 }],
    );
    assert.equal(failure.fieldErrors[0].field, "legalAdministrationOwners");
  });

  test("a customer unique-constraint clash is an owner problem, not a project-name one", () => {
    const failure = failureFromThrownError(
      new Error(
        "Invalid `prisma.customer.create()` invocation: Unique constraint failed on the fields: (`email`) P2002",
      ),
    );
    assert.equal(failure.fieldErrors[0].field, "legalAdministrationOwners");
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
  test("a phone typed with spaces finds the customer stored without them", async () => {
    // The owner arrives with a new email, so the phone is the only match —
    // the case that used to create a second customer for the same person.
    const existing = customerRow("c-1", {
      ...jane,
      email: "old@example.com",
      phone: "0400111222",
    });
    const recorder = recordingDb({
      "customer.findFirst": null,
      "customer.findUnique": (args: unknown) =>
        (args as { where: { phone: string } }).where.phone === "0400111222"
          ? existing
          : null,
      "customer.update": (args: unknown) => ({
        ...existing,
        ...(args as { data: object }).data,
      }),
    });

    const [resolved] = await resolveCustomersForProject(
      requireProjectOwners([jane]),
      recorder.db,
    );

    assert.equal(resolved.customer.id, "c-1");
    assert.equal(resolved.created, false);
    assert.deepEqual(
      recorder.writes().map((call) => call.operation),
      ["customer.update"],
    );
  });

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

  test("a recurring client is linked to the customer already on file", async () => {
    // Same person, second build: the email finds them, and nothing about
    // them has changed, so the project links the id and writes nothing.
    const existing = customerRow("c-jane", {
      ...jane,
      phone: "0400111222",
    });
    const recorder = recordingDb({
      "customer.findFirst": existing,
      "customer.findUnique": existing,
    });

    const [resolved] = await resolveCustomersForProject(
      requireProjectOwners([jane]),
      recorder.db,
    );

    assert.equal(resolved.customer.id, "c-jane");
    assert.equal(resolved.created, false);
    assert.equal(resolved.changed, false);
    assert.deepEqual(recorder.writes(), []);
  });

  test("a recurring client with a non-Latin name is linked, not refused as a different name", async () => {
    const owner = { ...jane, name: "李伟" };
    const existing = customerRow("c-li", { ...owner, phone: "0400111222" });
    const recorder = recordingDb({
      "customer.findFirst": existing,
      "customer.findUnique": existing,
    });

    const [resolved] = await resolveCustomersForProject(
      requireProjectOwners([owner]),
      recorder.db,
    );

    assert.equal(resolved.customer.id, "c-li");
    assert.deepEqual(recorder.writes(), []);
  });

  test("a client first saved from an enquiry by first name alone is still linked", async () => {
    const existing = customerRow("c-jane", {
      email: jane.email,
      name: "Jane",
      phone: "0400111222",
    });
    const recorder = recordingDb({
      "customer.findFirst": existing,
      "customer.findUnique": existing,
      "customer.update": (args: unknown) => ({
        ...existing,
        ...(args as { data: object }).data,
      }),
    });

    const [resolved] = await resolveCustomersForProject(
      requireProjectOwners([jane]),
      recorder.db,
    );

    assert.equal(resolved.customer.id, "c-jane");
    assert.equal(resolved.customer.name, "Jane Owner");
  });

  test("a recurring client whose phone is on file for someone else is linked by email, and the other customer's phone is left alone", async () => {
    const onFile = customerRow("c-email", { ...jane, phone: "0499000000" });
    const recorder = recordingDb({
      "customer.findFirst": onFile,
      "customer.findUnique": customerRow("c-phone", {
        ...john,
        phone: "0400111222",
      }),
      "customer.update": (args: unknown) => ({
        ...onFile,
        ...(args as { data: object }).data,
      }),
    });

    const [resolved] = await resolveCustomersForProject(
      requireProjectOwners([jane]),
      recorder.db,
    );

    assert.equal(resolved.customer.id, "c-email");
    // Linked as-is: the phone stays the one on file, because the contract's
    // number belongs to another customer and is unique.
    assert.equal(resolved.customer.phone, "0499000000");
    assert.deepEqual(recorder.writes(), []);
  });

  test("an owner with no phone is matched on email alone and created with a NULL phone", async () => {
    const recorder = recordingDb({
      "customer.create": (args: unknown) =>
        customerRow("c-new", (args as { data: ProjectOwner }).data),
      "customer.findFirst": null,
    });

    const [resolved] = await resolveCustomersForProject(
      requireProjectOwners([{ ...jane, phone: "" }]),
      recorder.db,
    );

    assert.equal(resolved.created, true);
    assert.equal(resolved.customer.phone, null);
    // No phone lookup: "" would match nobody, and NULL is not a key.
    assert.equal(
      recorder.calls.some((call) => call.operation === "customer.findUnique"),
      false,
    );
  });

  test("a recurring client whose contract has no phone keeps the phone on file", async () => {
    const existing = customerRow("c-jane", { ...jane, phone: "0400111222" });
    const recorder = recordingDb({ "customer.findFirst": existing });

    const [resolved] = await resolveCustomersForProject(
      requireProjectOwners([{ ...jane, phone: "" }]),
      recorder.db,
    );

    assert.equal(resolved.customer.id, "c-jane");
    assert.equal(resolved.customer.phone, "0400111222");
    assert.deepEqual(recorder.writes(), []);
  });

  test("a phone shared with a differently named customer is refused, not linked or renamed", async () => {
    // John's contract shows the household line that is on Jane's record.
    // Linking would name Jane on John's project; renaming would rewrite Jane.
    const recorder = recordingDb({
      "customer.findFirst": null,
      "customer.findUnique": customerRow("c-jane", {
        ...jane,
        phone: "0400333444",
      }),
    });

    await assert.rejects(
      resolveCustomersForProject(requireProjectOwners([john]), recorder.db),
      (error: unknown) =>
        error instanceof DomainValidationError
        && error.field === "legalAdministrationOwners.0.phone"
        && /Owner 1 \(John Owner\): this phone number is already on file for a customer with a different name/.test(
          error.message,
        ),
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
      /Owner 2 \(John Owner\) and Owner 1 \(Jane Owner\) match the same customer on file/,
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
    "milestoneTemplate.findMany": [
      {
        id: "template-1",
        name: "Survey",
        order: 1,
        parentId: null,
        projectStage: "Deposit",
        relatedCostLines: [],
        estimatedDays: 5,
        requiredTradeTypes: [],
      },
    ],
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
      ownerContactsFromOwners(requireProjectOwners([jane, john])),
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
        && error.field === "legalAdministrationOwners.0.address",
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
