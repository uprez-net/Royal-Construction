import { Hono, type Context } from "hono";
import QRCode from "qrcode";
import { z } from "zod";

import type { OutboxHealth } from "../events/outbox.js";
import type { MappingStore } from "../store/mappings.js";
import type { MediaStore } from "../store/media.js";
import type { SentMessageStore } from "../store/sent-messages.js";
import {
  BridgeError,
  type GroupInfo,
  type WhatsAppClient,
} from "../whatsapp/client.js";
import { isValidGroupJid, jidFromPhone } from "../whatsapp/jid.js";
import { bearerAuth } from "./auth.js";

// The bridge's HTTP API. docs/whatsapp-bridge.md in the app repository is the
// reference for every route; keep the two in step.
//
// Errors are always `{ error: { code, message } }`. The message is written for
// the office (the app shows it as it is); the code is what the app's adapter
// branches on — above all whether a failed send may have been delivered.

export type AppDeps = {
  readonly apiToken: string;
  readonly client: WhatsAppClient;
  readonly mappings: MappingStore;
  readonly media: MediaStore;
  readonly sent: SentMessageStore;
  readonly outboxHealth: () => OutboxHealth;
  readonly logger?: { error: (obj: object, msg: string) => void };
};

export const MAX_SUBJECT_LENGTH = 100;
export const MAX_TEXT_LENGTH = 4096;
const MAX_KEY_LENGTH = 200;

const phone = z
  .string()
  .trim()
  .refine(
    (value) => jidFromPhone(value) !== null,
    "Use an E.164 number, like +61412345678.",
  );

const createGroupSchema = z.object({
  description: z.string().trim().max(512).optional(),
  participants: z.array(phone).max(50).default([]),
  /** Map the new group straight away, so no message can slip past. */
  projectId: z.string().trim().min(1).max(100).optional(),
  subject: z.string().trim().min(1).max(MAX_SUBJECT_LENGTH),
});

const participantsSchema = z.object({
  action: z.enum(["add", "remove"]),
  participants: z.array(phone).min(1).max(50),
});

const messageSchema = z.object({
  text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
});

const mappingSchema = z.object({
  projectId: z.string().trim().min(1).max(100),
});

const replaceMappingsSchema = z.object({
  mappings: z
    .array(
      z.object({
        groupJid: z.string().refine(isValidGroupJid, "Not a group id."),
        projectId: z.string().trim().min(1).max(100),
      }),
    )
    .max(5000),
});

function groupJidParam(c: Context): string {
  const jid = c.req.param("jid") ?? "";
  if (!isValidGroupJid(jid)) {
    throw new BridgeError(
      400,
      "bad_request",
      "That isn't a WhatsApp group id (…@g.us).",
    );
  }
  return jid;
}

async function body<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new BridgeError(400, "bad_request", "The body must be JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BridgeError(
      400,
      "bad_request",
      issue
        ? `${issue.path.join(".") || "body"}: ${issue.message}`
        : "Invalid body.",
    );
  }
  return parsed.data;
}

function phonesToJids(phones: readonly string[]): string[] {
  return phones
    .map((value) => jidFromPhone(value))
    .filter((jid): jid is string => Boolean(jid));
}

