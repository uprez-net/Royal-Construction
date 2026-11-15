import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, test } from "vitest";

import {
  ResultStatus,
  resultStatusText,
} from "@/components/common/result-status";
import { nextTabIndex } from "@/lib/a11y/tab-keys";

describe("resultStatusText", () => {
  test("says nothing until the count is known", () => {
    assert.equal(resultStatusText({ count: null, noun: "lead" }), "");
  });
  test("zero is spoken, not silent", () => {
    assert.equal(
      resultStatusText({ count: 0, noun: "lead" }),
      "No leads found",
    );
  });
  test("singular and plural", () => {
    assert.equal(resultStatusText({ count: 1, noun: "result" }), "1 result");
    assert.equal(resultStatusText({ count: 2, noun: "result" }), "2 results");
  });
  test("a paged list says how much of the whole is on screen", () => {
    assert.equal(
      resultStatusText({ count: 42, noun: "lead", shown: 10 }),
      "Showing 10 of 42 leads",
    );
    assert.equal(
      resultStatusText({ count: 1, noun: "project", shown: 1 }),
      "Showing 1 of 1 project",
    );
  });
});

describe("ResultStatus", () => {
  const html = (props: Parameters<typeof ResultStatus>[0]) =>
    renderToStaticMarkup(createElement(ResultStatus, props));

  test("is always a polite status region, even with nothing to say", () => {
    assert.match(html({ count: null, noun: "lead" }), /<p role="status"/);
  });
  test("hideWhenEmpty keeps the zero message off screen but still spoken", () => {
    const out = html({
      count: 0,
      noun: "lead",
      className: "visible-line",
      hideWhenEmpty: true,
    });
    assert.match(out, /class="sr-only"/);
    assert.match(out, /No leads found/);
  });
  test("a count uses the caller's class", () => {
    assert.match(
      html({ count: 3, noun: "lead", className: "visible-line" }),
      /class="visible-line"/,
    );
  });
});

describe("nextTabIndex", () => {
  test("arrows move and wrap", () => {
    assert.equal(nextTabIndex("ArrowRight", 0, 3), 1);
    assert.equal(nextTabIndex("ArrowRight", 2, 3), 0);
    assert.equal(nextTabIndex("ArrowLeft", 0, 3), 2);
    assert.equal(nextTabIndex("ArrowLeft", 2, 3), 1);
  });
  test("Home and End jump", () => {
    assert.equal(nextTabIndex("Home", 2, 3), 0);
    assert.equal(nextTabIndex("End", 0, 3), 2);
  });
  test("other keys are left alone", () => {
    assert.equal(nextTabIndex("Enter", 0, 3), null);
    assert.equal(nextTabIndex("a", 0, 3), null);
  });
  test("an empty strip has nowhere to go", () => {
    assert.equal(nextTabIndex("ArrowRight", 0, 0), null);
  });
});
