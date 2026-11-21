import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, test } from "vitest";

import { createApp } from "../src/http/app.js";
import { MappingStore } from "../src/store/mappings.js";
import { MediaStore } from "../src/store/media.js";
import { SentMessageStore } from "../src/store/sent-messages.js";
import { BridgeError } from "../src/whatsapp/client.js";
import { FakeClient } from "./fake-client.js";

const TOKEN = "t".repeat(40);
const GROUP = "120363012345678901@g.us";

let dir: string;
let client: FakeClient;
let mappings: MappingStore;
let media: MediaStore;
let app: ReturnType<typeof createApp>;

function request(
  pathname: string,
  init: RequestInit & { token?: string | null } = {},
) {
  const headers = new Headers(init.headers);
  if (init.token !== null)
    headers.set("authorization", `Bearer ${init.token ?? TOKEN}`);
  if (init.body) headers.set("content-type", "application/json");
  return app.request(pathname, { ...init, headers });
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "bridge-app-"));
  client = new FakeClient();
  mappings = new MappingStore(dir);
  media = new MediaStore(dir);
  app = createApp({
    apiToken: TOKEN,
    client,
    mappings,
    media,
    outboxHealth: () => ({
      dead: 0,
      delivering: true,
      lastDeliveredAt: null,
      lastError: null,
      lastErrorAt: null,
      pending: 0,
    }),
    sent: new SentMessageStore(dir),
  });
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe("authentication", () => {
  test("health is open and says only whether it is up", async () => {
    const response = await request("/healthz", { token: null });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, session: "open" });
  });

  test("every /v1 route refuses a missing or wrong token", async () => {
    for (const token of [null, "wrong", `${TOKEN}x`]) {
      const response = await request("/v1/session", { token });
      assert.equal(response.status, 401, `token ${String(token)}`);
    }
  });
});

describe("session", () => {
  test("reports the state without the raw QR", async () => {
    client.status = "awaiting_qr";
    client.qr = "2@abc";
    const body = (await (await request("/v1/session")).json()) as Record<
      string,
      unknown
    >;
    assert.equal(body.status, "awaiting_qr");
    assert.equal(body.qrAvailable, true);
    assert.equal("qr" in body, false);
  });

  test("hands out the QR as an image only while one exists", async () => {
    client.status = "logged_out";
    assert.equal((await request("/v1/session/qr")).status, 404);
    client.status = "awaiting_qr";
    client.qr = "2@abc,def";
    const body = (await (await request("/v1/session/qr")).json()) as {
      dataUrl: string;
    };
    assert.match(body.dataUrl, /^data:image\/png;base64,/);
  });

  test("connect and logout drive the client", async () => {
    assert.equal(
      (await request("/v1/session/connect", { method: "POST" })).status,
      202,
    );
    assert.equal(client.connects, 1);
    const body = (await (
      await request("/v1/session/logout", { method: "POST" })
    ).json()) as {
      status: string;
    };
    assert.equal(client.logouts, 1);
    assert.equal(body.status, "logged_out");
  });
});

