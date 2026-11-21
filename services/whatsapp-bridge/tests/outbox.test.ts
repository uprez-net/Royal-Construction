import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { pino } from "pino";
import { afterEach, beforeEach, describe, test } from "vitest";

import { EventOutbox } from "../src/events/outbox.js";
import { signBody, verifySignature } from "../src/events/sign.js";

const SECRET = "s".repeat(40);
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "bridge-outbox-"));
});
afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

function outbox(responses: (number | Error)[], seen: Request[] = []) {
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push(new Request(url, init));
    const next = responses.shift() ?? 200;
    if (next instanceof Error) throw next;
    return new Response("ok", { status: next });
  }) as typeof fetch;
  const box = new EventOutbox({
    dataDir: dir,
    fetchImpl,
    logger: pino({ level: "silent" }),
    now: () => 1_790_000_000_000,
    secret: SECRET,
    url: "https://app.example/api/whatsapp-bridge/webhook",
  });
  return { box, seen };
}

const event = {
  account: null,
  reason: "test",
  status: "open" as const,
};

describe("signing", () => {
  test("the timestamp is inside the signature", () => {
    const signature = signBody(SECRET, 100, "{}");
    assert.equal(verifySignature(SECRET, 100, "{}", signature), true);
    assert.equal(verifySignature(SECRET, 101, "{}", signature), false);
    assert.equal(verifySignature(SECRET, 100, "{ }", signature), false);
  });
});

describe("event outbox", () => {
  test("delivers signed, in order, and deletes once accepted", async () => {
    const { box, seen } = outbox([200, 200]);
    await box.enqueue("session.updated", event, "e1");
    await box.enqueue("session.updated", event, "e2");
    await box.flush();
    assert.equal(seen.length, 2);
    const bodies = await Promise.all(seen.map((request) => request.text()));
    assert.deepEqual(
      bodies.map((body) => (JSON.parse(body) as { id: string }).id),
      ["e1", "e2"],
    );
    const first = seen[0]!;
    const body = bodies[0]!;
    assert.equal(
      verifySignature(
        SECRET,
        Number(first.headers.get("x-bridge-timestamp")),
        body,
        first.headers.get("x-bridge-signature") ?? "",
      ),
      true,
    );
    assert.equal(first.headers.get("x-bridge-event-id"), "e1");
    assert.equal(box.health().pending, 0);
  });

  test("a 5xx or a network error keeps the event and stops for backoff", async () => {
    const { box, seen } = outbox([503]);
    await box.enqueue("session.updated", event, "e1");
    await box.enqueue("session.updated", event, "e2");
    await box.flush();
    assert.equal(seen.length, 1, "stops at the first failure, keeping order");
    assert.equal(box.health().pending, 2);
    assert.match(box.health().lastError ?? "", /503/);

    const again = outbox([new Error("ECONNRESET")]);
    await again.box.flush();
    assert.equal(
      again.box.health().pending,
      0,
      "a fresh outbox counts on start()",
    );
    assert.equal((await readdir(path.join(dir, "outbox"))).length, 2);
  });

  test("a 401 is kept (fixable secret); a 400 goes to the dead letters", async () => {
    const { box } = outbox([401]);
    await box.enqueue("session.updated", event, "e1");
    await box.flush();
    assert.equal((await readdir(path.join(dir, "outbox"))).length, 1);

    const second = outbox([400, 200]);
    await second.box.flush();
    assert.equal((await readdir(path.join(dir, "outbox"))).length, 0);
    assert.equal((await readdir(path.join(dir, "outbox-dead"))).length, 1);
  });

  test("without a URL, events wait on disk", async () => {
    const box = new EventOutbox({
      dataDir: dir,
      logger: pino({ level: "silent" }),
      secret: null,
      url: null,
    });
    await box.enqueue("session.updated", event);
    await box.flush();
    assert.equal(box.health().delivering, false);
    assert.equal((await readdir(path.join(dir, "outbox"))).length, 1);
  });
});
