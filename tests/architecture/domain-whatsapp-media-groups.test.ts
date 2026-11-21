import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import { describe, test } from "vitest";

import {
  DomainAuthorizationError,
  DomainSideEffectError,
  DomainTransitionError,
  DomainValidationError,
} from "@/lib/domain/errors";
import { recordInboundLeadWhatsAppMessage } from "@/lib/domain/leads/whatsapp/inbound";
import {
  applyWhatsAppGroupEvent,
  createProjectWhatsAppGroup,
  GROUP_CREATE_DEADLINE_MS,
  linkProjectWhatsAppGroup,
  listWhatsAppBridgeGroups,
  reconcileWhatsAppBridgeMappings,
  unlinkProjectWhatsAppGroup,
} from "@/lib/domain/projects/whatsapp/groups";
import {
  recordInboundProjectWhatsAppMessage,
  type InboundProjectWhatsAppMessage,
} from "@/lib/domain/projects/whatsapp/inbound";
import { sendProjectWhatsAppInvite } from "@/lib/domain/projects/whatsapp/invite";
import { getProjectWhatsAppThread } from "@/lib/domain/projects/whatsapp/queries";
import { sendProjectWhatsAppMessage } from "@/lib/domain/projects/whatsapp/send";
import {
  WhatsAppMediaError,
  WhatsAppSendError,
  type WhatsAppChannel,
  type WhatsAppMediaPort,
} from "@/lib/domain/ports/whatsapp";
import {
  WhatsAppBridgeError,
  type WhatsAppBridgeGroup,
  type WhatsAppBridgePort,
} from "@/lib/domain/ports/whatsapp-bridge";
import { systemPrincipal, type DomainPrincipal } from "@/lib/domain/principal";
import {
  storeWhatsAppMedia,
  whatsappMediaBody,
} from "@/lib/domain/whatsapp/media";

import { fakeWhatsAppDb } from "./whatsapp-fake-db";

// Media copied into Blob storage, and a WhatsApp group per project through
// Royal's WhatsApp bridge. Each of these reaches a client or comes in from the
// open internet, so the tests pin the promises the runbook makes: nothing
// twice, nothing silently, and only the people the contract names.

const admin: DomainPrincipal = { kind: "user", role: Role.ADMIN, userId: "u1" };
const webhook = systemPrincipal("whatsapp-webhook");
const bridgeWebhook = systemPrincipal("whatsapp-bridge-webhook");
const workflow = systemPrincipal("workflow:test");

const OFFICE = {
  displayNumber: "+61280001234",
  label: "Office",
  phoneNumberId: "1000000000001",
};

const GROUP = "120363000000000001@g.us";
const OTHER_GROUP = "120363000000000002@g.us";
const LINK = "https://chat.whatsapp.com/LINK";

function channel(): WhatsAppChannel {
  return {
    defaultPhoneNumberId: OFFICE.phoneNumberId,
    enabledTemplateNames: null,
    numbers: [OFFICE],
    sendingAvailable: true,
  };
}

function bridgeGroup(jid = GROUP): WhatsAppBridgeGroup {
  return {
    createdAt: null,
    description: null,
    isAdmin: true,
    jid,
    mappedProjectId: null,
    participants: [
      {
        admin: "superadmin",
        jid: "61280001234@s.whatsapp.net",
        phoneE164: "+61280001234",
      },
      {
        admin: null,
        jid: "61412345678@s.whatsapp.net",
        phoneE164: "+61412345678",
      },
    ],
    subject: "Royal Constructions · 12 Smith St, Kellyville",
  };
}

/** A bridge that answers like the real one, recording what it was asked. */
function bridgePort(overrides: Partial<WhatsAppBridgePort> = {}) {
  const calls = {
    create: [] as Parameters<WhatsAppBridgePort["createGroup"]>[0][],
    removeMapping: [] as string[],
    replace: [] as { groupJid: string; projectId: string }[][],
    send: [] as Parameters<WhatsAppBridgePort["sendText"]>[0][],
    setMapping: [] as [string, string][],
  };
  const unused = async () => assert.fail("not expected in this test");
  const port: WhatsAppBridgePort = {
    connect: unused,
    createGroup: async (request) => {
      calls.create.push(request);
      return { group: bridgeGroup(), inviteLink: LINK };
    },
    downloadMedia: unused,
    group: async (jid) => bridgeGroup(jid),
    inviteLink: async () => LINK,
    listGroups: async () => [bridgeGroup()],
    logout: unused,
    qr: unused,
    removeMapping: async (jid) => void calls.removeMapping.push(jid),
    replaceMappings: async (mappings) => {
      calls.replace.push([...mappings]);
      return { added: mappings.length, changed: 0, removed: 0 };
    },
    sendText: async (message) => {
      calls.send.push(message);
      return {
        messageId: `3EB0SENT${calls.send.length}`,
        replayed: false,
        sentAt: new Date(),
      };
    },
    session: unused,
    setMapping: async (jid, projectId) =>
      void calls.setMapping.push([jid, projectId]),
    ...overrides,
  };
  return { calls, port };
}

