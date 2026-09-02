import assert from "node:assert/strict";
import { test } from "node:test";

import {
  invoiceStatusRank,
  isPendingInvoiceStatus,
  toInvoiceStatus,
} from "../../lib/xero/invoice-status";
import { parseXeroDate } from "../../lib/xero/xero-date";

test("maps every Xero status Xero can send", () => {
  assert.equal(toInvoiceStatus("DRAFT"), "DRAFT");
  assert.equal(toInvoiceStatus("SUBMITTED"), "SUBMITTED");
  assert.equal(toInvoiceStatus("AUTHORISED"), "AUTHORISED");
  assert.equal(toInvoiceStatus("PAID"), "PAID");
  assert.equal(toInvoiceStatus("VOIDED"), "VOIDED");
  assert.equal(toInvoiceStatus("DELETED"), "DELETED");
});

test("ignores a status it does not recognise rather than guessing", () => {
  assert.equal(toInvoiceStatus("SOMETHING_NEW"), null);
  assert.equal(toInvoiceStatus(undefined), null);
  assert.equal(toInvoiceStatus(null), null);
});

test("a status is matched case-insensitively", () => {
  assert.equal(toInvoiceStatus("authorised"), "AUTHORISED");
});

// The webhook applies a status only when it ranks higher, so a replayed or
// out-of-order delivery cannot walk a paid claim backwards.
test("ranks forward through the invoice lifecycle", () => {
  assert.ok(invoiceStatusRank("DRAFT") < invoiceStatusRank("SUBMITTED"));
  assert.ok(invoiceStatusRank("SUBMITTED") < invoiceStatusRank("AUTHORISED"));
  assert.ok(invoiceStatusRank("AUTHORISED") < invoiceStatusRank("PAID"));
});

test("the terminal states share a rank, so none supersedes another", () => {
  assert.equal(invoiceStatusRank("PAID"), invoiceStatusRank("VOIDED"));
  assert.equal(invoiceStatusRank("VOIDED"), invoiceStatusRank("DELETED"));
});

test("a late AUTHORISED event cannot un-pay a paid claim", () => {
  assert.ok(invoiceStatusRank("AUTHORISED") < invoiceStatusRank("PAID"));
});

test("only unsettled claims count as pending", () => {
  assert.equal(isPendingInvoiceStatus("AUTHORISED"), true);
  assert.equal(isPendingInvoiceStatus("DRAFT"), true);
  assert.equal(isPendingInvoiceStatus("SUBMITTED"), true);
  assert.equal(isPendingInvoiceStatus("PAID"), false);
  assert.equal(isPendingInvoiceStatus("VOIDED"), false);
  assert.equal(isPendingInvoiceStatus("DELETED"), false);
});

test("parses a plain Xero calendar date", () => {
  assert.equal(parseXeroDate("2026-09-02")?.toISOString(), "2026-09-02T00:00:00.000Z");
});

// Some Accounting API fields still come back in the legacy .NET encoding;
// handing that to `new Date()` yields Invalid Date and a silently null due date.
test("parses the legacy /Date(...)/ encoding", () => {
  assert.equal(
    parseXeroDate("/Date(1642636800000+0000)/")?.getTime(),
    1642636800000,
  );
});

test("returns null for a missing or unparseable date", () => {
  assert.equal(parseXeroDate(undefined), null);
  assert.equal(parseXeroDate(null), null);
  assert.equal(parseXeroDate(""), null);
  assert.equal(parseXeroDate("not a date"), null);
});
