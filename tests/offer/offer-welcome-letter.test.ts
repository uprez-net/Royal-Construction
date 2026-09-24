import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildWelcomeParagraphs,
  siteLocality,
} from "@/lib/offer/workspace-proposal-content";
import { INITIAL_OFFER_JOB } from "@/lib/offer/workspace-model";

// Issue #345: offer 105's welcome read "your forever home at Australia" and
// told the client their plans had been reviewed, which nothing on the offer
// records.

function opening(siteAddress: string): string {
  return buildWelcomeParagraphs({ ...INITIAL_OFFER_JOB, siteAddress })[0];
}

test("a geocoded address names the suburb, not the country", () => {
  assert.equal(siteLocality("Kellyville NSW 2155, Australia"), "Kellyville");
  assert.match(
    opening("Kellyville NSW 2155, Australia"),
    /home at Kellyville\./,
  );
});

test("the suburb is found wherever the state sits", () => {
  for (const [address, suburb] of [
    ["13 Binalong Road, Pendle Hill NSW 2145", "Pendle Hill"],
    ["13 Binalong Road, Pendle Hill NSW 2145, Australia", "Pendle Hill"],
    ["13 Binalong Road, Pendle Hill NSW 2145 Australia", "Pendle Hill"],
    ["Unit 3, 13 Binalong Road, Pendle Hill NSW 2145", "Pendle Hill"],
    ["13 Binalong Road, Pendle Hill, NSW 2145", "Pendle Hill"],
    ["13 Binalong Road, Pendle Hill", "Pendle Hill"],
  ] as const) {
    assert.equal(siteLocality(address), suburb, address);
  }
});

test("a state spelt out is skipped, not taken for the suburb", () => {
  for (const [address, suburb] of [
    [
      "13 Binalong Road, Pendle Hill, New South Wales, Australia",
      "Pendle Hill",
    ],
    ["13 Binalong Road, Pendle Hill, New South Wales 2145", "Pendle Hill"],
    ["13 Binalong Road, Pendle Hill New South Wales 2145", "Pendle Hill"],
    ["1 Hay St, Victoria Park, Western Australia 6100", "Victoria Park"],
  ] as const) {
    assert.equal(siteLocality(address), suburb, address);
  }
});

test("Australia is dropped as the country, never cut out of a state name", () => {
  for (const [address, suburb] of [
    ["1 King William St, Adelaide, South Australia", "Adelaide"],
    [
      "1 King William St, Adelaide, South Australia 5000, Australia",
      "Adelaide",
    ],
    ["1 King William St, Adelaide SA 5000, South Australia", "Adelaide"],
    ["1 Hay St, Perth, Western Australia", "Perth"],
  ] as const) {
    assert.equal(siteLocality(address), suburb, address);
  }
});

test("an address with no reliable suburb is quoted whole", () => {
  const address = "13 Binalong Road Pendle Hill NSW 2145";
  assert.equal(siteLocality(address), null);
  assert.match(opening(address), new RegExp(`home at ${address}\\.`));
  assert.equal(siteLocality("Lot 12 Riverstone"), null);
});

test("no address leaves the location out rather than printing 'at .'", () => {
  assert.match(opening(""), /build your forever home\. We don't/);
});

test("the letter does not claim the plans were reviewed", () => {
  const paragraphs = buildWelcomeParagraphs({
    ...INITIAL_OFFER_JOB,
    siteAddress: "Kellyville NSW 2155, Australia",
  });
  for (const paragraph of paragraphs) {
    assert.doesNotMatch(paragraph, /reviewed/i);
  }
});
