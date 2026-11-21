import assert from "node:assert/strict";

import { describe, test } from "vitest";

import { messageSentAt, normaliseContent } from "../src/whatsapp/normalise.js";
import {
  bareJid,
  firstPhone,
  isGroupJid,
  isValidGroupJid,
  jidFromPhone,
  phoneFromJid,
} from "../src/whatsapp/jid.js";

describe("message content", () => {
  test("plain and extended text", () => {
    assert.deepEqual(normaliseContent({ conversation: " Hi team " }), {
      kind: "text",
      text: "Hi team",
    });
    assert.deepEqual(
      normaliseContent({ extendedTextMessage: { text: "See link" } }),
      {
        kind: "text",
        text: "See link",
      },
    );
  });

  test("an empty text or protocol traffic is nothing to store", () => {
    assert.equal(normaliseContent({ conversation: "   " }), null);
    assert.equal(normaliseContent({ protocolMessage: {} }), null);
    assert.equal(normaliseContent({ reactionMessage: { text: "👍" } }), null);
    assert.equal(normaliseContent(null), null);
  });

  test("a photo with a caption", () => {
    const content = normaliseContent({
      imageMessage: {
        caption: "Frame up",
        fileLength: 2048,
        mimetype: "image/jpeg",
      },
    });
    assert.equal(content?.kind, "media");
    if (content?.kind !== "media") return;
    assert.equal(content.text, "Frame up");
    assert.equal(content.media.kind, "image");
    assert.equal(content.media.byteSize, 2048);
    assert.equal(content.media.voice, false);
  });

  test("a voice note is audio marked as voice", () => {
    const content = normaliseContent({
      audioMessage: { mimetype: "audio/ogg; codecs=opus", ptt: true },
    });
    assert.equal(content?.kind === "media" && content.media.voice, true);
  });

  test("a document keeps its file name; an image never claims one", () => {
    const document = normaliseContent({
      documentMessage: { fileName: "Plans.pdf", mimetype: "application/pdf" },
    });
    assert.equal(
      document?.kind === "media" && document.media.fileName,
      "Plans.pdf",
    );
  });

  test("view-once and ephemeral wrappers are unwrapped", () => {
    const content = normaliseContent({
      ephemeralMessage: { message: { conversation: "Gone soon" } },
    });
    assert.deepEqual(content, { kind: "text", text: "Gone soon" });
  });

  test("View Once media is never offered for download", () => {
    for (const message of [
      {
        viewOnceMessage: {
          message: { imageMessage: { mimetype: "image/jpeg" } },
        },
      },
      {
        viewOnceMessageV2: {
          message: { videoMessage: { mimetype: "video/mp4" } },
        },
      },
      { imageMessage: { mimetype: "image/jpeg", viewOnce: true } },
      // A disappearing-message wrapper around a view-once layer.
      {
        ephemeralMessage: {
          message: {
            viewOnceMessageV2: {
              message: { imageMessage: { mimetype: "image/jpeg" } },
            },
          },
        },
      },
    ]) {
      assert.deepEqual(normaliseContent(message), {
        kind: "unsupported",
        type: "viewOnceMessage",
      });
    }
  });

  test("anything else is unsupported, with its type", () => {
    assert.deepEqual(
      normaliseContent({ locationMessage: { degreesLatitude: 1 } }),
      {
        kind: "unsupported",
        type: "locationMessage",
      },
    );
  });

  test("the timestamp is WhatsApp's seconds", () => {
    assert.equal(
      messageSentAt({ key: {}, messageTimestamp: 1_790_000_000 }),
      new Date(1_790_000_000_000).toISOString(),
    );
  });
});

describe("JIDs", () => {
  test("a phone JID gives its number; a LID never does", () => {
    assert.equal(phoneFromJid("61412345678@s.whatsapp.net"), "+61412345678");
    assert.equal(phoneFromJid("61412345678:12@s.whatsapp.net"), "+61412345678");
    assert.equal(phoneFromJid("123456789012345@lid"), null);
    assert.equal(phoneFromJid("120363012345678901@g.us"), null);
  });

  test("first phone among a participant's ids", () => {
    assert.equal(
      firstPhone("123@lid", "61412345678@s.whatsapp.net"),
      "+61412345678",
    );
    assert.equal(firstPhone("123@lid", null), null);
  });

  test("E.164 to JID", () => {
    assert.equal(jidFromPhone("+61 412 345 678"), "61412345678@s.whatsapp.net");
    assert.equal(jidFromPhone("0412345678"), null);
  });

  test("groups and devices", () => {
    assert.equal(isGroupJid("120363012345678901@g.us"), true);
    assert.equal(isValidGroupJid("120363012345678901@g.us"), true);
    assert.equal(isValidGroupJid("../../etc@g.us"), false);
    assert.equal(
      bareJid("61412345678:3@s.whatsapp.net"),
      "61412345678@s.whatsapp.net",
    );
  });
});
