import assert from "node:assert/strict";
import { test } from "vitest";

import { createNotification } from "@/types/notification";

const PROJECT = { projectId: "p-1", projectName: "12 Example St" };

/**
 * Mirrors `certifierExtractPayloadFromUrl` in
 * components/notification/notification-item.tsx.
 *
 * Duplicated rather than imported because that module is a client component
 * pulling in Redux, Novu and lucide — none of which loads under the node test
 * runner. The point of the test is that the template and the parser agree on
 * the query-string contract, so the parser's logic is restated here and any
 * drift in the template fails it.
 */
function parseExtractUrl(url: string) {
  const cleaned = url.replaceAll("&amp;", "&");
  const [path, query = ""] = cleaned.split("?");
  const params = new URLSearchParams(query);
  const engagementId = params.get("engagementId");
  const documentId = params.get("documentId");
  const projectId = path.split("/").filter(Boolean).pop();

  if (!engagementId || !documentId || !projectId) {
    return null;
  }
  return { projectId, engagementId, documentId };
}

test("a certifier reply with a checklist carries every id the popup needs", () => {
  const notification = createNotification("certifierResponseReceived", {
    ...PROJECT,
    engagementId: "e-1",
    attachmentCount: 3,
    checklistDocumentId: "d-9",
  });

  assert.match(notification.url, /action=certifierExtract/);
  assert.deepEqual(parseExtractUrl(notification.url), {
    projectId: "p-1",
    engagementId: "e-1",
    documentId: "d-9",
  });
  assert.match(notification.message, /including a checklist/);
});

test("a certifier reply without a checklist does not offer an extraction", () => {
  const notification = createNotification("certifierResponseReceived", {
    ...PROJECT,
    engagementId: "e-1",
    attachmentCount: 1,
  });

  // The whole point: a reply that is just an invoice must not open a popup
  // with nothing to run against.
  assert.doesNotMatch(notification.url, /action=certifierExtract/);
  assert.equal(parseExtractUrl(notification.url), null);
  assert.equal(notification.url, "/projects/p-1?activeTab=compliance");
});

test("every compliance notification deep-links to the compliance tab", () => {
  const notifications = [
    createNotification("certifierOutreachSent", {
      ...PROJECT,
      certifierEmail: "certifier@example.com.au",
      documentCount: 6,
    }),
    createNotification("certifierResponseReceived", {
      ...PROJECT,
      engagementId: "e-1",
      attachmentCount: 2,
    }),
    createNotification("complianceChecklistExtracted", {
      ...PROJECT,
      itemCount: 8,
    }),
    createNotification("complianceDocumentRejected", {
      ...PROJECT,
      documentLabel: "Survey",
      rejectionReason: "The levels are missing.",
      resolvedBy: "Dana",
    }),
    createNotification("complianceReviewSent", {
      ...PROJECT,
      documentCount: 8,
    }),
    createNotification("complianceApproved", PROJECT),
  ];

  for (const notification of notifications) {
    assert.match(
      notification.url,
      /^\/projects\/p-1\?activeTab=compliance/,
      notification.title,
    );
    assert.match(notification.title, /12 Example St/, notification.title);
    assert.ok(notification.message.length > 0, notification.title);
  }
});

test("counts read correctly in the singular", () => {
  assert.match(
    createNotification("certifierOutreachSent", {
      ...PROJECT,
      certifierEmail: "c@example.com",
      documentCount: 1,
    }).message,
    /1 document sent/,
  );
  assert.match(
    createNotification("complianceChecklistExtracted", {
      ...PROJECT,
      itemCount: 1,
    }).message,
    /1 item,/,
  );
  assert.match(
    createNotification("complianceChecklistExtracted", {
      ...PROJECT,
      itemCount: 8,
    }).message,
    /8 items,/,
  );
});

test("a rejection says what has to change", () => {
  const notification = createNotification("complianceDocumentRejected", {
    ...PROJECT,
    documentLabel: "Section 10.7(2) & (5) Planning Certificate",
    rejectionReason: "Issued for the wrong lot.",
    resolvedBy: "Dana",
  });

  // The reason is the only thing telling whoever re-uploads what was wrong, so
  // it has to survive into the notification rather than living only on the row.
  assert.match(notification.message, /Issued for the wrong lot\./);
  assert.match(notification.message, /Section 10\.7\(2\) & \(5\)/);
  assert.match(notification.message, /Dana/);
});
