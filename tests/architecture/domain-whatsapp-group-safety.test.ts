import assert from "node:assert/strict";
import { Role, WhatsAppMediaSource } from "@prisma/client";
import { describe, test } from "vitest";

import { DomainTransitionError } from "@/lib/domain/errors";
import { WhatsAppSendError } from "@/lib/domain/ports/whatsapp";
import type {
  WhatsAppBridgeGroup,
  WhatsAppBridgePort,
} from "@/lib/domain/ports/whatsapp-bridge";
import { systemPrincipal, type DomainPrincipal } from "@/lib/domain/principal";
import { applyWhatsAppGroupEvent } from "@/lib/domain/projects/whatsapp/group-events";
import {
  reconcileWhatsAppBridgeMappings,
  unlinkProjectWhatsAppGroup,
} from "@/lib/domain/projects/whatsapp/group-links";
import { projectWhatsAppGroupAvailability } from "@/lib/domain/projects/whatsapp/group-shared";
import { createProjectWhatsAppGroup } from "@/lib/domain/projects/whatsapp/groups";
import {
  recordInboundProjectWhatsAppMessage,
  type InboundProjectWhatsAppMessage,
} from "@/lib/domain/projects/whatsapp/inbound";
import { markProjectWhatsAppRead } from "@/lib/domain/projects/whatsapp/queries";
import { storeWhatsAppMedia } from "@/lib/domain/whatsapp/media";

import { fakeWhatsAppDb } from "./whatsapp-fake-db";

// The review follow-ups for project groups: nothing created twice, nothing
// unlinked by a stale screen, no message filed on the wrong project or lost
// while a group is being saved, and a file fetched from whoever issued it.

const admin: DomainPrincipal = { kind: "user", role: Role.ADMIN, userId: "u1" };
const bridgeWebhook = systemPrincipal("whatsapp-bridge-webhook");
const GROUP = "120363000000000001@g.us";
const OTHER = "120363000000000002@g.us";

function group(jid = GROUP): WhatsAppBridgeGroup {
  return {
    createdAt: null,
    description: null,
    isAdmin: true,
    jid,
    mappedProjectId: null,
    participants: [
      {
        admin: null,
        jid: "61412345678@s.whatsapp.net",
        phoneE164: "+61412345678",
      },
    ],
    subject: "Royal Constructions · 12 Smith St",
  };
}

function bridge(overrides: Partial<WhatsAppBridgePort> = {}) {
  const calls = {
    create: 0,
    remove: [] as [string, string | null][],
    replace: [] as { groupJid: string; projectId: string }[][],
  };
  const unused = async () => assert.fail("not expected");
  const port: WhatsAppBridgePort = {
    connect: unused,
    createGroup: async () => {
      calls.create += 1;
      return { group: group(), inviteLink: "https://chat.whatsapp.com/L" };
    },
    downloadMedia: unused,
    group: async (jid) => group(jid),
    inviteLink: async () => "https://chat.whatsapp.com/L",
    listGroups: async () => [group()],
    logout: unused,
    qr: unused,
    receivesEvents: true,
    removeMapping: async (jid, projectId) =>
      void calls.remove.push([jid, projectId ?? null]),
    replaceMappings: async (mappings) => {
      calls.replace.push([...mappings]);
      return { added: 0, changed: 0, removed: 0 };
    },
    sendText: unused,
    session: unused,
    setMapping: async () => undefined,
    ...overrides,
  };
  return { calls, port };
}

function seed() {
  const fake = fakeWhatsAppDb();
  fake.seed("user", { id: "u1", name: "Sam" });
  fake.seed("lead", { name: "Ann", phone: "0412 345 678" });
  fake.seed("customer", {
    email: "a@x.com",
    id: "c1",
    name: "Ann",
    phone: "0412 345 678",
  });
  fake.seed("project", {
    customerId: "c1",
    id: "p1",
    leadId: 1,
    location: "12 Smith St",
    name: "Lee",
    siteManagerId: null,
  });
  fake.seed("projectCustomer", {
    customerId: "c1",
    position: 0,
    projectId: "p1",
  });
  return fake;
}

function linked(
  fake: ReturnType<typeof seed>,
  extra: Record<string, unknown> = {},
) {
  return fake.seed("projectWhatsAppGroup", {
    linkedAt: new Date("2026-11-21T00:00:00Z"),
    origin: "LINKED",
    projectId: "p1",
    providerGroupId: GROUP,
    status: "ACTIVE",
    subject: "Royal Constructions · 12 Smith St",
    ...extra,
  });
}

function message(
  overrides: Partial<InboundProjectWhatsAppMessage> = {},
): InboundProjectWhatsAppMessage {
  return {
    fromMe: false,
    groupJid: GROUP,
    media: null,
    projectId: "p1",
    providerMessageId: "3EB0X1",
    senderJid: "1@lid",
    senderName: "Ann",
    senderPhoneE164: "+61412345678",
    sentAt: new Date("2026-11-21T01:00:00Z"),
    text: "Hello",
    unsupportedType: null,
    ...overrides,
  };
}

