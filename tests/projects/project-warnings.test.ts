import assert from "node:assert/strict";
import { test } from "node:test";

import {
    describeTradieAlerts,
    selectComplianceWarnings,
    selectTradieAlerts,
} from "../../lib/projects/project-warnings";
import type {
    ProjectDetail,
    TradieScheduleWithTradieAndMilestone,
} from "../../types/project";

/**
 * `get_project_warnings` has to give an agent the same answer the warning chips
 * and alert cards are giving the person looking at the screen. These cover the
 * rules that decide what counts as a warning; whether the screen still agrees
 * is what the Puppeteer suite is for.
 */

const projectWith = (
    status: ProjectDetail["status"],
    legalAdministration: Record<string, unknown>,
) => ({
    id: "p1",
    name: "Henderson",
    status,
    requirements: { legalAdministration },
} as unknown as ProjectDetail);

const scheduleWith = (
    overrides: Partial<{ status: string; targetDate: Date | null }>,
) => ({
    id: "s1",
    status: overrides.status ?? "PENDING",
    scheduledDate: new Date("2026-09-01"),
    tradie: { name: "Dave", trade: "Concreter" },
    milestone: overrides.targetDate === null
        ? null
        : { name: "Slab pour", targetDate: overrides.targetDate },
} as unknown as TradieScheduleWithTradieAndMilestone);

test("compliance gaps only count on a live job", () => {
    const missing = { pcaInspector: "", hbcfInsuranceNumber: "  " };

    assert.equal(selectComplianceWarnings(projectWith("ACTIVE", missing)).length, 2);
    assert.equal(selectComplianceWarnings(projectWith("NEEDS_ATTENTION", missing)).length, 2);

    // A finished job has no site to inspect. Flagging it would be noise the
    // user cannot act on.
    assert.equal(selectComplianceWarnings(projectWith("COMPLETED", missing)).length, 0);
    assert.equal(selectComplianceWarnings(projectWith("ON_TRACK", missing)).length, 0);
});

test("a filled-in live job raises nothing", () => {
    const warnings = selectComplianceWarnings(
        projectWith("ACTIVE", { pcaInspector: "K. Rowe", hbcfInsuranceNumber: "HB-9912" }),
    );
    assert.deepEqual(warnings, []);
});

test("an unreadable signed date is flagged whatever the status", () => {
    // Unlike the two above this is wrong information rather than missing
    // information, and it stays wrong after the job finishes.
    const warnings = selectComplianceWarnings(
        projectWith("COMPLETED", { signedDate: "sometime in March" }),
    );
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].field, "signedDate");
});

test("a readable signed date is not flagged", () => {
    assert.deepEqual(
        selectComplianceWarnings(projectWith("COMPLETED", { signedDate: "2026-03-04" })),
        [],
    );
});

test("a confirmed booking always alerts, whenever its milestone is due", () => {
    const now = new Date("2026-09-01");
    const far = scheduleWith({ status: "CONFIRMED", targetDate: new Date("2027-01-01") });

    assert.equal(selectTradieAlerts([far], now).length, 1);
});

test("an unconfirmed booking alerts only inside the week", () => {
    const now = new Date("2026-09-01");
    const soon = scheduleWith({ status: "PENDING", targetDate: new Date("2026-09-04") });
    const later = scheduleWith({ status: "PENDING", targetDate: new Date("2026-10-01") });
    const undated = scheduleWith({ status: "PENDING", targetDate: null });

    assert.equal(selectTradieAlerts([soon], now).length, 1);
    assert.equal(selectTradieAlerts([later], now).length, 0);
    assert.equal(selectTradieAlerts([undated], now).length, 0);
});

test("the tool shape names the tradie, the trade and the milestone", () => {
    // An agent reporting "one booking needs attention" is useless; it has to be
    // able to say which tradie, for what, and when.
    const now = new Date("2026-09-01");
    const [alert] = describeTradieAlerts(
        [scheduleWith({ status: "CONFIRMED", targetDate: new Date("2026-09-03") })],
        now,
    );

    assert.equal(alert.tradie, "Dave");
    assert.equal(alert.trade, "Concreter");
    assert.equal(alert.milestone, "Slab pour");
    assert.equal(alert.status, "CONFIRMED");
});

test("a booking with no milestone still reads as something", () => {
    const now = new Date("2026-09-01");
    const [alert] = describeTradieAlerts(
        [scheduleWith({ status: "CONFIRMED", targetDate: null })],
        now,
    );

    assert.equal(alert.milestone, "general works");
    assert.equal(alert.milestoneTargetDate, null);
});
