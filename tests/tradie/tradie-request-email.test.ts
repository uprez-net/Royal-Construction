import assert from "node:assert/strict";

import { MilestoneStatus, TradieScheduleStatus } from "@prisma/client";
import { test } from "vitest";

import {
  defaultActivityDate,
  requestableActivities,
  requestTradeOptions,
  tradeOverview,
  type RequestMilestone,
} from "@/components/projects/detail/tradie-requests";
import type { ProjectDetail } from "@/types/project";
import {
  generateTradieBookingEmail,
  generateTradieRequestEmail,
  tradieBookingSubject,
  tradieRequestSubject,
} from "@/utils/generate-email";

// The request email is what a company outside the office prices against, and
// the wizard previews this same function, so what it says is what was sent.

const EMAIL = {
  activities: [
    {
      durationDays: 2,
      name: "Rough-in plumbing",
      scheduledDate: "2026-11-02",
      stage: "Frame",
      workLines: ["Supply and install hot and cold water lines", "  "],
    },
    {
      durationDays: 1,
      name: "Fit-off <wet areas>",
      scheduledDate: "2026-12-07T00:00:00.000Z",
      stage: "Interior Fit-Out",
      workLines: [],
    },
  ],
  note: "Gate code 1234\nPlans to follow",
  projectName: "11 Wheat Street",
  siteManager: { email: "", name: "Unassigned", phone: "" },
  subject: tradieRequestSubject({
    activityCount: 2,
    projectName: "11 Wheat Street",
    trade: "Plumbing",
  }),
  trade: "Plumbing",
  tradieName: "ABC & Sons",
};

test("one request lists every activity with its work and asks for one itemised quote", () => {
  const { html, subject } = generateTradieRequestEmail(EMAIL);
  assert.equal(
    subject,
    "Request for Quotation – 11 Wheat Street | Plumbing (2 activities)",
  );
  assert.match(html, /Dear ABC &amp; Sons,/);
  assert.match(html, /Rough-in plumbing/);
  assert.match(html, /Fit-off &lt;wet areas&gt;/);
  assert.match(html, /Supply and install hot and cold water lines/);
  assert.match(html, /one quotation covering all 2 activities/);
  assert.match(html, /itemised per activity/);
  // A blank line is dropped rather than printed as an empty bullet.
  assert.equal(html.match(/<li /g)?.length, 1);
});

test("dates are calendar days, said to be approximate", () => {
  const { html } = generateTradieRequestEmail(EMAIL);
  assert.match(html, /Approx\. start Mon, 2 Nov 2026 · 2 days/);
  assert.match(html, /Approx\. start Mon, 7 Dec 2026 · 1 day/);
  assert.match(html, /Dates are approximate/);
});

test("the office's note is escaped and keeps its line breaks", () => {
  const { html } = generateTradieRequestEmail({
    ...EMAIL,
    note: "<b>Gate</b> code 1234\nPlans to follow",
  });
  assert.match(html, /&lt;b&gt;Gate&lt;\/b&gt; code 1234<br>Plans to follow/);
  assert.doesNotMatch(
    generateTradieRequestEmail({ ...EMAIL, note: "  " }).html,
    /Notes from Royal Constructions/,
  );
});

test("an unassigned site manager is not printed as a contact", () => {
  assert.doesNotMatch(generateTradieRequestEmail(EMAIL).html, /Site Manager/);
});

// ---------------------------------------------------------------------------

const milestone = (
  overrides: Partial<RequestMilestone> & { id: string },
): RequestMilestone => ({
  estimatedDays: 3,
  name: overrides.id,
  order: 1,
  projectStage: "Frame",
  requiredTradeTypes: [],
  startDate: null,
  status: MilestoneStatus.PENDING,
  targetDate: new Date("2026-11-10T00:00:00.000Z"),
  ...overrides,
});

