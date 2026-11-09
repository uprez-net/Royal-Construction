import assert from "node:assert/strict";
import { test } from "vitest";

import {
  chatDayLabel,
  chatTime,
  fileKindLabel,
  formatFileSize,
  formatMediaDuration,
  initials,
  peaksFromSamples,
  placeholderPeaks,
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

test("the media workflow's retry count matches the domain's attempt limit", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { REPO_ROOT } = await import("../support/repo-root");
  const { MAX_MEDIA_ATTEMPTS } = await import("@/lib/domain/whatsapp/media");
  const source = readFileSync(
    join(REPO_ROOT, "lib/workflow/whatsapp-media.ts"),
    "utf8",
  );
  // A literal in the workflow (the sandbox cannot load the domain module), so
  // pin it here: retries + the first attempt = the domain's limit.
  const retries = Number(source.match(/storeOne\.maxRetries = (\d+);/)?.[1]);
  assert.equal(retries + 1, MAX_MEDIA_ATTEMPTS);
});

test("media clocks read like a phone's", () => {
  assert.equal(formatMediaDuration(7.9), "0:07");
  assert.equal(formatMediaDuration(102), "1:42");
  assert.equal(formatMediaDuration(3725), "1:02:05");
  assert.equal(formatMediaDuration(Number.POSITIVE_INFINITY), "0:00");
  assert.equal(formatMediaDuration(null), "0:00");
});

test("the waveform follows the recording's loudness, quietest still visible", () => {
  // Two quiet slices, then two loud ones.
  const samples = [0.1, -0.1, 0.1, -0.1, 0.8, -0.8, 0.8, -0.8];
  const peaks = peaksFromSamples(samples, 4);
  assert.equal(peaks.length, 4);
  assert.equal(peaks[3], 1);
  assert.ok(peaks[0] < peaks[2]);
  assert.ok(peaks.every((peak) => peak >= 0.08 && peak <= 1));
  assert.deepEqual(peaksFromSamples([0, 0, 0, 0], 2), [0.08, 0.08]);
  assert.deepEqual(peaksFromSamples([], 3), [0.08, 0.08, 0.08]);
});

test("the stand-in waveform is stable per file and differs between files", () => {
  assert.deepEqual(
    placeholderPeaks("media-1", 36),
    placeholderPeaks("media-1", 36),
  );
  assert.notDeepEqual(
    placeholderPeaks("media-1", 36),
    placeholderPeaks("media-2", 36),
  );
  assert.ok(
    placeholderPeaks("x", 36).every((peak) => peak >= 0.08 && peak <= 1),
  );
});
