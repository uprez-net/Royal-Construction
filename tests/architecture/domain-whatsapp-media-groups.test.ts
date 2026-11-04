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
  linkProjectWhatsAppGroup,
  requestProjectWhatsAppGroup,
  resolveCreatingProjectWhatsAppGroup,
  submitProjectWhatsAppGroupCreate,
} from "@/lib/domain/projects/whatsapp/groups";
import { recordInboundProjectWhatsAppMessage } from "@/lib/domain/projects/whatsapp/inbound";
import { sendProjectWhatsAppInvite } from "@/lib/domain/projects/whatsapp/invite";
import { getProjectWhatsAppThread } from "@/lib/domain/projects/whatsapp/queries";
import { sendProjectWhatsAppMessage } from "@/lib/domain/projects/whatsapp/send";
import {
  WhatsAppMediaError,
  WhatsAppSendError,
  type WhatsAppChannel,
  type WhatsAppGroupsPort,
  type WhatsAppMediaPort,
  type WhatsAppPort,
} from "@/lib/domain/ports/whatsapp";
import { systemPrincipal, type DomainPrincipal } from "@/lib/domain/principal";
import {
  storeWhatsAppMedia,
  whatsappMediaBody,
} from "@/lib/domain/whatsapp/media";

import { fakeWhatsAppDb } from "./whatsapp-fake-db";

// Media copied into Blob storage, and a WhatsApp group per project. Each of
// these reaches a client or comes in from the open internet, so the tests pin
// the promises the runbook makes: nothing twice, nothing silently, and only
// the people the contract names.

const admin: DomainPrincipal = { kind: "user", role: Role.ADMIN, userId: "u1" };
const webhook = systemPrincipal("whatsapp-webhook");
const workflow = systemPrincipal("workflow:test");

const OFFICE = {
  displayNumber: "+61280001234",
  label: "Office",
  phoneNumberId: "1000000000001",
};

function channel(groupsEnabled = true): WhatsAppChannel {
  return {
    defaultPhoneNumberId: OFFICE.phoneNumberId,
    enabledTemplateNames: null,
    groupsEnabled,
    numbers: [OFFICE],
    sendingAvailable: true,
  };
}

function groupsPort(overrides: Partial<WhatsAppGroupsPort> = {}) {
  const calls = { create: 0, sendText: 0 };
  const port: WhatsAppGroupsPort = {
    create: async () => {
      calls.create += 1;
      return { groupId: null, inviteLink: null, requestId: "REQ-1" };
    },
    info: async (groupId) => ({
      groupId,
      participantWaIds: ["61412345678"],
      subject: "Royal Constructions · 12 Smith St",
      suspended: false,
    }),
    inviteLink: async () => "https://chat.whatsapp.com/LINK",
    list: async () => [],
    sendText: async () => {
      calls.sendText += 1;
      return { providerMessageId: `wamid.group.${calls.sendText}` };
    },
    ...overrides,
  };
  return { calls, port };
}

function whatsappPort(groups: WhatsAppGroupsPort): WhatsAppPort {
  return {
    channel: channel(),
    groups,
    sendTemplate: async () => ({ providerMessageId: "wamid.t" }),
    sendText: async () => ({ providerMessageId: "wamid.x" }),
  };
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
    businessDisplayNumber: OFFICE.displayNumber,
    businessPhoneNumberId: OFFICE.phoneNumberId,
    inviteLink: "https://chat.whatsapp.com/LINK",
    origin: "CREATED",
    projectId: "p1",
    providerGroupId: "GROUP-1",
    status: "ACTIVE",
    subject: "Royal Constructions · 12 Smith St, Kellyville",
  });
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