/** A project with two owners, one with a phone, and its lead. */
function seedProject() {
  const fake = fakeWhatsAppDb();
  fake.seed("user", { id: "u1", name: "Sam Staff" });
  fake.seed("lead", { name: "Ann Lee", phone: "0412 345 678" });
  fake.seed("customer", {
    email: "ann@example.com",
    id: "c1",
    name: "Ann Lee",
    phone: "0412 345 678",
  });
  fake.seed("customer", {
    email: "bob@example.com",
    id: "c2",
    name: "Bob Lee",
    phone: null,
  });
  fake.seed("project", {
    customerId: "c1",
    id: "p1",
    leadId: 1,
    location: "12 Smith St, Kellyville",
    name: "Lee residence",
    siteManagerId: null,
  });
  fake.seed("projectCustomer", {
    customerId: "c1",
    position: 0,
    projectId: "p1",
  });
  fake.seed("projectCustomer", {
    customerId: "c2",
    position: 1,
    projectId: "p1",
  });
  return fake;
}

function activeGroup(fake: ReturnType<typeof fakeWhatsAppDb>) {
  return fake.seed("projectWhatsAppGroup", {
    inviteLink: LINK,
    origin: "CREATED",
    projectId: "p1",
    providerGroupId: GROUP,
    status: "ACTIVE",
    subject: "Royal Constructions · 12 Smith St, Kellyville",
  });
}

function groupMessage(
  overrides: Partial<InboundProjectWhatsAppMessage> = {},
): InboundProjectWhatsAppMessage {
  return {
    fromMe: false,
    groupJid: GROUP,
    media: null,
    providerMessageId: "3EB0IN1",
    senderJid: "123456789012345@lid",
    senderName: "Ann",
    senderPhoneE164: "+61412345678",
    sentAt: new Date("2026-11-21T01:00:00Z"),
    text: "Is the slab poured?",
    unsupportedType: null,
    ...overrides,
  };
}

describe("inbound media", () => {
  test("a photo is filed with its media waiting to be copied", async () => {
    const fake = fakeWhatsAppDb();
    fake.seed("lead", { name: "Ann", phoneE164: "+61412345678" });
    const result = await recordInboundLeadWhatsAppMessage(
      webhook,
      {
        businessPhoneNumberId: OFFICE.phoneNumberId,
        fromWaId: "61412345678",
        media: {
          caption: null,
          fileName: null,
          mimeType: "image/jpeg",
          providerMediaId: "media-1",
          sha256: null,
          type: "IMAGE",
          voice: false,
        },
        providerMessageId: "wamid.photo",
        sentAt: new Date("2026-11-04T00:00:00Z"),
        text: null,
        type: "image",
      },
      fake.transactionalDb,
      { channel: channel() },
    );
    assert.equal(result.outcome, "attached");
    const [message] = fake.rows("leadWhatsAppMessage");
    assert.equal(message.kind, "MEDIA");
    assert.equal(message.body, "Photo");
    const [media] = fake.rows("whatsAppMedia");
    assert.equal(media.status, "PENDING");
    assert.equal(media.leadMessageId, message.id);
    assert.equal(result.outcome === "attached" && result.mediaId, media.id);
  });

  test("a caption is the body; a document without one is named by its file", () => {
    const base = {
      fileName: "plans.pdf",
      mimeType: "application/pdf",
      providerMediaId: "m",
      sha256: null,
      voice: false,
    } as const;
    assert.equal(
      whatsappMediaBody({
        ...base,
        caption: "Revised plans",
        type: "DOCUMENT",
      }),
      "Revised plans",
    );
    assert.equal(
      whatsappMediaBody({ ...base, caption: null, type: "DOCUMENT" }),
      "Document · plans.pdf",
    );
    assert.equal(
      whatsappMediaBody({ ...base, caption: null, type: "AUDIO", voice: true }),
      "Voice message",
    );
  });
});

