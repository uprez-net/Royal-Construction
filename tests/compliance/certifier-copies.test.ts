import assert from "node:assert/strict";
import { test } from "vitest";

import { certifierCopyList } from "@/lib/domain/compliance/certifier-copies";

const directory = [
  {
    email: "jobs@certco.com.au",
    additionalEmails: ["Anna@certco.com.au", "admin@certco.com.au"],
  },
  { email: "desk@othercert.com.au", additionalEmails: ["ops@othercert.com.au"] },
];

test("the certifier's additional addresses are copied, then the office", () => {
  assert.deepEqual(
    certifierCopyList("jobs@certco.com.au", directory, "office@royal.com.au"),
    ["Anna@certco.com.au", "admin@certco.com.au", "office@royal.com.au"],
  );
});

test("an alternate address as the recipient copies the primary instead", () => {
  assert.deepEqual(
    certifierCopyList("anna@certco.com.au", directory, undefined),
    ["jobs@certco.com.au", "admin@certco.com.au"],
  );
});

test("another firm's addresses are never copied", () => {
  const copies = certifierCopyList("jobs@certco.com.au", directory, undefined);
  assert.ok(!copies.some((address) => address.endsWith("@othercert.com.au")));
});

test("an address not in the directory falls back to the office copy alone", () => {
  assert.deepEqual(
    certifierCopyList("someone@elsewhere.com.au", directory, [
      "office@royal.com.au",
    ]),
    ["office@royal.com.au"],
  );
});

test("repeats and blanks are dropped, ignoring case", () => {
  assert.deepEqual(
    certifierCopyList(
      "JOBS@certco.com.au",
      [
        {
          email: "jobs@certco.com.au",
          additionalEmails: ["admin@certco.com.au", " ", "ADMIN@certco.com.au"],
        },
      ],
      ["admin@certco.com.au", "jobs@certco.com.au"],
    ),
    ["admin@certco.com.au"],
  );
});