describe("availability", () => {
  test("without the webhook secret, groups are off and say why", () => {
    const { port } = bridge({ receivesEvents: false });
    const availability = projectWhatsAppGroupAvailability(port);
    assert.equal(availability.available, false);
    assert.match(availability.reason ?? "", /WEBHOOK_SECRET/);
  });
});

describe("creating once", () => {
  test("after an unconfirmed create, another is refused until the office confirms there is none", async () => {
    const fake = seed();
    const ambiguous = bridge({
      createGroup: async () => {
        throw new WhatsAppSendError("Timed out.", "ambiguous");
      },
    });
    await assert.rejects(
      createProjectWhatsAppGroup(
        admin,
        { projectId: "p1" },
        fake.transactionalDb,
        {
          bridge: ambiguous.port,
        },
      ),
    );
    assert.equal(
      fake.rows("projectWhatsAppGroup")[0].needsReconciliation,
      true,
    );

    const { calls, port } = bridge();
    await assert.rejects(
      createProjectWhatsAppGroup(
        admin,
        { projectId: "p1" },
        fake.transactionalDb,
        {
          bridge: port,
        },
      ),
      (error: unknown) =>
        error instanceof DomainTransitionError
        && /may already exist/.test(error.message),
    );
    assert.equal(calls.create, 0, "no second group");

    const confirmed = await createProjectWhatsAppGroup(
      admin,
      { confirmNoGroup: true, projectId: "p1" },
      fake.transactionalDb,
      { bridge: port },
    );
    assert.equal(confirmed.group.status, "ACTIVE");
    assert.equal(confirmed.group.needsReconciliation, false);
    assert.equal(calls.create, 1);
  });

  test("a group the bridge made but the app failed to save is finished from the bridge's answer", async () => {
    const fake = seed();
    const row = fake.seed("projectWhatsAppGroup", {
      createAttempt: 1,
      origin: "CREATED",
      projectId: "p1",
      status: "CREATING",
      subject: "Royal Constructions · 12 Smith St",
    });
    fake.seed("outboxEvent", {
      key: `project-whatsapp-group:${row.id}:1`,
      kind: "PROJECT_WHATSAPP_GROUP_CREATE",
      payload: {},
      result: {
        groupJid: GROUP,
        inviteLink: "https://chat.whatsapp.com/L",
        ownersAsked: 1,
        participants: [
          { jid: "61412345678@s.whatsapp.net", phoneE164: "+61412345678" },
        ],
        subject: "Royal Constructions · 12 Smith St",
      },
      status: "SUCCEEDED",
    });
    const { calls, port } = bridge();
    const result = await createProjectWhatsAppGroup(
      admin,
      { projectId: "p1" },
      fake.transactionalDb,
      { bridge: port },
    );
    assert.equal(calls.create, 0, "the bridge is not asked again");
    assert.equal(result.group.status, "ACTIVE");
    assert.equal(result.group.providerGroupId, GROUP);
    assert.equal(fake.rows("projectWhatsAppParticipant").length, 1);
  });
});

describe("unlinking the right group", () => {
  test("a stale confirmation for a group the project no longer has changes nothing", async () => {
    const fake = seed();
    linked(fake);
    const { calls, port } = bridge();
    await assert.rejects(
      unlinkProjectWhatsAppGroup(
        admin,
        { groupJid: OTHER, projectId: "p1" },
        fake.db,
        { bridge: port },
      ),
      DomainTransitionError,
    );
    assert.equal(fake.rows("projectWhatsAppGroup")[0].status, "ACTIVE");
    assert.deepEqual(calls.remove, []);
  });

  test("the bridge removes only this project's mapping; with no bridge, it says it wasn't told", async () => {
    const fake = seed();
    linked(fake);
    const { calls, port } = bridge();
    await unlinkProjectWhatsAppGroup(
      admin,
      { groupJid: GROUP, projectId: "p1" },
      fake.db,
      { bridge: port },
    );
    assert.deepEqual(calls.remove, [[GROUP, "p1"]]);

    const again = seed();
    linked(again);
    const result = await unlinkProjectWhatsAppGroup(
      admin,
      { groupJid: GROUP, projectId: "p1" },
      again.db,
      { bridge: null },
    );
    assert.equal(result.bridgeUpdated, false);
  });
});

describe("resync", () => {
  test("a link made while the bridge was being replaced is sent again", async () => {
    const fake = seed();
    linked(fake);
    fake.seed("project", {
      id: "p2",
      leadId: 2,
      location: "1 Other St",
      name: "Other",
    });
    const { calls, port } = bridge({
      replaceMappings: async (mappings) => {
        calls.replace.push([...mappings]);
        if (calls.replace.length === 1) {
          // A link lands mid-resync.
          fake.seed("projectWhatsAppGroup", {
            origin: "LINKED",
            projectId: "p2",
            providerGroupId: OTHER,
            status: "CREATING",
            subject: "Other",
          });
        }
        return { added: 0, changed: 0, removed: 0 };
      },
    });
    const result = await reconcileWhatsAppBridgeMappings(admin, fake.db, {
      bridge: port,
    });
    assert.equal(calls.replace.length, 2);
    assert.deepEqual(
      calls.replace[1].map((mapping) => mapping.groupJid).sort(),
      [GROUP, OTHER],
    );
    assert.equal(result.total, 2);
  });
});