const MILESTONES = [
  milestone({
    id: "rough",
    order: 2,
    requiredTradeTypes: [{ id: "tt1", label: "Plumbing" }],
  }),
  milestone({ id: "loose", order: 1 }),
  milestone({
    id: "done",
    order: 3,
    requiredTradeTypes: [{ id: "tt1", label: "Plumbing" }],
    status: MilestoneStatus.DONE,
  }),
  milestone({
    id: "board",
    order: 4,
    projectStage: "Lockup",
    requiredTradeTypes: [{ id: "tt2", label: "Electrical" }],
  }),
];

test("the picker offers the open activities that need the trade, in build order", () => {
  assert.deepEqual(
    requestableActivities(MILESTONES, { trade: "plumbing" }).map((m) => m.id),
    ["rough"],
  );
  assert.deepEqual(
    requestableActivities(MILESTONES, {
      includeUnassigned: true,
      trade: "Plumbing",
    }).map((m) => m.id),
    ["loose", "rough"],
  );
  assert.deepEqual(
    requestableActivities(MILESTONES, { stage: "Lockup", trade: "Plumbing" }),
    [],
  );
});

test("trades come from the directory and from what open activities need", () => {
  assert.deepEqual(
    requestTradeOptions(MILESTONES, ["plumbing", "Others", "Tiling"]),
    ["Electrical", "plumbing", "Tiling"],
  );
});

test("an activity's date starts at its milestone, never in the past", () => {
  const today = new Date("2026-10-19T09:00:00");
  assert.equal(defaultActivityDate(MILESTONES[0], today), "2026-11-10");
  assert.equal(
    defaultActivityDate(
      {
        startDate: new Date("2026-12-01T00:00:00.000Z"),
        targetDate: new Date("2026-12-20T00:00:00.000Z"),
      },
      today,
    ),
    "2026-12-01",
  );
  assert.equal(
    defaultActivityDate(
      { startDate: null, targetDate: new Date("2026-01-01T00:00:00.000Z") },
      today,
    ),
    "2026-10-19",
  );
});

test("the trade overview compares quotes and counts covered activities", () => {
  const schedule = (
    id: string,
    tradie: { id: string; name: string },
    milestoneId: string,
    status: TradieScheduleStatus,
    quotedPrice: string | null,
  ) =>
    ({
      id,
      milestoneId,
      quotedPrice,
      scheduledDate: new Date("2026-11-02T00:00:00.000Z"),
      status,
      tradie: {
        email: "",
        id: tradie.id,
        name: tradie.name,
        phone: "0400",
        trade: "Plumbing",
      },
      tradieId: tradie.id,
    }) as unknown as ProjectDetail["tradieSchedules"][number];
  const abc = { id: "abc", name: "ABC" };
  const xyz = { id: "xyz", name: "XYZ" };
  const pqr = { id: "pqr", name: "PQR" };

  const overview = tradeOverview(
    {
      milestones: MILESTONES as unknown as ProjectDetail["milestones"],
      tradieSchedules: [
        schedule(
          "1",
          abc,
          "rough",
          TradieScheduleStatus.QUOTE_RECEIVED,
          "$450",
        ),
        schedule("2", xyz, "rough", TradieScheduleStatus.CONFIRMED, "300"),
        schedule("3", pqr, "rough", TradieScheduleStatus.AWAITING_QUOTE, null),
      ],
    },
    "Plumbing",
    new Date("2026-10-19T00:00:00.000Z"),
  );

  assert.deepEqual(
    overview.tradies.map((tradie) => [tradie.name, tradie.quotedTotal]),
    [
      ["XYZ", 300],
      ["ABC", 450],
      ["PQR", null],
    ],
  );
  assert.deepEqual(overview.stats.lowest, { amount: 300, name: "XYZ" });
  assert.equal(overview.stats.recipients, 3);
  assert.equal(overview.stats.replies, 2);
  // rough is booked (XYZ approved) and done counts as covered.
  assert.deepEqual(
    overview.activities.map((activity) => activity.milestoneId),
    ["rough", "done"],
  );
  assert.equal(overview.stats.covered, 2);
  assert.equal(overview.stats.activityCount, 2);
});

