import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, test, vi } from "vitest";

import { Notifications } from "@/components/common/notifications";
import { REPO_ROOT } from "../support/repo-root";

// Issue #475. The bell announced "Notifications" with no unread count, and the
// popover (role=dialog) had no name, so axe aria-dialog-name fired. The popover
// content is closed during server render, so the dialog name is pinned at
// source level; the trigger's name is rendered and checked directly.

const unread = { isRead: false, isArchived: false, id: "a" };
const read = { isRead: true, isArchived: false, id: "b" };
let notifications: unknown[] = [];

vi.mock("@/context/NotificationContext", () => ({
  useNotification: () => ({
    notifications,
    isLoading: false,
    fetchNotifications: async () => {},
    markNotificationAsRead: async () => {},
    markAllAsRead: async () => {},
    archiveNotification: async () => {},
  }),
}));

const triggerLabel = (items: unknown[]) => {
  notifications = items;
  const html = renderToStaticMarkup(createElement(Notifications));
  const match = html.match(/<button[^>]*aria-label="([^"]*)"/);
  assert.ok(match, "the bell button renders with an aria-label");
  return match[1];
};

describe("notifications bell name", () => {
  test("announces the unread count when there are unread notifications", () => {
    assert.equal(
      triggerLabel([unread, unread, read]),
      "Notifications, 2 unread",
    );
  });
  test("keeps the plain name when nothing is unread", () => {
    assert.equal(triggerLabel([read]), "Notifications");
    assert.equal(triggerLabel([]), "Notifications");
  });
});

describe("notifications popover name", () => {
  test("the dialog is named by its visible heading", () => {
    const source = readFileSync(
      join(REPO_ROOT, "components/common/notifications.tsx"),
      "utf8",
    );
    const headingId = source.match(/const (\w+) = useId\(\)/)?.[1];
    assert.ok(headingId, "the heading id comes from useId");
    assert.match(
      source,
      new RegExp(`<PopoverContent\\s+aria-labelledby=\\{${headingId}\\}`),
    );
    assert.match(source, new RegExp(`<p id=\\{${headingId}\\}`));
  });
});
