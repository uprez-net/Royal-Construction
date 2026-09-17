import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { graphResourceBelongsToMailbox } from "../../lib/graph/resource";

describe("graphResourceBelongsToMailbox", () => {
  it("accepts the normal notification resource below the subscription", () => {
    assert.equal(
      graphResourceBelongsToMailbox(
        "Users/info%40example.com/mailFolders('Inbox')/Messages/abc",
        "/users/info%40example.com/mailFolders('Inbox')/messages",
      ),
      true,
    );
  });

  it("accepts an equivalent resource with a different folder shape", () => {
    assert.equal(
      graphResourceBelongsToMailbox(
        "https://graph.microsoft.com/v1.0/users(info%40example.com)/messages/abc",
        "/users/info%40example.com/mailFolders('Inbox')/messages",
      ),
      true,
    );
  });

  it("accepts Graph's object-id resource when the subscription uses a UPN", () => {
    assert.equal(
      graphResourceBelongsToMailbox(
        "Users('722effaf-0433-4272-9ac4-d5ec11c3cd77')/messages('AAMkAGUwNjQ4ZjIx')",
        "/users/info%40example.com/mailFolders('Inbox')/messages",
      ),
      true,
    );
  });

  it("maps a delegated /me subscription to the configured sender", () => {
    assert.equal(
      graphResourceBelongsToMailbox(
        "users/info%40example.com/messages/abc",
        "/me/mailFolders('Inbox')/messages",
        "info@example.com",
      ),
      true,
    );
  });

  it("rejects a different mailbox and non-message resources", () => {
    assert.equal(
      graphResourceBelongsToMailbox(
        "users/other%40example.com/messages/abc",
        "/users/info%40example.com/mailFolders('Inbox')/messages",
      ),
      false,
    );
    assert.equal(
      graphResourceBelongsToMailbox(
        "users/info%40example.com/calendar/events/abc",
        "/users/info%40example.com/mailFolders('Inbox')/messages",
      ),
      false,
    );
  });
});
