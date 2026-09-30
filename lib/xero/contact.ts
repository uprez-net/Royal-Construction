import type { Contact, Contacts } from "xero-node";

import prisma from "@/lib/prisma";
import type { DomainDb } from "@/lib/domain/db";
import {
  disambiguatedContactName,
  projectBillingContact,
  type ProjectBillingContact,
} from "@/lib/domain/projects/billing-contact";

import type { XeroContext } from "./client";

const OWNER_SELECT = {
  address: true,
  email: true,
  name: true,
  phone: true,
} as const;

/**
 * The Xero ContactID to bill a project's claims to, creating the contact if
 * Xero has never seen these owners.
 *
 * One contact per project, not per customer: named as the contract names its
 * owners, with the primary owner's details and every co-owner as a contact
 * person on invoice emails (`lib/domain/projects/billing-contact.ts` says
 * what the contact is and why it is the project's).
 *
 * Called straight after a project is created, and again by the first claim —
 * so a Xero outage at creation costs nothing but a later lookup. Idempotent:
 * the id is stored on the project, and a contact that reached Xero but whose
 * id was never stored is found again by name rather than created twice.
 *
 * Resolution order:
 *   1. the id already on the project;
 *   2. a Xero contact with exactly the owners' name AND the primary owner's
 *      email — the same owners' earlier build, or a contact the bookkeeper
 *      set up by hand — is reused, so one household is one ledger entry;
 *   3. otherwise a new contact. If a DIFFERENT contact already holds the
 *      owners' name (another Jane Smith), the site is added to the name,
 *      because Xero requires contact names to be unique.
 */
export async function resolveProjectXeroContactId(
  context: XeroContext,
  projectId: string,
  db: DomainDb = prisma,
): Promise<string> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      customer: { select: OWNER_SELECT },
      customers: {
        orderBy: { position: "asc" },
        select: { customer: { select: OWNER_SELECT } },
      },
      location: true,
      xeroContactId: true,
    },
  });
  if (!project) {
    throw new Error(`Project ${projectId} not found.`);
  }
  if (project.xeroContactId) {
    return project.xeroContactId;
  }

  // Every project has its owners in ProjectCustomer; the primary customer is
  // the fallback only for a row the migration could somehow have missed.
  const owners =
    project.customers.length > 0
      ? project.customers.map((owner) => owner.customer)
      : [project.customer];
  const contact = projectBillingContact(owners);
  if (contact.omittedOwners.length > 0) {
    console.warn(
      `[xero] Project ${projectId} has more co-owners than Xero allows on one contact; ${contact.omittedOwners.join(", ")} will not receive invoice emails.`,
    );
  }

  const contactId = await findOrCreateContact(
    context,
    contact,
    project.location,
  );

  await db.project.update({
    where: { id: projectId },
    data: { xeroContactId: contactId },
  });

  return contactId;
}

async function findOrCreateContact(
  context: XeroContext,
  contact: ProjectBillingContact,
  site: string,
): Promise<string> {
  const sameOwners = (found: Contact | null) =>
    found?.contactID
    && found.emailAddress?.trim().toLowerCase() === contact.email.toLowerCase();

  const byName = await findContactByName(context, contact.name);
  if (sameOwners(byName)) return byName!.contactID!;
  if (!byName) return createContact(context, contact, contact.name);

  // The owners' name belongs to somebody else in Xero.
  const siteName = disambiguatedContactName(contact.name, site);
  const bySiteName = await findContactByName(context, siteName);
  if (sameOwners(bySiteName)) return bySiteName!.contactID!;
  if (bySiteName) {
    throw new Error(
      `Xero already has contacts named "${contact.name}" and "${siteName}" with a different email. Link or rename one in Xero, then raise the claim again.`,
    );
  }
  return createContact(context, contact, siteName);
}

async function findContactByName(
  context: XeroContext,
  name: string,
): Promise<Contact | null> {
  // Xero's `where` is its own filter dialect, and a double quote would break
  // out of the string literal. Rather than escape it, such a name is treated
  // as unmatched and goes to create, where Xero itself is the judge.
  if (name.includes('"')) {
    return null;
  }

  const response = await context.xero.accountingApi.getContacts(
    context.tenantId,
    undefined,
    `Name=="${name}"`,
  );

  return response.body.contacts?.[0] ?? null;
}

async function createContact(
  context: XeroContext,
  contact: ProjectBillingContact,
  name: string,
): Promise<string> {
  const contacts: Contacts = {
    contacts: [
      {
        name,
        emailAddress: contact.email,
        phones: [{ phoneType: "DEFAULT" as never, phoneNumber: contact.phone }],
        ...(contact.address
          ? {
              addresses: [
                {
                  addressType: "STREET" as never,
                  addressLine1: contact.address,
                },
              ],
            }
          : {}),
        ...(contact.contactPersons.length > 0
          ? {
              contactPersons: contact.contactPersons.map((person) => ({
                emailAddress: person.email,
                firstName: person.firstName,
                includeInEmails: true,
                lastName: person.lastName,
              })),
            }
          : {}),
      },
    ],
  };

  // `summarizeErrors: false` — Xero answers 200 with the rejection recorded on
  // the contact itself instead of failing the request with an opaque 400, which
  // is the difference between "Xero rejected the contact for Jane & John:
  // Contact name must be unique" and "Request failed with status code 400".
  const response = await context.xero.accountingApi.createContacts(
    context.tenantId,
    contacts,
    false,
  );

  const created = response.body.contacts?.[0];
  if (!created?.contactID) {
    const reason = created?.validationErrors?.map((e) => e.message).join("; ");
    throw new Error(
      `Xero rejected the contact for ${name}${reason ? `: ${reason}` : "."}`,
    );
  }

  return created.contactID;
}
