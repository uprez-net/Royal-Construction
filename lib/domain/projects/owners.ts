import type {
  ProjectOwnerContactDetails,
  ProjectRequirementsPayload,
} from "@/types/project-flow";

import { DomainValidationError } from "../errors";

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
// All four are required, and none is ever stored empty: a customer is what a
// Xero contact is made from, and an invoice or notice addressed to half a
// customer is the expensive kind of wrong here.
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

/** An owner that has passed the rule: every field present and trimmed. */
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

const FIELD_NAMES: Record<ProjectOwnerField, string> = {
  address: "an address",
  email: "an email",
  name: "a name",
  phone: "a phone number",
};

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Digits only, so "0400 111 222" and "0400111222" are the same number. */
function phoneKey(phone: string): string {
  return phone.replace(/\D/g, "");
}

function normalizeOwner(input: ProjectOwnerInput): ProjectOwner {
  return {
    address: clean(input.address),
    // Lower-cased so one person is one customer however the contract or the
    // operator capitalised their address.
    email: clean(input.email).toLowerCase(),
    name: clean(input.name),
    phone: clean(input.phone),
  };
}

function isBlankRow(owner: ProjectOwner): boolean {
  return !owner.name && !owner.email && !owner.phone && !owner.address;
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

    for (const field of ["name", "email", "phone", "address"] as const) {
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

    const key = phoneKey(owner.phone);
    if (key) {
      const first = phoneOwner.get(key);
      if (first !== undefined) {
        problems.push({
          field: "phone",
          index,
          message: `${label} has the same phone number as Owner ${first + 1}. Each owner needs their own.`,
        });
      } else {
        phoneOwner.set(key, index);
      }
    }
  }

  return problems;
}

/**
 * The owner list, normalised, or a refusal naming the first thing wrong.
 *
 * @throws {DomainValidationError} Carrying `legalAdministrationOwners`, so the
 * wizard binds it to the owner editor.
 */
export function requireProjectOwners(
  owners: readonly ProjectOwnerInput[],
): ProjectOwner[] {
  const [problem] = projectOwnerProblems(owners);
  if (problem) {
    throw new DomainValidationError(problem.message, PROJECT_OWNERS_FIELD);
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
