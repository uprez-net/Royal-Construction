import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import {
  getScreenTitle,
  getShellSectionSlug,
  getShellTrail,
} from "@/utils/shell-nav";

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
  assert.equal(getScreenTitle("agent"), "Operations Agent");
  assert.equal(getScreenTitle("123"), "Lead #123");
  assert.equal(getScreenTitle(""), "Dashboard");
  assert.equal(getScreenTitle("tradie-management"), "Tradie Management");
});

test("a slug that only starts with a digit is not a lead", () => {
  assert.equal(getScreenTitle("2fa-settings"), "2fa Settings");
});

const HOME = { label: "Home", href: "/dashboard" };

test("the trail names the section above a nested screen, as links", () => {
  assert.deepEqual(getShellTrail("/offers/123", "Lead #123"), [
    HOME,
    { label: "Offers", href: "/offers" },
    { label: "Lead #123" },
  ]);
  assert.deepEqual(getShellTrail("/admin/admin-approvals", "Admin Approvals"), [
    HOME,
    { label: "Admin", href: "/admin" },
    { label: "Admin Approvals" },
  ]);
  assert.deepEqual(getShellTrail("/offers", "Offers"), [
    HOME,
    { label: "Offers" },
  ]);
  assert.deepEqual(getShellTrail("/", "Dashboard"), [
    HOME,
    { label: "Dashboard" },
  ]);
});

test("the section is not repeated when the screen is the section", () => {
  assert.deepEqual(getShellTrail("/offers/", "Offers"), [
    HOME,
    { label: "Offers" },
  ]);
});

// The helper alone does not stop the shell drifting back to its own last-segment
// slug, so pin the wiring: every active-class and aria-current comparison, on
// desktop and in the mobile sheet, reads the section slug.
test("the shell highlights nav items by the section slug", () => {
  const shell = readFileSync(
    join(process.cwd(), "components/common/app-shell.tsx"),
    "utf8",
  );
  assert.match(shell, /const sectionSlug = getShellSectionSlug\(pathName\);/);
  assert.doesNotMatch(shell, /===\s*item\.slug\b/);
  const compared = [...shell.matchAll(/item\.slug\s*[!=]==?\s*([\w$.]+)/g)].map(
    (match) => match[1],
  );
  assert.ok(
    compared.length >= 5,
    `expected 5 comparisons, found ${compared.length}`,
  );
  assert.deepEqual(new Set(compared), new Set(["sectionSlug"]));
});
