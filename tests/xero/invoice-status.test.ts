import assert from "node:assert/strict";
import { test } from "vitest";

import {
  invoiceStatusRank,
  isPendingInvoiceStatus,
  toInvoiceStatus,
} from "@/lib/xero/invoice-status";
import { parseXeroDate } from "@/lib/xero/xero-date";

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
  assert.equal(
    parseXeroDate("2026-09-02")?.toISOString(),
    "2026-09-02T00:00:00.000Z",
  );
});

// The shape that broke production. The SDK types every Xero date as `string`,
// but its deserializer converts the legacy `/Date(...)/` encoding to a Date
// before handing it over, so the declared type is wrong about half the time.
test("accepts the Date the SDK hands back despite typing it as a string", () => {
  const asDate = new Date(1757548800000);

  assert.equal(parseXeroDate(asDate)?.getTime(), 1757548800000);
});

test("parses the legacy /Date(...)/ encoding when it arrives unconverted", () => {
  assert.equal(
    parseXeroDate("/Date(1642636800000+0000)/")?.getTime(),
    1642636800000,
  );
});

test("accepts epoch milliseconds", () => {
  assert.equal(parseXeroDate(1642636800000)?.getTime(), 1642636800000);
});

// Total by design: this runs after an invoice already exists in Xero, so
// throwing here would strand a real claim with no record of it on our side.
test("returns null for anything unusable rather than throwing", () => {
  assert.equal(parseXeroDate(undefined), null);
  assert.equal(parseXeroDate(null), null);
  assert.equal(parseXeroDate(""), null);
  assert.equal(parseXeroDate("not a date"), null);
  assert.equal(parseXeroDate(new Date("nonsense")), null);
  assert.equal(parseXeroDate(Number.NaN), null);
  assert.equal(parseXeroDate({}), null);
  assert.equal(parseXeroDate([]), null);
  assert.equal(parseXeroDate(true), null);
});