describe("inbound safety", () => {
  test("a message for a group still being created is held, not dropped", async () => {
    const fake = seed();
    fake.seed("projectWhatsAppGroup", {
      origin: "CREATED",
      projectId: "p1",
      status: "CREATING",
      subject: "S",
    });
    const result = await recordInboundProjectWhatsAppMessage(
      bridgeWebhook,
      message(),
      fake.transactionalDb,
    );
    assert.equal(result.outcome, "group_pending");
    assert.deepEqual(fake.rows("projectWhatsAppMessage"), []);
  });

  test("a message queued for another project is not filed on this one", async () => {
    const fake = seed();
    linked(fake);
    const result = await recordInboundProjectWhatsAppMessage(
      bridgeWebhook,
      message({ projectId: "p-old" }),
      fake.transactionalDb,
    );
    assert.equal(result.outcome, "project_mismatch");
    assert.deepEqual(fake.rows("projectWhatsAppMessage"), []);
  });

  test("a message from before the link is not imported; one after it is", async () => {
    const fake = seed();
    linked(fake);
    const before = await recordInboundProjectWhatsAppMessage(
      bridgeWebhook,
      message({
        providerMessageId: "3EB0OLD",
        sentAt: new Date("2026-11-20T00:00:00Z"),
      }),
      fake.transactionalDb,
    );
    assert.equal(before.outcome, "before_link");
    const after = await recordInboundProjectWhatsAppMessage(
      bridgeWebhook,
      message(),
      fake.transactionalDb,
    );
    assert.equal(after.outcome, "attached");
  });

  test("a group's file is recorded as the bridge's", async () => {
    const fake = seed();
    linked(fake);
    await recordInboundProjectWhatsAppMessage(
      bridgeWebhook,
      message({
        media: {
          caption: null,
          fileName: null,
          mimeType: "image/jpeg",
          providerMediaId: "3EB0X1",
          sha256: null,
          type: "IMAGE",
          unavailableReason: null,
          voice: false,
        },
        text: "",
      }),
      fake.transactionalDb,
    );
    assert.equal(
      fake.rows("whatsAppMedia")[0].source,
      WhatsAppMediaSource.BRIDGE,
    );
  });
});

describe("group events", () => {
  test("Royal's own removal ends the link; someone else leaving does not", async () => {
    const fake = seed();
    linked(fake);
    const at = new Date("2026-11-21T02:00:00Z");
    const other = await applyWhatsAppGroupEvent(
      bridgeWebhook,
      {
        at,
        groupJid: GROUP,
        includesSelf: false,
        kind: "participants_removed",
        participants: [{ jid: "9@lid", phoneE164: null }],
      },
      fake.transactionalDb,
    );
    assert.equal(other.outcome, "applied");
    assert.equal(fake.rows("projectWhatsAppGroup")[0].status, "ACTIVE");

    const self = await applyWhatsAppGroupEvent(
      bridgeWebhook,
      {
        at,
        groupJid: GROUP,
        includesSelf: true,
        kind: "participants_removed",
        participants: [
          { jid: "61280001234@s.whatsapp.net", phoneE164: "+61280001234" },
        ],
      },
      fake.transactionalDb,
    );
    assert.equal(self.outcome, "removed");
    const [row] = fake.rows("projectWhatsAppGroup");
    assert.equal(row.status, "DELETED");
    assert.match(String(row.failureReason), /removed from this group/);
  });
});

describe("media and unread", () => {
  test("a project file that still holds a Meta id is fetched from Meta, not the bridge", async () => {
    const fake = seed();
    fake.seed("whatsAppMedia", {
      fileName: null,
      id: "m1",
      mimeType: "image/jpeg",
      projectMessageId: "pm1",
      providerMediaId: "meta-media-1",
      source: WhatsAppMediaSource.META,
      status: "PENDING",
      type: "IMAGE",
    });
    const used: string[] = [];
    await storeWhatsAppMedia(
      systemPrincipal("workflow:test"),
      { maxBytes: 1000, mediaId: "m1" },
      fake.db,
      {
        bridgeDownload: async () => {
          used.push("bridge");
          return { byteSize: 1, bytes: new Uint8Array([1]), mimeType: null };
        },
        download: async () => {
          used.push("meta");
          return { byteSize: 1, bytes: new Uint8Array([1]), mimeType: null };
        },
        put: async () => ({ url: "https://blob.example/x" }),
      },
    );
    assert.deepEqual(used, ["meta"]);
  });

  test("opening an unlinked group's history clears its unread count", async () => {
    const fake = seed();
    linked(fake, { providerGroupId: null, status: "UNLINKED", unreadCount: 3 });
    await markProjectWhatsAppRead(admin, { projectId: "p1" }, fake.db);
    assert.equal(fake.rows("projectWhatsAppGroup")[0].unreadCount, 0);
  });
});