describe("copying media into storage", () => {
  function seedMedia() {
    const fake = fakeWhatsAppDb();
    fake.seed("whatsAppMedia", {
      fileName: null,
      id: "media_row",
      leadMessageId: "msg_1",
      mimeType: "image/jpeg",
      providerMediaId: "media-1",
      type: "IMAGE",
    });
    return fake;
  }
  const bytes = new Uint8Array([1, 2, 3]);

  test("stores once: a replayed step finds it stored and puts nothing", async () => {
    const fake = seedMedia();
    let puts = 0;
    const ports = {
      download: (async () => ({
        byteSize: 3,
        bytes,
        mimeType: "image/jpeg",
      })) satisfies WhatsAppMediaPort,
      put: async (input: { pathname: string }) => {
        puts += 1;
        return { url: `https://blob.example/${input.pathname}` };
      },
    };
    const first = await storeWhatsAppMedia(
      workflow,
      { maxBytes: 1000, mediaId: "media_row" },
      fake.db,
      ports,
      new Date("2026-11-04T00:00:00Z"),
    );
    assert.equal(first.outcome, "stored");
    const replay = await storeWhatsAppMedia(
      workflow,
      { maxBytes: 1000, mediaId: "media_row" },
      fake.db,
      ports,
    );
    assert.equal(replay.outcome, "already_stored");
    assert.equal(puts, 1);
    const [row] = fake.rows("whatsAppMedia");
    assert.equal(row.status, "STORED");
    assert.equal(row.blobPathname, "whatsapp-media/2026/11/media_row.jpg");
  });

  test("an expired file is marked failed with the reason, not retried", async () => {
    const fake = seedMedia();
    const result = await storeWhatsAppMedia(
      workflow,
      { maxBytes: 1000, mediaId: "media_row" },
      fake.db,
      {
        download: async () => {
          throw new WhatsAppMediaError(
            "WhatsApp no longer has this file.",
            true,
          );
        },
        put: async () => assert.fail("nothing to store"),
      },
    );
    assert.deepEqual(result, {
      outcome: "failed",
      reason: "WhatsApp no longer has this file.",
    });
    assert.equal(fake.rows("whatsAppMedia")[0].status, "FAILED");
  });

  test("a transient failure asks for a retry and keeps the file queued", async () => {
    const fake = seedMedia();
    await assert.rejects(
      storeWhatsAppMedia(
        workflow,
        { maxBytes: 1000, mediaId: "media_row" },
        fake.db,
        {
          download: async () => {
            throw new WhatsAppMediaError("Timed out.", false);
          },
          put: async () => assert.fail("nothing to store"),
        },
      ),
      (error: unknown) =>
        error instanceof DomainSideEffectError && error.retryable === true,
    );
    const [row] = fake.rows("whatsAppMedia");
    assert.equal(row.status, "PENDING");
    assert.equal(row.attempts, 1);
  });

  test("only the workflow may store, and a refusal writes nothing", async () => {
    const fake = seedMedia();
    const before = fake.log.length;
    await assert.rejects(
      storeWhatsAppMedia(
        admin,
        { maxBytes: 1, mediaId: "media_row" },
        fake.db,
        {
          download: null,
          put: async () => ({ url: "" }),
        },
      ),
      DomainAuthorizationError,
    );
    assert.equal(fake.log.length, before);
  });
});

