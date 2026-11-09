import type {
  ProjectOwnerContactDetails,
  ProjectRequirementsPayload,
} from "@/types/project-flow";

import { DomainValidationError } from "../errors";
import { BUILDER_IDENTITY } from "../identity/builder";

// The owners of a build: who they are, and what makes an owner complete
// enough to become a customer.
//
// One contract can name several owners, and every one of them becomes a
// Customer linked to the project (`ProjectCustomer`). Each owner is ONE record
// — name, email, phone and address together. The extraction used to carry
// three independent lists (`legalAdministrationOwnerNames`, `...Emails`,
// `...Phones`) and pair them by index, so a contract with two names and one
// email attached that email to whichever owner happened to be first — and the
// customer row was then built from the lead rather than the contract anyway.
//
// Name, email and address are required: a customer is what a Xero contact is
// made from, and an invoice or notice addressed to half a customer is the
// expensive kind of wrong here. The phone is optional — some clients give
// none — and a missing one is stored as NULL, never as "".
//
// Pure and Node-safe: the create-project wizard runs `projectOwnerProblems`
// before submitting, and `createProjectFromLead` runs `requireProjectOwners`
// before writing. One rule, two callers.

/** What a caller hands in: a row from the wizard, the offer, or the lead. */
export type ProjectOwnerInput = {
  readonly name?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
  /** The owner's own address (ADR 0003 "Current Location"), not the site. */
  readonly address?: string | null;
};

/**
 * An owner that has passed the rule: name, email and address present and
 * trimmed, the email lower-cased, and the phone in `canonicalPhone` form —
 * `""` when the owner has none, so the owner-contact lists stay aligned. Write
 * it to `Customer.phone` as `phone || null`.
 */
export type ProjectOwner = {
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly address: string;
};

export type ProjectOwnerField = keyof ProjectOwner;

export type ProjectOwnerProblem = {
  /** Row in the list as the caller sent it; `null` for the list as a whole. */
  readonly index: number | null;
  readonly field: ProjectOwnerField | null;
  readonly message: string;
};

/** The wizard field, and the field a refusal from this rule names. */
export const PROJECT_OWNERS_FIELD = "legalAdministrationOwners";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** What every owner must have. The phone is not among them. */
const REQUIRED_FIELDS = ["name", "email", "address"] as const;

const FIELD_NAMES: Record<ProjectOwnerField, string> = {
  address: "an address",
  email: "an email",
  name: "a name",
  phone: "a phone number",
};

/**
 * The field a refusal about one owner names: `legalAdministrationOwners.1.email`
 * for the second owner's email, `legalAdministrationOwners.1` for the row, or
 * the bare list field when the problem is the list as a whole.
 *
 * A dotted path, the convention a date blocker's `fieldPath` already uses, so
 * the wizard can put the message on the row and the input it is about rather
 * than on the owner block in general.
 */
export function ownerFieldPath(
  index: number | null,
  field: ProjectOwnerField | null = null,
): string {
  if (index === null) return PROJECT_OWNERS_FIELD;
  return field
    ? `${PROJECT_OWNERS_FIELD}.${index}.${field}`
    : `${PROJECT_OWNERS_FIELD}.${index}`;
}

/** The inverse of {@link ownerFieldPath}; `null` for any other field. */
export function parseOwnerFieldPath(
  path: string | null | undefined,
): { index: number | null; field: ProjectOwnerField | null } | null {
  if (!path) return null;
  const [head, rawIndex, rawField] = path.split(".");
  if (head !== PROJECT_OWNERS_FIELD) return null;
  if (rawIndex === undefined) return { field: null, index: null };

  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 0) {
    return { field: null, index: null };
  }
  const field =
    rawField && rawField in FIELD_NAMES
      ? (rawField as ProjectOwnerField)
      : null;
  return { field, index };
}

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The one form a phone number is compared, looked up and stored in: digits
 * only, with a leading "+" kept, so "0400 111 222", "0400-111-222" and
 * "0400111222" are one customer rather than three.
 *
 * Deliberately not E.164: nothing else in the app has adopted it, and
 * guessing a country code for a number typed without one is a guess.
 * "+61 400 111 222" and "0400 111 222" therefore stay different numbers.
 *
 * Used by the owner rule and by every write of `Customer.phone`, because the
 * unique constraint on that column is only an identity if every row is in the
 * same form.
 */
