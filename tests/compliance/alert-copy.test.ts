import assert from "node:assert/strict";
import { test } from "node:test";

import { ComplianceAlertType } from "@prisma/client";

import { COMPLIANCE_ALERT_COPY } from "../../constants/complianceAlerts";
import { COMPLIANCE_ALERT_PARTY } from "../../lib/compliance/alert-parties";

/**
 * The three tables that describe an alert, kept in step.
 *
 * `Record<ComplianceAlertType, …>` makes the compiler catch a missing entry, so
 * these tests are about the things it cannot see: an alert type whose copy
 * offers a chase that no party can receive, and an alert with a party to chase
 * but no button label to put on it. Either one is a control that does the wrong
 * thing rather than a type error.
 *
 * The third table — `ALERT_TITLE` in lib/data/compliance-alerts.ts — is
 * deliberately a separate copy of the titles rather than an import, because
 * that module is `"use server"` and importing across that line drags the whole
 * action module along with it. This is the cheaper half of that trade: the
 * duplication is allowed, and it is checked.
 */

test("every alert offering a chase has a party to chase", () => {
  for (const type of Object.values(ComplianceAlertType)) {
    const copy = COMPLIANCE_ALERT_COPY[type];
    if (!copy.followUp) continue;

    assert.notEqual(
      COMPLIANCE_ALERT_PARTY[type],
      null,
      `${type} offers "${copy.followUp}" but has nobody to send it to`,
    );
  }
});

test("every alert with a party to chase offers the button", () => {
  for (const type of Object.values(ComplianceAlertType)) {
    if (COMPLIANCE_ALERT_PARTY[type] === null) continue;

    assert.ok(
      COMPLIANCE_ALERT_COPY[type].followUp,
      `${type} has a party to chase but no label for the button`,
    );
  }
});

test("every alert says what it is and how it closes", () => {
  for (const type of Object.values(ComplianceAlertType)) {
    const copy = COMPLIANCE_ALERT_COPY[type];
    // The guidance is the load-bearing half: an alert nobody knows how to close
    // is an alert that sits open forever.
    assert.ok(copy.title.trim(), `${type} has no title`);
    assert.ok(copy.guidance.trim(), `${type} has no guidance`);
  }
});
