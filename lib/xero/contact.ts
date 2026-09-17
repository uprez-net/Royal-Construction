import type { Customer } from "@prisma/client";
import type { Contacts } from "xero-node";

import prisma from "@/lib/prisma";

import type { XeroContext } from "./client";

/**
 * The Xero ContactID to bill a customer under, creating the contact if Xero has
 * never seen them.
 *
 * This mapping is the thing the first pass at the integration was missing: it
 * set `contact.contactID` to our own `projectId`, which is a BuildPro UUID and
 * not a Xero GUID, so no invoice it created could ever have attached to a real
 * contact.
 *
 * Resolution order — cached id, then email match, then create — matters. Email
 * is Xero's own natural key for a contact and matching on it first keeps us
 * from creating a duplicate of a contact the bookkeeper already set up by hand,
 * which would split one owner's invoices across two ledger entries.
 */
export async function resolveXeroContactId(
  context: XeroContext,
  customer: Pick<
    Customer,
    "id" | "name" | "email" | "phone" | "address" | "xeroContactId"
  >,
): Promise<string> {
  if (customer.xeroContactId) {
    return customer.xeroContactId;
  }

  const contactId =
    (await findContactIdByEmail(context, customer.email)) ??
    (await createContact(context, customer));

  await prisma.customer.update({
    where: { id: customer.id },
    data: { xeroContactId: contactId },
  });

  return contactId;
}

async function findContactIdByEmail(
  context: XeroContext,
  email: string,
): Promise<string | null> {
  // Xero's `where` is its own filter dialect, and a stray double quote would
  // break out of the string literal. Emails cannot legally contain one, so
  // rejecting rather than escaping keeps the query unambiguous.
  if (email.includes('"')) {
    return null;
  }

  const response = await context.xero.accountingApi.getContacts(
    context.tenantId,
    undefined,
    `EmailAddress=="${email}"`,
  );

  return response.body.contacts?.[0]?.contactID ?? null;
}

async function createContact(
  context: XeroContext,
  customer: Pick<Customer, "name" | "email" | "phone" | "address">,
): Promise<string> {
  const contacts: Contacts = {
    contacts: [
      {
        name: customer.name,
        emailAddress: customer.email,
        ...(customer.phone
          ? {
              phones: [
                { phoneType: "DEFAULT" as never, phoneNumber: customer.phone },
              ],
            }
          : {}),
        ...(customer.address
          ? {
              addresses: [
                {
                  addressType: "STREET" as never,
                  addressLine1: customer.address,
                },
              ],
            }
          : {}),
      },
    ],
  };

  // `summarizeErrors: false` — Xero answers 200 with the rejection recorded on
  // the contact itself instead of failing the request with an opaque 400, which
  // is the difference between "Xero rejected the contact for x@y.com: Contact
  // name must be unique" and "Request failed with status code 400".
  const response = await context.xero.accountingApi.createContacts(
    context.tenantId,
    contacts,
    false,
  );

  const created = response.body.contacts?.[0];
  if (!created?.contactID) {
    const reason = created?.validationErrors?.map((e) => e.message).join("; ");
    throw new Error(
      `Xero rejected the contact for ${customer.email}${reason ? `: ${reason}` : "."}`,
    );
  }

  return created.contactID;
}