describe("project groups", () => {
  test("with groups off, asking for one is refused and writes nothing", async () => {
    const fake = seedProject();
    await assert.rejects(
      requestProjectWhatsAppGroup(admin, { projectId: "p1" }, fake.db, {
        channel: channel(false),
      }),
      (error: unknown) =>
        error instanceof DomainTransitionError
        && /Official Business Account/.test(error.message),
    );
    assert.deepEqual(fake.rows("projectWhatsAppGroup"), []);
  });

  test("two requests and two workflow runs ask Meta for one group", async () => {
    const fake = seedProject();
    const first = await requestProjectWhatsAppGroup(
      admin,
      { projectId: "p1" },
      fake.db,
      { channel: channel() },
    );
    const second = await requestProjectWhatsAppGroup(
      systemPrincipal("project-created"),
      { projectId: "p1" },
      fake.db,
      { channel: channel() },
    );
    assert.equal(first.group.id, second.group.id);
    assert.equal(fake.rows("projectWhatsAppGroup").length, 1);
    assert.equal(
      first.group.subject,
      "Royal Constructions · 12 Smith St, Kellyville",
    );

    const { calls, port } = groupsPort();
    const a = await submitProjectWhatsAppGroupCreate(
      workflow,
      { groupRowId: first.group.id },
      fake.db,
      { groups: port },
    );
    const b = await submitProjectWhatsAppGroupCreate(
      workflow,
      { groupRowId: first.group.id },
      fake.db,
      { groups: port },
    );
    assert.equal(a.outcome, "submitted");
    assert.equal(b.outcome, "already_submitted");
    assert.equal(calls.create, 1);

    // Meta confirms on the lifecycle webhook, naming the request.
    await applyWhatsAppGroupEvent(
      webhook,
      {
        at: new Date(),
        groupId: "GROUP-1",
        inviteLink: "https://chat.whatsapp.com/LINK",
        kind: "created",
        requestId: "REQ-1",
        subject: null,
      },
      fake.db,
    );
    const [row] = fake.rows("projectWhatsAppGroup");
    assert.equal(row.status, "ACTIVE");
    assert.equal(row.providerGroupId, "GROUP-1");
    assert.equal(row.inviteLink, "https://chat.whatsapp.com/LINK");
  });

  test("a refused create is reported as failed with Meta's reason", async () => {
    const fake = seedProject();
    const { group } = await requestProjectWhatsAppGroup(
      admin,
      { projectId: "p1" },
      fake.db,
      { channel: channel() },
    );
    const { port } = groupsPort({
      create: async () => {
        throw new WhatsAppSendError(
          "Not an Official Business Account.",
          "not_sent",
        );
      },
    });
    const result = await submitProjectWhatsAppGroupCreate(
      workflow,
      { groupRowId: group.id },
      fake.db,
      { groups: port },
    );
    assert.equal(result.outcome, "refused");
    const [row] = fake.rows("projectWhatsAppGroup");
    assert.equal(row.status, "FAILED");
    assert.match(String(row.failureReason), /Official Business Account/);
  });

  test("an unconfirmed create is found by its subject instead of made twice", async () => {
    const fake = seedProject();
    const { group } = await requestProjectWhatsAppGroup(
      admin,
      { projectId: "p1" },
      fake.db,
      { channel: channel() },
    );
    const requested = new Date("2026-11-04T00:00:00Z");
    const { calls, port } = groupsPort({
      create: async () => {
        throw new WhatsAppSendError("Timed out.", "ambiguous");
      },
      list: async () => [
        {
          createdAt: new Date("2026-11-04T00:00:30Z"),
          groupId: "GROUP-9",
          subject: group.subject,
        },
      ],
    });
    const submitted = await submitProjectWhatsAppGroupCreate(
      workflow,
      { groupRowId: group.id, now: requested },
      fake.db,
      { groups: port },
    );
    assert.equal(submitted.outcome, "unconfirmed");
    const resolved = await resolveCreatingProjectWhatsAppGroup(
      workflow,
      { groupRowId: group.id, now: new Date("2026-11-04T00:01:00Z") },
      fake.db,
      { groups: port },
    );
    assert.equal(resolved.outcome, "active");
    assert.equal(calls.create, 0, "the throwing create is not counted");
    assert.equal(
      fake.rows("projectWhatsAppGroup")[0].providerGroupId,
      "GROUP-9",
    );
  });

  test("a group message is the project's; an unlinked group's waits and is filed on link", async () => {
    const fake = seedProject();
    const message = {
      businessPhoneNumberId: OFFICE.phoneNumberId,
      fromWaId: "61412345678",
      groupId: "GROUP-7",
      profileName: "Ann",
      providerMessageId: "wamid.g1",
      sentAt: new Date("2026-11-04T01:00:00Z"),
      text: "Is the slab poured?",
      type: "text",
    };
    const waiting = await recordInboundProjectWhatsAppMessage(
      webhook,
      message,
      fake.transactionalDb,
    );
    assert.equal(waiting.outcome, "unlinked");
    const replay = await recordInboundProjectWhatsAppMessage(
      webhook,
      message,
      fake.transactionalDb,
    );
    assert.equal(replay.outcome, "duplicate");

    const { port } = groupsPort({
      list: async () => [
        { createdAt: null, groupId: "GROUP-7", subject: "Lee" },
      ],
    });
    const linked = await linkProjectWhatsAppGroup(
      admin,
      { projectId: "p1", providerGroupId: "GROUP-7" },
      fake.transactionalDb,
      { channel: channel(), groups: port },
    );
    assert.equal(linked.filedMessages, 1);
    assert.equal(linked.group.status, "ACTIVE");
    const [filed] = fake.rows("projectWhatsAppMessage");
    assert.equal(filed.body, "Is the slab poured?");
    assert.equal(fake.rows("whatsAppUnmatchedMessage")[0].status, "ATTACHED");

    const thread = await getProjectWhatsAppThread(
      admin,
      { projectId: "p1" },
      fake.db,
      { channel: channel() },
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

  test("a group that is not the business's own is refused, and nothing is written", async () => {
    const fake = seedProject();
    const { port } = groupsPort({ list: async () => [] });
    await assert.rejects(
      linkProjectWhatsAppGroup(
        admin,
        { projectId: "p1", providerGroupId: "SOMEONE-ELSES" },
        fake.transactionalDb,
        { channel: channel(), groups: port },
      ),
      DomainValidationError,
    );
    assert.deepEqual(fake.rows("projectWhatsAppGroup"), []);
  });
});

describe("sending into a group", () => {
  test("the same key sends once and says so", async () => {
    const fake = seedProject();
    activeGroup(fake);
    const { calls, port } = groupsPort();
    const whatsapp = whatsappPort(port);
    const first = await sendProjectWhatsAppMessage(
      admin,
      {
        body: "Concrete pour Friday 7am.",
        idempotencyKey: "k1",
        projectId: "p1",
      },
      fake.transactionalDb,
      { whatsapp },
    );
    const replay = await sendProjectWhatsAppMessage(
      admin,
      {
        body: "Concrete pour Friday 7am.",
        idempotencyKey: "k1",
        projectId: "p1",
      },
      fake.transactionalDb,
      { whatsapp },
    );
    assert.equal(first.alreadySent, false);
    assert.equal(first.message.status, "SENT");
    assert.equal(replay.alreadySent, true);
    assert.equal(calls.sendText, 1);
  });

  test("an ambiguous failure is held for a person, not retried", async () => {
    const fake = seedProject();
    activeGroup(fake);
    const { port } = groupsPort({
      sendText: async () => {
        throw new WhatsAppSendError("Timed out.", "ambiguous");
      },
    });
    await assert.rejects(
      sendProjectWhatsAppMessage(
        admin,
        { body: "Hello", idempotencyKey: "k2", projectId: "p1" },
        fake.transactionalDb,
        { whatsapp: whatsappPort(port) },
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
        { whatsapp: whatsappPort(port) },
      ),
      DomainTransitionError,
    );
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
});
