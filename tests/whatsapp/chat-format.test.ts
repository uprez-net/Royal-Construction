import assert from "node:assert/strict";
import { test } from "vitest";

import {
  chatDayLabel,
  chatTime,
  fileKindLabel,
  formatFileSize,
  initials,
  senderColour,
} from "@/lib/whatsapp/chat-format";

// What the WhatsApp-style chat prints. Always Sydney time, whatever zone the
// browser or the test runner is in.

const NOW = new Date("2026-11-04T02:00:00Z"); // 1 pm Wed 4 Nov in Sydney

test("bubble times are Sydney's, lower-case like WhatsApp's", () => {
  assert.equal(chatTime("2026-11-04T02:05:00Z"), "1:05 pm");
  assert.equal(chatTime("not a date"), "");
});

test("day separators say Today, Yesterday, a weekday, then the date", () => {
  assert.equal(chatDayLabel("2026-11-04T00:30:00Z", NOW), "Today");
  // 11:30 pm on the 3rd UTC is already the 4th in Sydney.
  assert.equal(chatDayLabel("2026-11-03T23:30:00Z", NOW), "Today");
  assert.equal(chatDayLabel("2026-11-03T02:00:00Z", NOW), "Yesterday");
  assert.equal(chatDayLabel("2026-11-01T02:00:00Z", NOW), "Sunday");
  assert.equal(chatDayLabel("2026-10-01T02:00:00Z", NOW), "1 October 2026");
});

test("file sizes and kinds read like a phone's", () => {
  assert.equal(formatFileSize(512), "512 B");
  assert.equal(formatFileSize(840 * 1024), "840 KB");
  assert.equal(formatFileSize(1.25 * 1024 * 1024), "1.3 MB");
  assert.equal(formatFileSize(null), "");
  assert.equal(fileKindLabel("plans.pdf", null), "PDF");
  assert.equal(fileKindLabel(null, "application/pdf"), "PDF");
  assert.equal(fileKindLabel(null, null), "FILE");
});

test("initials and sender colours are stable", () => {
  assert.equal(initials("Sam Lee"), "SL");
  assert.equal(initials("ann"), "A");
  assert.equal(initials("+61 412 345 678"), "#");
  assert.equal(senderColour("+61412345678"), senderColour("+61412345678"));
});