test("a direct booking asks the tradie to confirm the dates, never to quote", () => {
  const { html, subject } = generateTradieBookingEmail({
    ...EMAIL,
    reference: "RCTRQ-0A1B2C3D4E5F",
    subject: tradieBookingSubject({
      activityCount: 2,
      projectName: "11 Wheat Street",
      trade: "Plumbing",
    }),
  });
  assert.equal(
    subject,
    "Booking – Please Confirm Availability – 11 Wheat Street | Plumbing (2 activities) [RCTRQ-0A1B2C3D4E5F]",
  );
  assert.match(html, /confirm you are available/);
  assert.match(html, /Planned start/);
  assert.doesNotMatch(html, /quot(e|ation)/i);
  assert.match(html, /Our reference: <strong[^>]*>RCTRQ-0A1B2C3D4E5F/);
  // Same activity table, escaped the same way.
  assert.match(html, /Fit-off &lt;wet areas&gt;/);
});

test("a quote request carries the tradie's reference when it has one", () => {
  const withRef = generateTradieRequestEmail({
    ...EMAIL,
    reference: "RCTRQ-0A1B2C3D4E5F",
  });
  assert.match(withRef.subject, /\[RCTRQ-0A1B2C3D4E5F\]$/);
  assert.match(withRef.html, /keep this reference in the\s+subject line/);
  assert.equal(generateTradieRequestEmail(EMAIL).subject, EMAIL.subject);
});

// The wizard's preview is edited in place, and what the office rewords there
// is what each tradie receives.

test("the office's rewording replaces the template's, and each tradie keeps their own name and reference", () => {
  const copy = {
    greeting: "G'day {tradie},",
    heading: "Quote wanted",
    intro: "Line one with **bold** <b>\nLine two",
    "reference:note": "Quote {reference} when you reply.",
  };
  const forAbc = generateTradieRequestEmail({
    ...EMAIL,
    copy,
    reference: "RCTRQ-AAAAAAAAAAAA",
  });
  const forXyz = generateTradieRequestEmail({
    ...EMAIL,
    copy,
    reference: "RCTRQ-BBBBBBBBBBBB",
    tradieName: "XYZ Pty Ltd",
  });

  assert.match(forAbc.html, /G&#39;day ABC &amp; Sons,/);
  assert.match(forXyz.html, /G&#39;day XYZ Pty Ltd,/);
  assert.match(forAbc.html, /Quote wanted/);
  assert.doesNotMatch(forAbc.html, /Request for Quotation\s*<\/h1>/);
  // Plain text with **bold** and line breaks; anything else is escaped.
  assert.match(
    forAbc.html,
    /Line one with <strong>bold<\/strong> &lt;b&gt;<br>Line two/,
  );
  assert.match(forXyz.html, /Quote <strong[^>]*>RCTRQ-BBBBBBBBBBBB<\/strong>/);
  // The template's own words, for the preview to tell an edit from them.
  assert.equal(forAbc.copy.greeting, "Dear {tradie},");
  assert.equal(forAbc.copy.heading, "Request for Quotation");
});

test("only the preview marks the email editable, and never the note", () => {
  const sent = generateTradieRequestEmail(EMAIL).html;
  assert.doesNotMatch(sent, /contenteditable|data-copy|data-token/);

  const preview = generateTradieRequestEmail({
    ...EMAIL,
    activities: EMAIL.activities.map((activity, index) => ({
      ...activity,
      milestoneId: `m${index}`,
    })),
    editable: true,
  }).html;
  assert.match(preview, /data-copy="heading" contenteditable="true"/);
  assert.match(preview, /data-copy="activity:m0:dates"/);
  // A work line keeps its index in the office's list, blanks included.
  assert.match(
    preview,
    /data-copy="work:m0:0" contenteditable="true">Supply and install/,
  );
  assert.match(
    preview,
    /data-token="tradie" contenteditable="false">ABC &amp; Sons/,
  );
  const note = preview.slice(preview.indexOf("Notes from Royal Constructions"));
  assert.doesNotMatch(
    note.slice(0, note.indexOf("</div>")),
    /contenteditable="true"/,
  );
});
