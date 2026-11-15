import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, test, vi } from "vitest";

import { NotificationItem } from "@/components/notification/notification-item";
import { TooltipProvider } from "@/components/ui/tooltip";

// Issue #442. The card opened its notification from a <div onClick>, which a
// keyboard cannot reach, so a notification with a link could only be opened
// with a mouse. A notification that has a real destination now also exposes
// its title as a button; one without a link has nothing to open and stays text.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("@/lib/store/hooks", () => ({ useAppDispatch: () => () => {} }));

const render = (redirect: { url: string; target: string } | undefined) =>
  renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(NotificationItem, {
        // Only the fields the card reads.
        n: {
          id: "n1",
          subject: "Quote accepted",
          body: "",
          isRead: false,
          createdAt: new Date().toISOString(),
          redirect,
        } as unknown as Parameters<typeof NotificationItem>[0]["n"],
        busyId: null,
        handleMarkOne: async () => {},
        handleArchive: async () => {},
        close: () => {},
      }),
    ),
  );

describe("NotificationItem keyboard access", () => {
  test("a notification with a link has its title as a button", () => {
    const html = render({ url: "/projects/1", target: "_self" });
    assert.match(
      html,
      /<button[^>]*type="button"[^>]*>Quote accepted<\/button>/,
    );
  });
  test("a notification without a link keeps a plain title", () => {
    const html = render(undefined);
    assert.doesNotMatch(html, />Quote accepted<\/button>/);
    assert.match(html, /<p[^>]*>Quote accepted<\/p>/);
  });
  test("the hover-only actions also show when focus is inside the card", () => {
    assert.match(render(undefined), /group-focus-within:opacity-100/);
  });
});
