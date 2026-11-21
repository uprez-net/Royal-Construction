import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { pino } from "pino";
import { afterEach, beforeEach, describe, test } from "vitest";

import { EventOutbox } from "../src/events/outbox.js";
import { MediaStore } from "../src/store/media.js";
import { SentMessageStore } from "../src/store/sent-messages.js";

let dir: string;
const silent = pino({ level: "silent" });

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "bridge-stores-"));
});
afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe("sent messages", () => {
  test("an intent still pending at start-up is unconfirmed, and its id is known", async () => {
    const first = new SentMessageStore(dir);
    await first.begin("k1", "120363012345678901@g.us", "3EB0AAAA");
    // The process dies here, mid-send.
    const restarted = new SentMessageStore(dir);
    await restarted.init();
    assert.equal((await restarted.find("k1"))?.status, "unconfirmed");
    assert.equal(restarted.isOwn("3EB0AAAA"), true);
  });

  test("a confirmed send is replayable; a discarded one is forgotten", async () => {
    const store = new SentMessageStore(dir);
    await store.begin("k1", "g@g.us", "3EB0A");
    await store.confirm("k1", new Date().toISOString());
    await store.begin("k2", "g@g.us", "3EB0B");
    await store.discard("k2");
    const reread = new SentMessageStore(dir);
    assert.equal((await reread.find("k1"))?.status, "sent");
    assert.equal(await reread.find("k2"), null);
  });
});

describe("media", () => {
  test("a duplicate delivery keeps the first, complete file", async () => {
    const store = new MediaStore(dir);
    await store.save("3EB0MEDIA", new Uint8Array([1, 2, 3]), {
      fileName: null,
      mimeType: "image/jpeg",
    });
    await store.save("3EB0MEDIA", new Uint8Array([9]), {
      fileName: null,
      mimeType: "image/jpeg",
    });
    const stored = await store.read("3EB0MEDIA");
    assert.deepEqual([...(stored?.bytes ?? [])], [1, 2, 3]);
    assert.equal(stored?.meta.byteSize, 3);
  });

  test("the retention sweep removes old files and reports, not stops on, a failure", async () => {
    const store = new MediaStore(dir);
    await store.save("3EB0OLD1", new Uint8Array([1]), {
      fileName: null,
      mimeType: null,
    });
    await store.save("3EB0OLD2", new Uint8Array([2]), {
      fileName: null,
      mimeType: null,
    });
    const result = await store.prune(14, Date.now() + 15 * 24 * 60 * 60 * 1000);
    assert.equal(result.removed, 2);
    assert.equal(result.failed, 0);
    assert.deepEqual(await readdir(path.join(dir, "media")), []);
    assert.deepEqual(await new MediaStore(path.join(dir, "none")).prune(1), {
      failed: 0,
      removed: 0,
    });
  });
});

describe("mapping store cold start", () => {
  test("a reader's first load cannot undo a write that finished first", async () => {
    const { MappingStore } = await import("../src/store/mappings.js");
    const store = new MappingStore(dir);
    const [, written] = await Promise.all([
      store.get("120363000000000001@g.us"),
      store.set("120363000000000001@g.us", "p1"),
    ]);
    assert.equal(written.projectId, "p1");
    assert.equal((await store.get("120363000000000001@g.us"))?.projectId, "p1");
  });
});

describe("media downloader", () => {
  test("one file over the limit is stopped; the slot is held until the save", async () => {
    const { MediaDownloader } =
      await import("../src/whatsapp/media-downloader.js");
    const store = new MediaStore(dir);
    const downloader = new MediaDownloader({
      logger: silent,
      maxBytes: 4,
      maxConcurrent: 1,
      media: store,
    });
    const info = {
      byteSize: null,
      caption: null,
      fileName: null,
      kind: "image" as const,
      mimeType: "image/jpeg",
      sha256: null,
      voice: false,
    };
    async function* chunks(...parts: number[][]) {
      for (const part of parts) yield Buffer.from(part);
    }
    const big = await downloader.fetch("3EB0BIGG", info, async () =>
      chunks([1, 2, 3], [4, 5, 6]),
    );
    assert.equal(big.available, false);
    assert.match(big.unavailableReason ?? "", /larger/);

    const order: string[] = [];
    const first = downloader.fetch("3EB0AAAA", info, async () => {
      order.push("open-1");
      return chunks([1]);
    });
    const second = downloader.fetch("3EB0BBBB", info, async () => {
      order.push("open-2");
      return chunks([2]);
    });
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.available && b.available, true);
    assert.deepEqual(order, ["open-1", "open-2"]);
    assert.ok(await store.read("3EB0AAAA"));
  });
});

describe("outbox order and recovery", () => {
  test("events enqueued at once are delivered in call order", async () => {
    const seen: string[] = [];
    const box = new EventOutbox({
      dataDir: dir,
      fetchImpl: (async (_url: string, init: RequestInit) => {
        seen.push((JSON.parse(init.body as string) as { id: string }).id);
        return new Response("ok");
      }) as typeof fetch,
      logger: silent,
      secret: "s".repeat(40),
      url: "https://app.example/hook",
    });
    await Promise.all(
      ["a", "b", "c", "d", "e"].map((id) =>
        box.enqueue(
          "session.updated",
          { account: null, reason: null, status: "open" },
          id,
        ),
      ),
    );
    await box.flush();
    assert.deepEqual(seen, ["a", "b", "c", "d", "e"]);
  });

  test("an unreadable event stops the drain: nothing behind it goes first", async () => {
    const seen: string[] = [];
    const box = new EventOutbox({
      dataDir: dir,
      fetchImpl: (async (_url: string, init: RequestInit) => {
        seen.push((JSON.parse(init.body as string) as { id: string }).id);
        return new Response("ok");
      }) as typeof fetch,
      logger: silent,
      secret: "s".repeat(40),
      url: "https://app.example/hook",
    });
    await box.enqueue(
      "session.updated",
      { account: null, reason: null, status: "open" },
      "first",
    );
    // A directory where a file should be: reading it fails with EISDIR.
    const outbox = path.join(dir, "outbox");
    const [name] = (await readdir(outbox)).filter((file) =>
      file.endsWith(".json"),
    );
    await rm(path.join(outbox, name!));
    await writeFile(path.join(outbox, "placeholder"), "");
    await (await import("node:fs/promises")).mkdir(path.join(outbox, name!));
    await box.enqueue(
      "session.updated",
      { account: null, reason: null, status: "open" },
      "second",
    );
    await box.flush();
    assert.deepEqual(
      seen,
      [],
      "the later event waits behind the unreadable one",
    );
    assert.match(box.health().lastError ?? "", /Could not read/);
  });
});
