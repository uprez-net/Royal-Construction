import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getScreenTitle,
  getShellSectionSlug,
  getShellTrail,
} from "../../utils/shell-nav";

// The shell matched nav items against the LAST path segment, so on /offers/123
// no item was active and aria-current was missing; the header read "Creating
// Offer for Lead #123" on every offer, issued or not, and the trail skipped the
// section the user was in.

test("a nested route keeps its section active", () => {
  assert.equal(getShellSectionSlug("/offers/123"), "offers");
  assert.equal(getShellSectionSlug("/offers"), "offers");
  assert.equal(getShellSectionSlug("/admin/offer-content/"), "admin");
  assert.equal(getShellSectionSlug("/"), "dashboard");
});

test("a numeric segment is titled as the lead", () => {
  assert.equal(getScreenTitle("123"), "Lead #123");
  assert.equal(getScreenTitle(""), "Dashboard");
  assert.equal(getScreenTitle("tradie-management"), "Tradie Management");
});

test("a slug that only starts with a digit is not a lead", () => {
  assert.equal(getScreenTitle("2fa-settings"), "2fa Settings");
});

test("the trail names the section above a nested screen", () => {
  assert.deepEqual(getShellTrail("/offers/123", "Lead #123"), [
    "Home",
    "Offers",
    "Lead #123",
  ]);
  assert.deepEqual(getShellTrail("/offers", "Offers"), ["Home", "Offers"]);
  assert.deepEqual(getShellTrail("/", "Dashboard"), ["Home", "Dashboard"]);
});

test("the section is not repeated when the screen is the section", () => {
  assert.deepEqual(getShellTrail("/offers/", "Offers"), ["Home", "Offers"]);
});