export function canonicalPhone(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

const BUILDER_PHONES = new Set(
  BUILDER_IDENTITY.phones.map((phone) => canonicalPhone(phone)),
);

/** Lower-case letters and digits only, so spacing and punctuation never decide. */
function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The builder's name and nothing else: "Royal Constructions", or with a
 * "Pty Ltd" after it. Exact, not "contains", so a client whose name merely
 * includes the builder's is still a client — dropping their row would lose an
 * owner the contract names.
 */
const BUILDER_NAMES = new Set(
  [BUILDER_IDENTITY.tradingName, BUILDER_IDENTITY.legalName].flatMap((name) => [
    squash(name),
    `${squash(name)}ptyltd`,
  ]),
);

/**
 * Which of an owner's details are the builder's own: Royal Constructions'
 * name, an address on its email domain, one of its phone numbers, or its
 * office address.
 *
 * The builder is never an owner. An owner becomes a customer and a Xero
 * contact, and the builder invoicing itself is the expensive kind of wrong.
 * The extraction drops these details (`withoutBuilderDetails`) and the owner
 * rule refuses any that are typed back in.
 */
export function builderDetailsOf(
  owner: ProjectOwnerInput,
): ProjectOwnerField[] {
  const name = squash(clean(owner.name));
  const email = clean(owner.email).toLowerCase();
  const phone = canonicalPhone(clean(owner.phone));
  const address = squash(clean(owner.address));

  const details: ProjectOwnerField[] = [];
  if (BUILDER_NAMES.has(name)) {
    details.push("name");
  }
  if (email.endsWith(`@${BUILDER_IDENTITY.emailDomain}`)) {
    details.push("email");
  }
  if (phone && BUILDER_PHONES.has(phone)) {
    details.push("phone");
  }
  // "38/62 Turner Rd" or "38/62 Turner Road", in Smeaton Grange.
  if (address.includes("62turnerr") && address.includes("smeatongrange")) {
    details.push("address");
  }
  return details;
}

const BUILDER_DETAIL_MESSAGES: Record<
  Exclude<ProjectOwnerField, "name">,
  (label: string) => string
> = {
  address: (label) =>
    `${label}'s address is the builder's office. Use the owner's own address from the contract.`,
  email: (label) =>
    `${label}'s email is the builder's (@${BUILDER_IDENTITY.emailDomain}). Use the email printed against this owner.`,
  phone: (label) =>
    `${label}'s phone number is the builder's. Use the number printed against this owner.`,
};

function normalizeOwner(input: ProjectOwnerInput): ProjectOwner {
  return {
    address: clean(input.address),
    // Lower-cased so one person is one customer however the contract or the
    // operator capitalised their address.
    email: clean(input.email).toLowerCase(),
    name: clean(input.name),
    phone: canonicalPhone(clean(input.phone)),
  };
}

function isBlankRow(owner: ProjectOwner): boolean {
  return !owner.name && !owner.email && !owner.phone && !owner.address;
}

/**
 * The rows worth sending: every row with anything in it, in order.
 *
 * The rule ignores a blank row anyway, but the domain numbers what it refuses
 * by position in the list it kept. Sending only the kept rows means "Owner 2"
 * in a refusal is the second row on the operator's screen.
 */
export function ownerRowsToSubmit<T extends ProjectOwnerInput>(
  owners: readonly T[],
): T[] {
  return owners.filter((owner) => !isBlankRow(normalizeOwner(owner)));
}

/**
 * Extracted owners with the builder taken out: a row that IS the builder is
 * dropped, and a builder detail on a client's row (the office phone printed
 * beside an owner's name) is blanked so the operator types the owner's own.
 *
 * Applied to what a model extracted, never to what an operator typed — the
 * rule refuses that instead, so a correction is never silently undone.
 */
export function withoutBuilderDetails<T extends ProjectOwnerInput>(
  owners: readonly T[],
): { owners: T[]; droppedRows: number; clearedDetails: number } {
  let droppedRows = 0;
  let clearedDetails = 0;
  const kept: T[] = [];

  for (const owner of owners) {
    const details = builderDetailsOf(owner);
    if (details.includes("name")) {
      droppedRows += 1;
      continue;
    }
    if (details.length === 0) {
      kept.push(owner);
      continue;
    }
    const cleared: T = { ...owner };
    for (const field of details) {
      (cleared as Record<ProjectOwnerField, string>)[field] = "";
    }
    clearedDetails += details.length;
    kept.push(cleared);
  }

  return { clearedDetails, droppedRows, owners: kept };
}

/**
 * Everything wrong with an owner list, in display order.
 *
 * A row with nothing in it is ignored rather than refused — it is the empty
 * row the wizard adds for the operator to type into.
 */
export function projectOwnerProblems(
  owners: readonly ProjectOwnerInput[],
): ProjectOwnerProblem[] {
  const problems: ProjectOwnerProblem[] = [];
  const rows = owners
    .map((owner, index) => ({ index, owner: normalizeOwner(owner) }))
    .filter(({ owner }) => !isBlankRow(owner));

  if (rows.length === 0) {
    return [
      {
        field: null,
        index: null,
        message:
          "Add at least one owner, exactly as the contract's WHO section names them.",
      },
    ];
  }

  const emailOwner = new Map<string, number>();
  const phoneOwner = new Map<string, number>();

  for (const { index, owner } of rows) {
    const label = `Owner ${index + 1}`;
    const builderDetails = builderDetailsOf(owner);

    // The whole row is the builder: one message saying so, rather than four
    // about fields the operator should not be filling in at all.
    if (builderDetails.includes("name")) {
      problems.push({
        field: "name",
        index,
        message: `${label} is the builder (${BUILDER_IDENTITY.tradingName}), not a client. Remove this row — owners are the people the contract names as Owner.`,
      });
      continue;
    }

    for (const field of builderDetails) {
      if (field === "name") continue;
      problems.push({
        field,
        index,
        message: BUILDER_DETAIL_MESSAGES[field](label),
      });
    }

    // Something typed in the phone box that has no digits ("TBC", "n/a") is
    // not a number. Saying so beats silently saving the owner with none.
    if (clean(owners[index].phone) && !owner.phone) {
      problems.push({
        field: "phone",
        index,
        message: `"${clean(owners[index].phone)}" is not a phone number. Leave it blank if ${label} has none.`,
      });
    }

    for (const field of REQUIRED_FIELDS) {
      if (!owner[field]) {
        problems.push({
          field,
          index,
          message: `${label} needs ${FIELD_NAMES[field]}.`,
        });
      }
    }

    if (owner.email && !EMAIL_RE.test(owner.email)) {
      problems.push({
        field: "email",
        index,
        message: `"${owner.email}" is not an email address.`,
      });
    }

    // Each owner becomes their own customer, and a customer's email and phone
    // are unique. Two owners sharing one would either fail the insert or, in
    // the lookup, quietly make both owners the same customer.
    if (owner.email) {
      const first = emailOwner.get(owner.email);
      if (first !== undefined) {
        problems.push({
          field: "email",
          index,
          message: `${label} has the same email as Owner ${first + 1}. Each owner needs their own.`,
        });
      } else {
        emailOwner.set(owner.email, index);
      }
    }

    if (owner.phone) {
      const first = phoneOwner.get(owner.phone);
      if (first !== undefined) {
        problems.push({
          field: "phone",
          index,
          message: `${label} has the same phone number as Owner ${first + 1}. Each owner needs their own.`,
        });
      } else {
        phoneOwner.set(owner.phone, index);
      }
    }
  }

  return problems;
}

/**
 * The owner list, normalised, or a refusal naming the first thing wrong.
 *
 * @throws {DomainValidationError} Carrying an {@link ownerFieldPath} —
 * `legalAdministrationOwners`, or the row and input under it — so the wizard
 * binds it to the owner, and the input, it is about.
 */
export function requireProjectOwners(
  owners: readonly ProjectOwnerInput[],
): ProjectOwner[] {
  const [problem] = projectOwnerProblems(owners);
  if (problem) {
    throw new DomainValidationError(
      problem.message,
      ownerFieldPath(problem.index, problem.field),
    );
  }

  return owners.map(normalizeOwner).filter((owner) => !isBlankRow(owner));
}

/**
 * The `requirements.legalAdministration.ownerContacts` block, written from the
 * owners rather than alongside them.
 *
 * The screens still read this block as three lists paired by index. Built
 * here, entry `i` of every list is owner `i`.
 */
export function ownerContactsFromOwners(
  owners: readonly ProjectOwner[],
): ProjectOwnerContactDetails {
  return {
    emails: owners.map((owner) => owner.email),
    names: owners.map((owner) => owner.name),
    phones: owners.map((owner) => owner.phone),
  };
}

/** Replace a payload's owner contacts with the ones the owners imply. */
export function withOwnerContacts(
  requirements: ProjectRequirementsPayload,
  owners: readonly ProjectOwner[],
): ProjectRequirementsPayload {
  return {
    ...requirements,
    legalAdministration: {
      ...requirements.legalAdministration,
      ownerContacts: ownerContactsFromOwners(owners),
    },
  };
}

// ── Who the owners are, for writing to them ─────────────────────────────

/** The columns `projectOwnerRows` reads, for a caller's `select`. */
export const PROJECT_OWNER_SELECT = {
  customer: { select: { email: true, name: true, phone: true } },
  customers: {
    orderBy: { position: "asc" },
    select: { customer: { select: { email: true, name: true, phone: true } } },
  },
} as const;

export type ProjectOwnerRow = {
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
};

/**
 * A project's owners, in contract order.
 *
 * Every owner is a ProjectCustomer; the primary customer is the fallback only
 * for a row the migration could have missed, as the Xero contact does.
 */
export function projectOwnerRows(project: {
  readonly customer: ProjectOwnerRow;
  readonly customers: readonly { readonly customer: ProjectOwnerRow }[];
}): ProjectOwnerRow[] {
  return project.customers.length > 0
    ? project.customers.map((row) => row.customer)
    : [project.customer];
}

/**
 * The owners who can be emailed: one entry per address, trimmed, the first
 * owner with an address keeping it. Variations and the WhatsApp group invite
 * both email "the owners on the contract", and both mean exactly this list.
 */
export function ownerEmailRecipients(
  owners: readonly ProjectOwnerRow[],
): { email: string; name: string }[] {
  const seen = new Set<string>();
  const recipients: { email: string; name: string }[] = [];
  for (const owner of owners) {
    const email = owner.email.trim();
    const key = email.toLowerCase();
    if (!email || seen.has(key)) continue;
    seen.add(key);
    recipients.push({ email, name: owner.name.trim() });
  }
  return recipients;
}
