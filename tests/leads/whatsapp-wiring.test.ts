import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "vitest";

import { REPO_ROOT } from "../support/repo-root";
import {
  formatSydneyStamp,
  mergeWhatsAppMessages,
  whatsappStatusLabel,
  whatsappStatusTone,
} from "@/lib/leads/whatsapp-format";
import type { WhatsAppMessageDto } from "@/lib/leads/whatsapp-types";

// The App side of issue #333, read at the source where the code under test is
// a React component no test can import.

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

const tableView = read("components/leads/views/table-view.tsx");
const detail = read("components/leads/detail/lead-detail-screen.tsx");
const header = read("components/leads/detail/lead-header.tsx");

test("the list's desktop row and mobile card open the one WhatsApp modal", () => {
  // Both views read the same gate and open the same modal pointer.
  const gates = tableView.match(/actions\.whatsapp\.visible/g) ?? [];
  assert.equal(gates.length, 2, "desktop and mobile must both gate on actions.whatsapp");
  const opens = tableView.match(/setWhatsappLead\(lead\)/g) ?? [];
  assert.equal(opens.length, 2, "desktop and mobile must both open the modal");
  assert.match(tableView, /<LeadWhatsAppModal/);
  assert.match(
    tableView,
    /from "@\/components\/leads\/whatsapp\/lead-whatsapp-modal"/,
  );
});

test("the lead page opens the same modal component, not a copy", () => {
  assert.match(
    detail,
    /import \{ LeadWhatsAppModal \} from "@\/components\/leads\/whatsapp\/lead-whatsapp-modal"/,
  );
  assert.match(detail, /<LeadWhatsAppModal/);
  assert.match(header, /actions\.whatsapp\.visible/);
  assert.match(header, /onWhatsAppClick/);
});

test("the email action no longer calls itself a text", () => {
  assert.doesNotMatch(header, />\s*Send Text\s*</);
  assert.doesNotMatch(tableView, /\n\s*Text\n/);
});

test("the list reads one summary per page, not the threads", () => {
  assert.match(tableView, /fetchWhatsAppSummaries\(leadIds,/);
  assert.doesNotMatch(tableView, /fetchWhatsAppThread/);
});

// ── Routes are adapters ────────────────────────────────────────────────────

function routeFiles(dir: string): string[] {
  const absolute = join(REPO_ROOT, dir);
  return readdirSync(absolute).flatMap((entry) => {
    const full = join(absolute, entry);
    if (statSync(full).isDirectory()) {
      return routeFiles(relative(REPO_ROOT, full));
    }
    return entry === "route.ts" ? [relative(REPO_ROOT, full)] : [];
  });
}

const whatsappRoutes = [
  ...routeFiles("app/api/(data)/leads/[leadId]/whatsapp"),
  ...routeFiles("app/api/(data)/leads/whatsapp"),
];

test("every WhatsApp route calls lib/domain and never writes the tables itself", () => {
  assert.ok(whatsappRoutes.length >= 7, `found ${whatsappRoutes.length} routes`);
  for (const route of whatsappRoutes) {
    const source = read(route);
    assert.match(source, /@\/lib\/domain\/leads\/whatsapp\//, route);
    assert.doesNotMatch(
      source,
      /prisma\.(leadWhatsApp\w*|whatsApp\w*|lead)\./,
      `${route} reaches the database directly`,
    );
    assert.match(source, /domainErrorResponse\(error\)/, route);
    // An unauthenticated request gets a system principal from
    // currentPrincipal(), which counts as staff — refuse it before the domain.
    assert.match(source, /signedInUserPrincipal\(\)/, route);
  }
});

test("the send route requires an Idempotency-Key and has no derived fallback", () => {
  const route = read("app/api/(data)/leads/[leadId]/whatsapp/messages/route.ts");
  assert.match(route, /headers\.get\("idempotency-key"\)/);
  assert.match(route, /if \(!idempotencyKey\) \{\s*return badRequestResponse\(/);
  assert.match(route, /sendLeadWhatsAppMessage\(/);
  assert.match(route, /createWhatsAppPortFromEnv\(\)/);
});

test("the open thread polls while visible so an inbound reply appears", () => {
  const hook = read("hooks/use-lead-whatsapp-thread.ts");
  assert.match(hook, /setInterval\(/);
  assert.match(hook, /document\.visibilityState === "visible"/);
  assert.match(hook, /clearInterval\(/);
});

test("inbound bodies are never rendered as HTML", () => {
  for (const file of [
    "components/leads/whatsapp/whatsapp-thread.tsx",
    "components/leads/whatsapp/unmatched-whatsapp-review.tsx",
  ]) {
    assert.doesNotMatch(read(file), /dangerouslySetInnerHTML/, file);
  }
});

// ── Display rules ──────────────────────────────────────────────────────────

test("status labels say what happened, including an unconfirmed send", () => {
  assert.equal(
    whatsappStatusLabel({ needsReconciliation: false, status: "QUEUED" }),
    "Queued",
  );
  assert.equal(
    whatsappStatusLabel({ needsReconciliation: false, status: "RECEIVED" }),
    "Received",
  );
  assert.equal(
    whatsappStatusLabel({ needsReconciliation: true, status: "QUEUED" }),
    "Unconfirmed — needs checking",
  );
  assert.equal(
    whatsappStatusTone({ needsReconciliation: false, status: "FAILED" }),
    "danger",
  );
});

test("timestamps are Sydney time, whatever the browser's zone", () => {
  // 03:30 UTC on 22 Sept is 1:30 pm AEST.
  assert.match(formatSydneyStamp("2026-09-22T03:30:00.000Z"), /1:30\s?pm AEST$/i);
  // 03:30 UTC on 22 Dec is 2:30 pm AEDT.
  assert.match(formatSydneyStamp("2026-12-22T03:30:00.000Z"), /2:30\s?pm AEDT$/i);
  assert.equal(formatSydneyStamp(null), "");
});

test("merging pages keeps one row per message, oldest first, fresher copy wins", () => {
  const message = (id: string, at: string, status = "SENT") =>
    ({ id, occurredAt: at, status }) as unknown as WhatsAppMessageDto;
  const merged = mergeWhatsAppMessages(
    [message("b", "2026-09-22T02:00:00.000Z", "QUEUED")],
    [
      message("a", "2026-09-22T01:00:00.000Z"),
      message("b", "2026-09-22T02:00:00.000Z", "DELIVERED"),
    ],
  );
  assert.deepEqual(
    merged.map((m) => [m.id, m.status]),
    [
      ["a", "SENT"],
      ["b", "DELIVERED"],
    ],
  );
});