export function createApp(deps: AppDeps) {
  const { client, mappings, media, sent } = deps;
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof BridgeError) {
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    }
    deps.logger?.error({ error: error.message }, "unhandled API error");
    return c.json(
      {
        error: {
          code: "internal",
          message: "The bridge hit an unexpected error.",
        },
      },
      500,
    );
  });

  // Unauthenticated, for the container healthcheck and uptime probes. Says
  // whether the process is up and the session state — nothing else.
  app.get("/healthz", (c) =>
    c.json({ ok: true, session: client.state().status }),
  );

  const v1 = new Hono();
  v1.use("*", bearerAuth(deps.apiToken));

  // ── session ─────────────────────────────────────────────────────────

  const sessionView = () => {
    const state = client.state();
    return {
      account: state.account,
      lastDisconnect: state.lastDisconnect,
      outbox: deps.outboxHealth(),
      qrAvailable: Boolean(state.qr),
      qrIssuedAt: state.qrIssuedAt,
      status: state.status,
      updatedAt: state.updatedAt,
    };
  };

  v1.get("/session", (c) => c.json(sessionView()));

  v1.post("/session/connect", (c) => {
    // Opening the socket can take seconds; the caller polls /session/qr.
    void client
      .connect()
      .catch((error: Error) =>
        deps.logger?.error({ error: error.message }, "connect failed"),
      );
    return c.json(sessionView(), 202);
  });

  v1.get("/session/qr", async (c) => {
    const state = client.state();
    if (!state.qr) {
      return c.json(
        {
          error: {
            code: "no_qr",
            message:
              state.status === "open"
                ? "Already connected; there is no QR to scan."
                : "No QR yet. Ask for one with POST /v1/session/connect, then try again in a few seconds.",
          },
          status: state.status,
        },
        404,
      );
    }
    const dataUrl = await QRCode.toDataURL(state.qr, { margin: 1, width: 320 });
    return c.json({ dataUrl, issuedAt: state.qrIssuedAt, qr: state.qr });
  });

  v1.post("/session/logout", async (c) => {
    await client.logout();
    return c.json(sessionView());
  });

  v1.post("/session/restart", async (c) => {
    await client.restart();
    return c.json(sessionView());
  });

  // ── groups ──────────────────────────────────────────────────────────

  const withMapping = async (group: GroupInfo) => ({
    ...group,
    projectId: (await mappings.get(group.jid))?.projectId ?? null,
  });

  v1.get("/groups", async (c) => {
    const groups = await client.listGroups();
    return c.json({ groups: await Promise.all(groups.map(withMapping)) });
  });

  v1.post("/groups", async (c) => {
    const input = await body(c, createGroupSchema);
    const group = await client.createGroup({
      description: input.description || null,
      participantJids: phonesToJids(input.participants),
      subject: input.subject,
    });
    if (input.projectId) await mappings.set(group.jid, input.projectId);
    // The group exists from here on. A failed link fetch must not hide that.
    let inviteLink: string | null = null;
    try {
      inviteLink = await client.inviteLink(group.jid);
    } catch {
      inviteLink = null;
    }
    return c.json({ group: await withMapping(group), inviteLink }, 201);
  });

  v1.get("/groups/:jid", async (c) => {
    const group = await client.groupInfo(groupJidParam(c));
    return c.json({ group: await withMapping(group) });
  });

  v1.get("/groups/:jid/invite", async (c) => {
    return c.json({ inviteLink: await client.inviteLink(groupJidParam(c)) });
  });

  v1.post("/groups/:jid/participants", async (c) => {
    const jid = groupJidParam(c);
    const input = await body(c, participantsSchema);
    const results = await client.updateParticipants(
      jid,
      phonesToJids(input.participants),
      input.action,
    );
    return c.json({ results });
  });

  v1.post("/groups/:jid/messages", async (c) => {
    const jid = groupJidParam(c);
    const key = c.req.header("idempotency-key")?.trim();
    if (!key || key.length > MAX_KEY_LENGTH) {
      throw new BridgeError(
        400,
        "bad_request",
        "An Idempotency-Key header is required, so a retry cannot post twice.",
      );
    }
    const input = await body(c, messageSchema);

    if (!sent.claim(key)) {
      // Another request is sending this key right now; it may reach the
      // group, so the caller must not treat this as "nothing was sent".
      throw new BridgeError(
        409,
        "send_in_progress",
        "This message is already being sent. Wait for it to finish before trying again.",
      );
    }
    try {
      const prior = await sent.find(key);
      if (prior) {
        if (prior.groupJid !== jid) {
          throw new BridgeError(
            409,
            "key_conflict",
            "That Idempotency-Key was used for another group.",
          );
        }
        if (prior.status === "sent") {
          return c.json({
            messageId: prior.messageId,
            replayed: true,
            sentAt: prior.sentAt,
          });
        }
        // An earlier attempt with this key went to WhatsApp and was never
        // confirmed. Sending again could post it twice.
        throw new BridgeError(
          504,
          "send_unconfirmed",
          "An earlier attempt to send this message was never confirmed by WhatsApp. Check the group before sending it again.",
        );
      }
      // The intent, with the message id chosen up front, is on disk before
      // WhatsApp is called: a lost answer cannot become a second send.
      const messageId = client.newMessageId();
      await sent.begin(key, jid, messageId);
      let result: { messageId: string; sentAt: string };
      try {
        result = await client.sendText(jid, input.text, messageId);
      } catch (error) {
        if (
          error instanceof BridgeError
          && (error.code === "not_connected"
            || error.code === "whatsapp_refused")
        ) {
          // Refused before anything left: the key may be used again.
          await sent.discard(key);
        } else {
          await sent.markUnconfirmed(key);
        }
        throw error;
      }
      const record = await sent.confirm(key, result.sentAt);
      return c.json({
        messageId: record.messageId,
        replayed: false,
        sentAt: record.sentAt,
      });
    } finally {
      sent.release(key);
    }
  });

  // ── mappings ────────────────────────────────────────────────────────

  v1.get("/mappings", async (c) => c.json({ mappings: await mappings.list() }));

  v1.put("/mappings", async (c) => {
    const input = await body(c, replaceMappingsSchema);
    const projects = new Set<string>();
    for (const mapping of input.mappings) {
      if (projects.has(mapping.projectId)) {
        throw new BridgeError(
          400,
          "bad_request",
          `Project ${mapping.projectId} is mapped to two groups.`,
        );
      }
      projects.add(mapping.projectId);
    }
    const changes = await mappings.replace(input.mappings);
    return c.json({ ...changes, mappings: await mappings.list() });
  });

  v1.put("/mappings/:jid", async (c) => {
    const jid = groupJidParam(c);
    const input = await body(c, mappingSchema);
    return c.json({ mapping: await mappings.set(jid, input.projectId) });
  });

  // `?projectId=` removes the mapping only while it is still that project's,
  // so a late unlink cannot undo a newer link to another project.
  v1.delete("/mappings/:jid", async (c) => {
    const projectId = c.req.query("projectId")?.trim() || undefined;
    const result = await mappings.remove(groupJidParam(c), projectId);
    return c.json(result);
  });

  // ── media ───────────────────────────────────────────────────────────

  v1.get("/media/:messageId", async (c) => {
    const stored = await media.read(c.req.param("messageId") ?? "");
    if (!stored) {
      throw new BridgeError(
        404,
        "not_found",
        "The bridge no longer has this file (it keeps files for a limited time, or never downloaded it).",
      );
    }
    return c.body(new Uint8Array(stored.bytes), 200, {
      "Cache-Control": "no-store",
      "Content-Length": String(stored.meta.byteSize),
      "Content-Type": stored.meta.mimeType ?? "application/octet-stream",
      "X-Content-Sha256": stored.meta.sha256,
    });
  });

  app.route("/v1", v1);
  app.notFound((c) =>
    c.json({ error: { code: "not_found", message: "No such route." } }, 404),
  );
  return app;
}
