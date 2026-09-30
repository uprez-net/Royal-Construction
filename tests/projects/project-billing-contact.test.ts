import assert from "node:assert/strict";
import { describe, test } from "vitest";

import {
  billingContactName,
  disambiguatedContactName,
  projectBillingContact,
  XERO_MAX_CONTACT_PERSONS,
} from "@/lib/domain/projects/billing-contact";
import type { XeroContext } from "@/lib/xero/client";
import { resolveProjectXeroContactId } from "@/lib/xero/contact";

import { recordingDb } from "../architecture/domain-harness";

// A project's claims go to ONE Xero contact of its own: named as the
// contract names its owners, reached through the primary owner, with every
// co-owner copied on invoice emails.

const jane = {
  address: "1 Home St, Sydney NSW 2000",
  email: "jane@example.com",
  name: "Jane Mary Smith",
  phone: "0400 111 222",
};
const john = {
  address: "1 Home St, Sydney NSW 2000",
  email: "john@example.com",
  name: "John Smith",
  phone: "0400 333 444",
};

describe("the billing contact", () => {
  test("is named after every owner, in contract order", () => {
    assert.equal(billingContactName(["Jane"]), "Jane");
    assert.equal(billingContactName(["Jane", "John"]), "Jane & John");
    assert.equal(
      billingContactName(["Jane", "John", "Alex"]),
      "Jane, John & Alex",
    );
  });

  test("is reached through the primary owner, with co-owners as contact persons", () => {
    assert.deepEqual(projectBillingContact([jane, john]), {
      address: jane.address,
      contactPersons: [
        { email: john.email, firstName: "John", lastName: "Smith" },
      ],
      email: jane.email,
      name: "Jane Mary Smith & John Smith",
      omittedOwners: [],
      phone: jane.phone,
    });
  });

  test("a sole owner is the whole contact", () => {
    const contact = projectBillingContact([jane]);
    assert.equal(contact.name, jane.name);
    assert.deepEqual(contact.contactPersons, []);
  });

  test("co-owners past Xero's limit are reported, not silently dropped", () => {
    const coOwners = Array.from(
      { length: XERO_MAX_CONTACT_PERSONS + 1 },
      (_, i) => ({
        ...john,
        email: `co${i}@example.com`,
        name: `Co Owner${i}`,
      }),
    );
    const contact = projectBillingContact([jane, ...coOwners]);
    assert.equal(contact.contactPersons.length, XERO_MAX_CONTACT_PERSONS);
    assert.deepEqual(contact.omittedOwners, [
      `Co Owner${XERO_MAX_CONTACT_PERSONS}`,
    ]);
  });

  test("a taken name falls back to the site, within Xero's length", () => {
    assert.equal(
      disambiguatedContactName("Jane Smith", " 9 Site Rd "),
      "Jane Smith (9 Site Rd)",
    );
    assert.equal(
      disambiguatedContactName("x".repeat(300), "9 Site Rd").length,
      255,
    );
  });
});

// A fake Xero: contacts it already holds, and the ones created through it.
function fakeXero(
  existing: Record<string, { contactID: string; emailAddress: string }>,
) {
  const created: unknown[] = [];
  const lookups: string[] = [];
  const context = {
    tenantId: "tenant",
    xero: {
      accountingApi: {
        createContacts: async (
          _tenant: string,
          body: { contacts: unknown[] },
        ) => {
          created.push(body.contacts[0]);
          return { body: { contacts: [{ contactID: "new-contact" }] } };
        },
        getContacts: async (
          _tenant: string,
          _since: unknown,
          where: string,
        ) => {
          lookups.push(where);
          const name = /^Name=="(.*)"$/.exec(where)?.[1] ?? "";
          return { body: { contacts: existing[name] ? [existing[name]] : [] } };
        },
      },
    },
  } as unknown as XeroContext;
  return { context, created, lookups };
}

const projectRow = (xeroContactId: string | null = null) => ({
  customer: jane,
  customers: [{ customer: jane }, { customer: john }],
  location: "9 Site Rd, Sydney",
  xeroContactId,
});

describe("resolving a project's Xero contact", () => {
  test("an id already on the project is used without asking Xero", async () => {
    const recorder = recordingDb({ "project.findUnique": projectRow("known") });
    const xero = fakeXero({});

    const id = await resolveProjectXeroContactId(
      xero.context,
      "p-1",
      recorder.db,
    );

    assert.equal(id, "known");
    assert.deepEqual(xero.lookups, []);
    assert.deepEqual(recorder.writes(), []);
  });

  test("a new contact carries every owner and is stored on the project", async () => {
    const recorder = recordingDb({ "project.findUnique": projectRow() });
    const xero = fakeXero({});

    const id = await resolveProjectXeroContactId(
      xero.context,
      "p-1",
      recorder.db,
    );

    assert.equal(id, "new-contact");
    assert.deepEqual(xero.created, [
      {
        addresses: [{ addressLine1: jane.address, addressType: "STREET" }],
        contactPersons: [
          {
            emailAddress: john.email,
            firstName: "John",
            includeInEmails: true,
            lastName: "Smith",
          },
        ],
        emailAddress: jane.email,
        name: "Jane Mary Smith & John Smith",
        phones: [{ phoneNumber: jane.phone, phoneType: "DEFAULT" }],
      },
    ]);
    assert.deepEqual(recorder.writes(), [
      {
        args: { data: { xeroContactId: "new-contact" }, where: { id: "p-1" } },
        operation: "project.update",
      },
    ]);
  });

  test("the same owners' existing contact is reused, not duplicated", async () => {
    const recorder = recordingDb({ "project.findUnique": projectRow() });
    const xero = fakeXero({
      "Jane Mary Smith & John Smith": {
        contactID: "their-contact",
        emailAddress: "JANE@example.com",
      },
    });

    const id = await resolveProjectXeroContactId(
      xero.context,
      "p-1",
      recorder.db,
    );

    assert.equal(id, "their-contact");
    assert.deepEqual(xero.created, []);
  });

  test("somebody else's contact with the owners' name gets the site added", async () => {
    const recorder = recordingDb({ "project.findUnique": projectRow() });
    const xero = fakeXero({
      "Jane Mary Smith & John Smith": {
        contactID: "someone-else",
        emailAddress: "other@example.com",
      },
    });

    const id = await resolveProjectXeroContactId(
      xero.context,
      "p-1",
      recorder.db,
    );

    assert.equal(id, "new-contact");
    assert.equal(
      (xero.created[0] as { name: string }).name,
      "Jane Mary Smith & John Smith (9 Site Rd, Sydney)",
    );
  });

  test("both names taken by other people is refused with what to do", async () => {
    const recorder = recordingDb({ "project.findUnique": projectRow() });
    const other = { contactID: "x", emailAddress: "other@example.com" };
    const xero = fakeXero({
      "Jane Mary Smith & John Smith": other,
      "Jane Mary Smith & John Smith (9 Site Rd, Sydney)": other,
    });

    await assert.rejects(
      resolveProjectXeroContactId(xero.context, "p-1", recorder.db),
      /Link or rename one in Xero/,
    );
    assert.deepEqual(xero.created, []);
    assert.deepEqual(recorder.writes(), []);
  });
});