describe("creating a project group", () => {
  test("with no bridge configured it is refused and writes nothing", async () => {
    const fake = seedProject();
    await assert.rejects(
      createProjectWhatsAppGroup(admin, { projectId: "p1" }, fake.db, {
        bridge: null,
      }),
      (error: unknown) =>
        error instanceof DomainTransitionError
        && /bridge isn't configured/.test(error.message),
    );
    assert.deepEqual(fake.rows("projectWhatsAppGroup"), []);
  });

  test("adds the owners with a mobile, maps it to the project, and links it", async () => {
    const fake = seedProject();
    const { calls, port } = bridgePort();
    const result = await createProjectWhatsAppGroup(
      admin,
      { projectId: "p1" },
      fake.db,
      { bridge: port },
    );
    assert.equal(calls.create.length, 1);
    // Ann has a mobile; Bob gave none.
    assert.deepEqual(calls.create[0].participantsE164, ["+61412345678"]);
    // The bridge maps it before answering, so no early message is lost.
    assert.equal(calls.create[0].projectId, "p1");
    assert.equal(
      calls.create[0].subject,
      "Royal Constructions · 12 Smith St, Kellyville",
    );
    assert.equal(result.ownersAsked, 1);
    assert.equal(result.group.status, "ACTIVE");
    assert.equal(result.group.providerGroupId, GROUP);
    assert.equal(result.group.inviteLink, LINK);
    assert.equal(fake.rows("projectWhatsAppParticipant").length, 2);
    assert.equal(fake.rows("outboxEvent")[0].status, "SUCCEEDED");

    await assert.rejects(
      createProjectWhatsAppGroup(admin, { projectId: "p1" }, fake.db, {
        bridge: port,
      }),
      (error: unknown) =>
        error instanceof DomainTransitionError
        && /already has a WhatsApp group/.test(error.message),
    );
    assert.equal(calls.create.length, 1, "never a second group");
  });

  test("a refusal is reported with the bridge's reason, and pressing again is a fresh attempt", async () => {
    const fake = seedProject();
    const refusing = bridgePort({
      createGroup: async () => {
        throw new WhatsAppSendError(
          "The WhatsApp bridge isn't connected.",
          "not_sent",
          { code: "not_connected" },
        );
      },
    });
    await assert.rejects(
      createProjectWhatsAppGroup(admin, { projectId: "p1" }, fake.db, {
        bridge: refusing.port,
      }),
      (error: unknown) =>
        error instanceof DomainSideEffectError
        && error.retryable === true
        && /isn't connected/.test(error.message),
    );
    const [failed] = fake.rows("projectWhatsAppGroup");
    assert.equal(failed.status, "FAILED");
    assert.match(String(failed.failureReason), /isn't connected/);

    const { calls, port } = bridgePort();
    const retried = await createProjectWhatsAppGroup(
      admin,
      { projectId: "p1" },
      fake.db,
      { bridge: port },
    );
    assert.equal(retried.group.status, "ACTIVE");
    assert.equal(calls.create.length, 1);
    assert.deepEqual(
      fake.rows("outboxEvent").map((event) => event.key),
      [
        `project-whatsapp-group:${failed.id}:1`,
        `project-whatsapp-group:${failed.id}:2`,
      ],
    );
  });

  test("an unconfirmed create is not repeated: the office is told where to look", async () => {
    const fake = seedProject();
    const { port } = bridgePort({
      createGroup: async () => {
        throw new WhatsAppSendError("Timed out.", "ambiguous");
      },
    });
    await assert.rejects(
      createProjectWhatsAppGroup(admin, { projectId: "p1" }, fake.db, {
        bridge: port,
      }),
      (error: unknown) =>
        error instanceof DomainSideEffectError
        && error.retryable === false
        && /Admin › WhatsApp bridge/.test(error.message),
    );
    assert.equal(fake.rows("projectWhatsAppGroup")[0].status, "FAILED");
    assert.equal(fake.rows("outboxEvent")[0].status, "FAILED");
  });

  test("a create that died mid-way is marked failed past the deadline, not asked again", async () => {
    const fake = seedProject();
    fake.seed("projectWhatsAppGroup", {
      createdAt: new Date(Date.now() - GROUP_CREATE_DEADLINE_MS - 1000),
      origin: "CREATED",
      projectId: "p1",
      status: "CREATING",
      subject: "Royal Constructions · 12 Smith St, Kellyville",
    });
    const { calls, port } = bridgePort();
    await assert.rejects(
      createProjectWhatsAppGroup(admin, { projectId: "p1" }, fake.db, {
        bridge: port,
      }),
      DomainTransitionError,
    );
    assert.equal(calls.create.length, 0);
    assert.equal(fake.rows("projectWhatsAppGroup")[0].status, "FAILED");
  });
});

describe("linking and unlinking a group", () => {
  test("tells the bridge first, then links it with its members", async () => {
    const fake = seedProject();
    const { calls, port } = bridgePort();
    const order: string[] = [];
    const watched = {
      ...port,
      setMapping: async (jid: string, projectId: string) => {
        order.push(`map:${fake.rows("projectWhatsAppGroup").length}`);
        await port.setMapping(jid, projectId);
      },
    };
    const result = await linkProjectWhatsAppGroup(
      admin,
      { groupJid: GROUP, projectId: "p1" },
      fake.transactionalDb,
      { bridge: watched },
    );
    assert.deepEqual(order, ["map:0"], "mapped before any row was written");
    assert.deepEqual(calls.setMapping, [[GROUP, "p1"]]);
    assert.equal(result.group.status, "ACTIVE");
    assert.equal(result.group.origin, "LINKED");

    const thread = await getProjectWhatsAppThread(
      admin,
      { projectId: "p1" },
      fake.db,
      { bridge: port },
    );
    // Ann's number is in the group; Bob gave none.
    assert.deepEqual(
      thread.owners.map((owner) => [owner.name, owner.joined]),
      [
        ["Ann Lee", true],
        ["Bob Lee", false],
      ],
    );
  });

  test("a group Royal's number is not in is refused, and nothing is written or mapped", async () => {
    const fake = seedProject();
    const { calls, port } = bridgePort({
      group: async () => {
        throw new WhatsAppBridgeError(
          "That group isn't on this WhatsApp account.",
          "not_found",
          404,
        );
      },
    });
    await assert.rejects(
      linkProjectWhatsAppGroup(
        admin,
        { groupJid: OTHER_GROUP, projectId: "p1" },
        fake.transactionalDb,
        { bridge: port },
      ),
      DomainValidationError,
    );
    assert.deepEqual(fake.rows("projectWhatsAppGroup"), []);
    assert.deepEqual(calls.setMapping, []);
  });

  test("a group already on another project is refused", async () => {
    const fake = seedProject();
    fake.seed("project", {
      customerId: "c1",
      id: "p2",
      leadId: 2,
      location: "1 Other St",
      name: "Other",
      siteManagerId: null,
    });
    fake.seed("projectWhatsAppGroup", {
      origin: "CREATED",
      projectId: "p2",
      providerGroupId: GROUP,
      status: "ACTIVE",
      subject: "Other",
    });
    const { calls, port } = bridgePort();
    await assert.rejects(
      linkProjectWhatsAppGroup(
        admin,
        { groupJid: GROUP, projectId: "p1" },
        fake.transactionalDb,
        { bridge: port },
      ),
      (error: unknown) =>
        error instanceof DomainTransitionError
        && /another project/.test(error.message),
    );
    assert.deepEqual(calls.setMapping, []);
  });

  test("a link whose save fails takes the bridge's mapping back", async () => {
    const fake = seedProject();
    const { calls, port } = bridgePort();
    const failing = new Proxy(fake.transactionalDb, {
      get: (target, key) =>
        key === "$transaction"
          ? async () => {
              throw new Error("database unavailable");
            }
          : Reflect.get(target, key),
    });
    await assert.rejects(
      linkProjectWhatsAppGroup(
        admin,
        { groupJid: GROUP, projectId: "p1" },
        failing,
        { bridge: port },
      ),
      /database unavailable/,
    );
    assert.deepEqual(calls.setMapping, [[GROUP, "p1"]]);
    assert.deepEqual(calls.removeMapping, [GROUP]);
  });

  test("unlinking keeps the history, releases the group and tells the bridge", async () => {
    const fake = seedProject();
    activeGroup(fake);
    const { calls, port } = bridgePort();
    const result = await unlinkProjectWhatsAppGroup(
      admin,
      { projectId: "p1" },
      fake.db,
      { bridge: port },
    );
    assert.equal(result.bridgeUpdated, true);
    assert.equal(result.group.status, "UNLINKED");
    assert.equal(result.group.providerGroupId, null);
    assert.deepEqual(calls.removeMapping, [GROUP]);
  });

  test("an unlink the bridge could not hear still unlinks, and says so", async () => {
    const fake = seedProject();
    activeGroup(fake);
    const { port } = bridgePort({
      removeMapping: async () => {
        throw new WhatsAppBridgeError("unreachable", "unreachable");
      },
    });
    const result = await unlinkProjectWhatsAppGroup(
      admin,
      { projectId: "p1" },
      fake.db,
      { bridge: port },
    );
    assert.equal(result.bridgeUpdated, false);
    assert.equal(fake.rows("projectWhatsAppGroup")[0].status, "UNLINKED");
  });

  test("resync hands the bridge exactly the live links", async () => {
    const fake = seedProject();
    activeGroup(fake);
    fake.seed("project", {
      customerId: "c1",
      id: "p2",
      leadId: 2,
      location: "1 Other St",
      name: "Other",
      siteManagerId: null,
    });
    fake.seed("projectWhatsAppGroup", {
      origin: "LINKED",
      projectId: "p2",
      providerGroupId: null,
      status: "UNLINKED",
      subject: "Old",
    });
    const { calls, port } = bridgePort();
    const result = await reconcileWhatsAppBridgeMappings(admin, fake.db, {
      bridge: port,
    });
    assert.deepEqual(calls.replace, [[{ groupJid: GROUP, projectId: "p1" }]]);
    assert.equal(result.total, 1);
  });

  test("the group list says which project each group is on, and when the bridge disagrees", async () => {
    const fake = seedProject();
    activeGroup(fake);
    const { port } = bridgePort({
      listGroups: async () => [
        { ...bridgeGroup(GROUP), mappedProjectId: "p1" },
        { ...bridgeGroup(OTHER_GROUP), mappedProjectId: "p9" },
      ],
    });
    const groups = await listWhatsAppBridgeGroups(admin, fake.db, {
      bridge: port,
    });
    assert.deepEqual(
      groups.map((group) => [
        group.groupJid,
        group.linkedProject?.id ?? null,
        group.mappingDrift,
      ]),
      [
        [GROUP, "p1", false],
        [OTHER_GROUP, null, true],
      ],
    );
  });
});

describe("messages from the bridge", () => {
  test("a message in a linked group is the project's, once", async () => {
    const fake = seedProject();
    activeGroup(fake);
    const first = await recordInboundProjectWhatsAppMessage(
      bridgeWebhook,
      groupMessage(),
      fake.transactionalDb,
    );
    assert.equal(first.outcome, "attached");
    const replay = await recordInboundProjectWhatsAppMessage(
      bridgeWebhook,
      groupMessage(),
      fake.transactionalDb,
    );
    assert.equal(replay.outcome, "duplicate");
    const [message] = fake.rows("projectWhatsAppMessage");
    assert.equal(message.direction, "INBOUND");
    assert.equal(message.body, "Is the slab poured?");
    assert.equal(fake.rows("projectWhatsAppGroup")[0].unreadCount, 1);
  });

  test("a group no project has linked is not filed anywhere", async () => {
    const fake = seedProject();
    const result = await recordInboundProjectWhatsAppMessage(
      bridgeWebhook,
      groupMessage({ groupJid: OTHER_GROUP }),
      fake.transactionalDb,
    );
    assert.equal(result.outcome, "unknown_group");
    assert.deepEqual(fake.rows("projectWhatsAppMessage"), []);
    assert.deepEqual(fake.rows("whatsAppUnmatchedMessage"), []);
  });

  test("Royal's own words from the phone are outbound and not unread", async () => {
    const fake = seedProject();
    activeGroup(fake);
    await recordInboundProjectWhatsAppMessage(
      bridgeWebhook,
      groupMessage({ fromMe: true, senderJid: "61280001234@s.whatsapp.net" }),
      fake.transactionalDb,
    );
    const [message] = fake.rows("projectWhatsAppMessage");
    assert.equal(message.direction, "OUTBOUND");
    assert.equal(message.status, "SENT");
    assert.equal(fake.rows("projectWhatsAppGroup")[0].unreadCount, 0);
  });

  test("a file the bridge has waits to be copied; one it could not download is failed with why", async () => {
    const fake = seedProject();
    activeGroup(fake);
    const media = {
      caption: null,
      fileName: null,
      mimeType: "image/jpeg",
      providerMediaId: "3EB0PHOTO",
      sha256: null,
      type: "IMAGE" as const,
      voice: false,
    };
    const stored = await recordInboundProjectWhatsAppMessage(
      bridgeWebhook,
      groupMessage({
        media: { ...media, unavailableReason: null },
        providerMessageId: "3EB0PHOTO",
        text: "",
      }),
      fake.transactionalDb,
    );
    assert.ok(stored.outcome === "attached" && stored.mediaId);
    const tooBig = await recordInboundProjectWhatsAppMessage(
      bridgeWebhook,
      groupMessage({
        media: {
          ...media,
          providerMediaId: "3EB0BIG",
          unavailableReason: "The file is larger than the bridge keeps.",
        },
        providerMessageId: "3EB0BIG",
        text: "",
      }),
      fake.transactionalDb,
    );
    assert.equal(tooBig.outcome === "attached" && tooBig.mediaId, null);
    assert.deepEqual(
      fake
        .rows("whatsAppMedia")
        .map((row) => [row.providerMediaId, row.status]),
      [
        ["3EB0PHOTO", "PENDING"],
        ["3EB0BIG", "FAILED"],
      ],
    );
    assert.equal(fake.rows("projectWhatsAppMessage")[0].body, "Photo");
  });

  test("only the bridge webhook may record one", async () => {
    const fake = seedProject();
    activeGroup(fake);
    await assert.rejects(
      recordInboundProjectWhatsAppMessage(
        admin,
        groupMessage(),
        fake.transactionalDb,
      ),
      DomainAuthorizationError,
    );
  });

  test("members come and go as the bridge reports, and a subject change is kept", async () => {
    const fake = seedProject();
    activeGroup(fake);
    const at = new Date("2026-11-21T02:00:00Z");
    await applyWhatsAppGroupEvent(
      bridgeWebhook,
      {
        at,
        groupJid: GROUP,
        kind: "participants_added",
        participants: [
          { jid: "61499999999@s.whatsapp.net", phoneE164: "+61499999999" },
        ],
      },
      fake.db,
    );
    await applyWhatsAppGroupEvent(
      bridgeWebhook,
      {
        at,
        groupJid: GROUP,
        kind: "participants_removed",
        participants: [{ jid: "61499999999@s.whatsapp.net", phoneE164: null }],
      },
      fake.db,
    );
    await applyWhatsAppGroupEvent(
      bridgeWebhook,
      { groupJid: GROUP, kind: "subject_changed", subject: "Lee build" },
      fake.db,
    );
    const [participant] = fake.rows("projectWhatsAppParticipant");
    assert.equal(participant.leftAt?.toString(), at.toString());
    assert.equal(fake.rows("projectWhatsAppGroup")[0].subject, "Lee build");
    const unknown = await applyWhatsAppGroupEvent(
      bridgeWebhook,
      { groupJid: OTHER_GROUP, kind: "subject_changed", subject: "x" },
      fake.db,
    );
    assert.equal(unknown.outcome, "unknown_group");
  });
});

describe("sending into a group", () => {
  test("the same key sends once, and the bridge gets the same key", async () => {
    const fake = seedProject();
    activeGroup(fake);
    const { calls, port } = bridgePort();
    const input = {
      body: "Concrete pour Friday 7am.",
      idempotencyKey: "k1",
      projectId: "p1",
    };
    const first = await sendProjectWhatsAppMessage(
      admin,
      input,
      fake.transactionalDb,
      {
        bridge: port,
      },
    );
    const replay = await sendProjectWhatsAppMessage(
      admin,
      input,
      fake.transactionalDb,
      {
        bridge: port,
      },
    );
    assert.equal(first.alreadySent, false);
    assert.equal(first.message.status, "SENT");
    assert.equal(replay.alreadySent, true);
    assert.equal(calls.send.length, 1);
    assert.equal(calls.send[0].groupJid, GROUP);
    assert.equal(calls.send[0].idempotencyKey, "project-whatsapp:p1:k1");
  });

  test("an ambiguous failure is held for a person, not retried", async () => {
    const fake = seedProject();
    activeGroup(fake);
    const { port } = bridgePort({
      sendText: async () => {
        throw new WhatsAppSendError("Timed out.", "ambiguous");
      },
    });
    await assert.rejects(
      sendProjectWhatsAppMessage(
        admin,
        { body: "Hello", idempotencyKey: "k2", projectId: "p1" },
        fake.transactionalDb,
        { bridge: port },
      ),
      (error: unknown) =>
        error instanceof DomainSideEffectError && error.retryable === false,
    );
    assert.equal(
      fake.rows("projectWhatsAppMessage")[0].needsReconciliation,
      true,
    );
    await assert.rejects(
      sendProjectWhatsAppMessage(
        admin,
        { body: "Hello", idempotencyKey: "k2", projectId: "p1" },
        fake.transactionalDb,
        { bridge: port },
      ),
      DomainTransitionError,
    );
  });

  test("an unlinked group takes no messages", async () => {
    const fake = seedProject();
    fake.seed("projectWhatsAppGroup", {
      origin: "LINKED",
      projectId: "p1",
      providerGroupId: null,
      status: "UNLINKED",
      subject: "Old",
    });
    const { calls, port } = bridgePort();
    await assert.rejects(
      sendProjectWhatsAppMessage(
        admin,
        { body: "Hello", idempotencyKey: "k3", projectId: "p1" },
        fake.transactionalDb,
        { bridge: port },
      ),
      DomainTransitionError,
    );
    assert.equal(calls.send.length, 0);
  });
});

describe("inviting the owners", () => {
  const LINK = "https://chat.whatsapp.com/LINK";

  test("only to the owners on the contract, and nothing is sent otherwise", async () => {
    const fake = seedProject();
    activeGroup(fake);
    let sends = 0;
    await assert.rejects(
      sendProjectWhatsAppInvite(
        admin,
        {
          body: `Join here: ${LINK}`,
          idempotencyKey: "i1",
          projectId: "p1",
          recipients: ["stranger@example.com"],
          senderName: "Sam",
          subject: "Join the group",
        },
        fake.db,
        {
          fromAddress: "info@royal.example",
          sendMail: async () => void (sends += 1),
        },
      ),
      DomainValidationError,
    );
    assert.equal(sends, 0);
  });

  test("a message without the group's link is refused", async () => {
    const fake = seedProject();
    activeGroup(fake);
    await assert.rejects(
      sendProjectWhatsAppInvite(
        admin,
        {
          body: "Join our group!",
          idempotencyKey: "i2",
          projectId: "p1",
          recipients: ["ann@example.com"],
          senderName: "Sam",
          subject: "Join the group",
        },
        fake.db,
        { fromAddress: "info@royal.example", sendMail: async () => undefined },
      ),
      (error: unknown) =>
        error instanceof DomainValidationError && error.field === "body",
    );
  });

  test("sends once per key and lands on the project's email trail", async () => {
    const fake = seedProject();
    activeGroup(fake);
    const sent: { to: readonly string[] }[] = [];
    const input = {
      body: `Hi Ann and Bob,\n\nJoin here: ${LINK}`,
      idempotencyKey: "i3",
      projectId: "p1",
      recipients: ["ANN@example.com", "bob@example.com"],
      senderName: "Sam Staff",
      subject: "Join the group",
    };
    const ports = {
      fromAddress: "info@royal.example",
      sendMail: async (message: { to: readonly string[] }) =>
        void sent.push(message),
    };
    const first = await sendProjectWhatsAppInvite(admin, input, fake.db, ports);
    const replay = await sendProjectWhatsAppInvite(
      admin,
      input,
      fake.db,
      ports,
    );
    assert.equal(first.alreadySent, false);
    assert.equal(replay.alreadySent, true);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ["ann@example.com", "bob@example.com"]);
    assert.equal(fake.rows("leadEmails").length, 2);
  });

  test("a sent invite is reported sent even when the trail cannot be written", async () => {
    const fake = seedProject();
    activeGroup(fake);
    let sends = 0;
    const db = new Proxy(fake.db, {
      get: (target, key) =>
        key === "leadEmails"
          ? {
              create: async () => {
                throw new Error("database unavailable");
              },
            }
          : Reflect.get(target, key),
    });
    const quiet = console.error;
    console.error = () => undefined;
    try {
      const result = await sendProjectWhatsAppInvite(
        admin,
        {
          body: `Join here: ${LINK}`,
          idempotencyKey: "i4",
          projectId: "p1",
          recipients: ["ann@example.com"],
          senderName: "Sam",
          subject: "Join the group",
        },
        db,
        {
          fromAddress: "info@royal.example",
          sendMail: async () => void (sends += 1),
        },
      );
      assert.equal(result.alreadySent, false);
      assert.deepEqual(result.emailIds, []);
    } finally {
      console.error = quiet;
    }
    assert.equal(sends, 1);
    const [intent] = fake.rows("outboxEvent");
    assert.equal(intent.status, "SUCCEEDED");
  });

  test("a failed send says it may have gone, not that nothing did", async () => {
    const fake = seedProject();
    activeGroup(fake);
    await assert.rejects(
      sendProjectWhatsAppInvite(
        admin,
        {
          body: `Join here: ${LINK}`,
          idempotencyKey: "i5",
          projectId: "p1",
          recipients: ["ann@example.com"],
          senderName: "Sam",
          subject: "Join the group",
        },
        fake.db,
        {
          fromAddress: "info@royal.example",
          sendMail: async () => {
            throw new Error("socket hang up");
          },
        },
      ),
      (error: unknown) =>
        error instanceof DomainSideEffectError
        && /Sent Items/.test(error.message),
    );
  });
});