describe("groups", () => {
  test("creating a group with a project maps it before anything can arrive", async () => {
    const response = await request("/v1/groups", {
      body: JSON.stringify({
        participants: ["+61412345678"],
        projectId: "project-1",
        subject: "Royal Constructions · 1 Smith St",
      }),
      method: "POST",
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as {
      group: { jid: string; projectId: string };
      inviteLink: string;
    };
    assert.equal(body.group.projectId, "project-1");
    assert.match(body.inviteLink, /^https:\/\/chat\.whatsapp\.com\//);
    assert.equal((await mappings.get(body.group.jid))?.projectId, "project-1");
    assert.deepEqual(
      client.groups
        .get(body.group.jid)
        ?.participants.map((participant) => participant.jid),
      ["61412345678@s.whatsapp.net"],
    );
  });

  test("refuses a participant that is not an E.164 number", async () => {
    const response = await request("/v1/groups", {
      body: JSON.stringify({ participants: ["0412 345 678"], subject: "x" }),
      method: "POST",
    });
    assert.equal(response.status, 400);
  });

  test("a group id in the path must be a group id", async () => {
    const response = await request("/v1/groups/61412345678@s.whatsapp.net");
    assert.equal(response.status, 400);
  });

  test("lists groups with the project each is mapped to", async () => {
    await client.createGroup({ participantJids: [], subject: "A" });
    const [jid] = [...client.groups.keys()];
    await mappings.set(jid!, "project-9");
    const body = (await (await request("/v1/groups")).json()) as {
      groups: { jid: string; projectId: string | null }[];
    };
    assert.deepEqual(
      body.groups.map((group) => group.projectId),
      ["project-9"],
    );
  });

  test("not connected is a 503 the app can show as it is", async () => {
    client.status = "logged_out";
    const response = await request("/v1/groups");
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "not_connected");
  });
});

describe("sending", () => {
  const send = (key: string | null, text = "Slab poured today") =>
    request(`/v1/groups/${GROUP}/messages`, {
      body: JSON.stringify({ text }),
      headers: key ? { "idempotency-key": key } : {},
      method: "POST",
    });

  test("requires an Idempotency-Key", async () => {
    assert.equal((await send(null)).status, 400);
    assert.equal(client.sends.length, 0);
  });

  test("a retry with the same key answers the first send and posts nothing", async () => {
    const first = (await (await send("k-1")).json()) as {
      messageId: string;
      replayed: boolean;
    };
    const second = (await (await send("k-1")).json()) as {
      messageId: string;
      replayed: boolean;
    };
    assert.equal(client.sends.length, 1);
    assert.equal(first.replayed, false);
    assert.equal(second.replayed, true);
    assert.equal(second.messageId, first.messageId);
  });

  test("an unconfirmed send holds its key: a retry is refused, never sent again", async () => {
    client.sendFailure = new BridgeError(
      504,
      "send_unconfirmed",
      "Unconfirmed.",
    );
    const response = await send("k-2");
    assert.equal(response.status, 504);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "send_unconfirmed");

    client.sendFailure = null;
    const retry = await send("k-2");
    assert.equal(retry.status, 504);
    assert.equal(client.sends.length, 0, "nothing posted on the retry");
  });

  test("a definite refusal frees the key for a real retry", async () => {
    client.sendFailure = new BridgeError(502, "whatsapp_refused", "Refused.");
    assert.equal((await send("k-3")).status, 502);
    client.sendFailure = null;
    assert.equal((await send("k-3")).status, 200);
    assert.equal(client.sends.length, 1);
  });

  test("the same key for another group is a conflict, not a send", async () => {
    await send("k-4");
    const other = await request("/v1/groups/120363099999999999@g.us/messages", {
      body: JSON.stringify({ text: "x" }),
      headers: { "idempotency-key": "k-4" },
      method: "POST",
    });
    assert.equal(other.status, 409);
    const body = (await other.json()) as { error: { code: string } };
    assert.equal(body.error.code, "key_conflict");
  });

  test("a key already being sent answers send_in_progress", async () => {
    let release: () => void = () => undefined;
    const original = client.sendText.bind(client);
    client.sendText = async (...args) => {
      await new Promise<void>((resolve) => (release = resolve));
      return original(...args);
    };
    const first = send("k-5");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await send("k-5");
    assert.equal(second.status, 409);
    const body = (await second.json()) as { error: { code: string } };
    assert.equal(body.error.code, "send_in_progress");
    release();
    assert.equal((await first).status, 200);
  });
});

describe("mappings", () => {
  test("a project keeps one group: mapping a second releases the first", async () => {
    await request(`/v1/mappings/${GROUP}`, {
      body: JSON.stringify({ projectId: "p1" }),
      method: "PUT",
    });
    await request("/v1/mappings/120363099999999999@g.us", {
      body: JSON.stringify({ projectId: "p1" }),
      method: "PUT",
    });
    const list = await mappings.list();
    assert.deepEqual(
      list.map((mapping) => mapping.groupJid),
      ["120363099999999999@g.us"],
    );
  });

  test("replace sets exactly the app's list", async () => {
    await mappings.set(GROUP, "old");
    const response = await request("/v1/mappings", {
      body: JSON.stringify({
        mappings: [{ groupJid: "120363011111111111@g.us", projectId: "p2" }],
      }),
      method: "PUT",
    });
    const body = (await response.json()) as { added: number; removed: number };
    assert.equal(body.added, 1);
    assert.equal(body.removed, 1);
    assert.equal(await mappings.get(GROUP), null);
  });

  test("replace refuses one project on two groups", async () => {
    const response = await request("/v1/mappings", {
      body: JSON.stringify({
        mappings: [
          { groupJid: "120363011111111111@g.us", projectId: "p2" },
          { groupJid: "120363022222222222@g.us", projectId: "p2" },
        ],
      }),
      method: "PUT",
    });
    assert.equal(response.status, 400);
  });

  test("delete unmaps", async () => {
    await mappings.set(GROUP, "p1");
    const response = await request(`/v1/mappings/${GROUP}`, {
      method: "DELETE",
    });
    assert.deepEqual(await response.json(), { mappedTo: null, removed: true });
  });

  test("a late unlink from one project leaves another project's newer link alone", async () => {
    await mappings.set(GROUP, "p2");
    const response = await request(`/v1/mappings/${GROUP}?projectId=p1`, {
      method: "DELETE",
    });
    assert.deepEqual(await response.json(), { mappedTo: "p2", removed: false });
    assert.equal((await mappings.get(GROUP))?.projectId, "p2");
  });

  test("two links at once for different projects both survive", async () => {
    await Promise.all([
      mappings.set("120363011111111111@g.us", "p1"),
      mappings.set("120363022222222222@g.us", "p2"),
    ]);
    const reread = new MappingStore(dir);
    assert.deepEqual(
      (await reread.list()).map((mapping) => mapping.projectId),
      ["p1", "p2"],
    );
  });
});

describe("media", () => {
  test("serves a stored file with its type and hash", async () => {
    await media.save("3EB0ABCDEF", new Uint8Array([1, 2, 3]), {
      fileName: null,
      mimeType: "image/jpeg",
    });
    const response = await request("/v1/media/3EB0ABCDEF");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    assert.ok(response.headers.get("x-content-sha256"));
    assert.deepEqual(
      [...new Uint8Array(await response.arrayBuffer())],
      [1, 2, 3],
    );
  });

  test("a missing or unsafe id is a 404", async () => {
    assert.equal((await request("/v1/media/NOPE123")).status, 404);
    assert.equal((await request("/v1/media/..%2F..%2Fauth")).status, 404);
  });
});
