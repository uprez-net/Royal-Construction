import { rm } from "node:fs/promises";
import path from "node:path";

import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  generateMessageIDV2,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  WAMessageStatus,
  type GroupMetadata,
  type WAMessage,
  type WASocket,
} from "baileys";
import type { Logger } from "pino";

import type { EventOutbox } from "../events/outbox.js";
import type {
  BridgeAccount,
  BridgeMedia,
  MessageStatus,
} from "../events/types.js";
import { baileysLogger } from "../logger.js";
import type { MappingStore } from "../store/mappings.js";
import type { MediaStore } from "../store/media.js";
import type { SentMessageStore } from "../store/sent-messages.js";
import {
  BridgeError,
  NOT_CONNECTED_MESSAGE,
  type GroupInfo,
  type ParticipantResult,
  type SessionState,
  type WhatsAppClient,
} from "./client.js";
import { bareJid, firstPhone, isGroupJid, phoneFromJid } from "./jid.js";
import { messageSentAt, normaliseContent } from "./normalise.js";

// The one WhatsApp session this bridge holds: Royal's number, linked as a
// device by scanning a QR code, the way WhatsApp Web is.
//
// Lifecycle:
//
//   logged_out ──connect()──▶ connecting ──▶ awaiting_qr ──scan──▶ open
//        ▲                         ▲                │                │
//        │                         └──── reconnect ─┴── dropped ─────┘
//        └──── logout(), unlinked from the phone, or the QR expired
//
// With saved keys the bridge connects by itself at start-up and after any
// drop. Without them it waits for someone to ask for a QR (POST
// /v1/session/connect) rather than generating codes forever.
//
// Only groups the app has mapped to a project produce events. Everything else
// on the account is ignored here and never reaches the app.

type Options = {
  readonly dataDir: string;
  readonly mediaMaxBytes: number;
  readonly logger: Logger;
  readonly mappings: MappingStore;
  readonly media: MediaStore;
  readonly sent: SentMessageStore;
  readonly outbox: EventOutbox;
};

const GROUP_CACHE_MS = 5 * 60 * 1000;
const RECENT_MESSAGES = 500;
const MAX_RECONNECT_DELAY_MS = 60_000;

/** Baileys' errors are Boom errors; the HTTP-like status is the useful part. */
function statusOf(error: unknown): number | null {
  const boom = error as { output?: { statusCode?: number }; data?: unknown };
  return typeof boom?.output?.statusCode === "number"
    ? boom.output.statusCode
    : null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const STATUS_NAMES: Partial<Record<number, MessageStatus["status"]>> = {
  [WAMessageStatus.ERROR]: "failed",
  [WAMessageStatus.SERVER_ACK]: "sent",
  [WAMessageStatus.DELIVERY_ACK]: "delivered",
  [WAMessageStatus.READ]: "read",
  [WAMessageStatus.PLAYED]: "read",
};

export class BaileysSession implements WhatsAppClient {
  private sock: WASocket | null = null;
  private current: SessionState = {
    account: null,
    lastDisconnect: null,
    qr: null,
    qrIssuedAt: null,
    status: "starting",
    updatedAt: new Date().toISOString(),
  };
  private connecting: Promise<void> | null = null;
  private stopping = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private registered = false;
  private readonly groupCache = new Map<
    string,
    { metadata: GroupMetadata; at: number }
  >();
  private readonly recent = new Map<string, WAMessage>();
  private readonly log: Logger;

  constructor(private readonly options: Options) {
    this.log = options.logger.child({ component: "session" });
  }

  private get authDir(): string {
    return path.join(this.options.dataDir, "auth");
  }

  // ── lifecycle ───────────────────────────────────────────────────────

  /** Connect with saved keys if there are any; otherwise wait for a QR request. */
  async start(): Promise<void> {
    const { state } = await useMultiFileAuthState(this.authDir);
    if (state.creds.registered) {
      await this.connect();
    } else {
      this.setState({ status: "logged_out" });
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const sock = this.sock;
    this.sock = null;
    await sock?.end(undefined).catch(() => undefined);
  }

  state(): SessionState {
    return this.current;
  }

  /** Start a connection (and so a QR, when not linked). Idempotent. */
  async connect(): Promise<void> {
    if (this.current.status === "open" || this.connecting) {
      return this.connecting ?? undefined;
    }
    this.stopping = false;
    this.connecting = this.openSocket().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  async restart(): Promise<void> {
    const sock = this.sock;
    this.sock = null;
    this.stopping = true;
    await sock?.end(undefined).catch(() => undefined);
    this.stopping = false;
    this.reconnectAttempts = 0;
    await this.connect();
  }

  async logout(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const sock = this.sock;
    this.sock = null;
    if (sock && this.current.status === "open") {
      // Tells WhatsApp to unlink this device; the phone's list updates.
      await sock.logout("Disconnected from Royal admin").catch((error) => {
        this.log.warn(
          { error: describe(error) },
          "logout call failed; wiping keys anyway",
        );
      });
    } else {
      await sock?.end(undefined).catch(() => undefined);
    }
    await this.wipeAuth();
    this.setState({
      account: null,
      lastDisconnect: {
        at: new Date().toISOString(),
        code: DisconnectReason.loggedOut,
        reason: "Disconnected from Royal admin.",
      },
      qr: null,
      qrIssuedAt: null,
      status: "logged_out",
    });
    await this.announceSession("Disconnected from Royal admin.");
    this.stopping = false;
  }

  private async wipeAuth(): Promise<void> {
    this.registered = false;
    this.groupCache.clear();
    await rm(this.authDir, { force: true, recursive: true });
  }

  private setState(patch: Partial<SessionState>): void {
    this.current = {
      ...this.current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
  }

  private async announceSession(reason: string | null): Promise<void> {
    await this.options.outbox
      .enqueue("session.updated", {
        account: this.current.account,
        reason,
        status: this.current.status,
      })
      .catch((error) =>
        this.log.error(
          { error: describe(error) },
          "could not queue session event",
        ),
      );
  }

  private async openSocket(): Promise<void> {
    this.setState({ status: "connecting" });
    const blog = baileysLogger(this.options.logger);
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    this.registered = Boolean(state.creds.registered);

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, blog),
      },
      browser: Browsers.ubuntu("Chrome"),
      cachedGroupMetadata: async (jid) => this.cachedGroup(jid),
      getMessage: async (key) =>
        (key.id ? this.recent.get(key.id)?.message : undefined) ?? undefined,
      logger: blog,
      // The office keeps getting notifications on the phone.
      markOnlineOnConnect: false,
      // Only new messages matter; the app is not an archive of the account.
      // The initial (non-full) sync stays on: Baileys learns the LID → phone
      // mappings from it, and refuses to be stable without them.
      syncFullHistory: false,
    });
    this.sock = sock;

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (update) => {
      void this.onConnectionUpdate(sock, update);
    });
    sock.ev.on("messages.upsert", ({ messages }) => {
      for (const message of messages) {
        void this.onMessage(sock, message).catch((error) =>
          this.log.error(
            { error: describe(error), messageId: message.key.id },
            "could not handle an incoming message",
          ),
        );
      }
    });
    sock.ev.on("messages.update", (updates) => {
      for (const { key, update } of updates) {
        if (update.status === undefined || update.status === null) continue;
        void this.onStatus(key.remoteJid, key.id, key.fromMe, update.status);
      }
    });
    sock.ev.on("groups.upsert", (groups) => {
      for (const group of groups) this.cacheGroup(group);
    });
    sock.ev.on("groups.update", (updates) => {
      for (const update of updates) void this.onGroupUpdate(update);
    });
    sock.ev.on("group-participants.update", (event) => {
      void this.onParticipants(event);
    });
  }

  private async onConnectionUpdate(
    sock: WASocket,
    update: Partial<import("baileys").ConnectionState>,
  ): Promise<void> {
    if (sock !== this.sock) return;
    if (update.qr) {
      this.setState({
        qr: update.qr,
        qrIssuedAt: new Date().toISOString(),
        status: "awaiting_qr",
      });
    }
    if (update.connection === "open") {
      this.reconnectAttempts = 0;
      this.registered = true;
      const user = sock.user;
      const account: BridgeAccount | null = user
        ? {
            jid: bareJid(user.id),
            name: user.name ?? user.notify ?? null,
            phoneE164: firstPhone(user.phoneNumber, user.id),
          }
        : null;
      this.setState({ account, qr: null, qrIssuedAt: null, status: "open" });
      this.log.info("WhatsApp session open");
      await this.announceSession(null);
      return;
    }
    if (update.connection !== "close") return;

    const code = statusOf(update.lastDisconnect?.error);
    const reason = describe(
      update.lastDisconnect?.error ?? "Connection closed.",
    );
    this.sock = null;
    const wasOpen = this.current.status === "open";
    this.setState({
      lastDisconnect: { at: new Date().toISOString(), code, reason },
      qr: null,
      qrIssuedAt: null,
    });
    if (this.stopping) return;

    if (code === DisconnectReason.loggedOut) {
      // Unlinked from the phone (Linked devices › Log out), or WhatsApp
      // revoked the session. The keys are useless now.
      this.log.error("WhatsApp unlinked this device; a new QR scan is needed");
      await this.wipeAuth();
      this.setState({ account: null, status: "logged_out" });
      await this.announceSession("WhatsApp unlinked this device.");
      return;
    }
    if (!this.registered && code !== DisconnectReason.restartRequired) {
      // Nobody scanned the QR in time. Wait to be asked again.
      this.setState({ status: "logged_out" });
      return;
    }
    if (code === DisconnectReason.restartRequired) {
      // Expected straight after a successful scan.
      this.setState({ status: "connecting" });
      await this.connect();
      return;
    }
    this.setState({ status: "connecting" });
    if (wasOpen)
      await this.announceSession(`Connection dropped (${code ?? "no code"}).`);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(
      1000 * 2 ** this.reconnectAttempts,
      MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempts += 1;
    this.log.warn({ delay, attempt: this.reconnectAttempts }, "reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((error) => {
        this.log.error({ error: describe(error) }, "reconnect failed");
        this.scheduleReconnect();
      });
    }, delay);
  }

  // ── incoming ────────────────────────────────────────────────────────

  private remember(message: WAMessage): void {
    if (!message.key.id || !message.message) return;
    this.recent.set(message.key.id, message);
    if (this.recent.size > RECENT_MESSAGES) {
      const oldest = this.recent.keys().next().value;
      if (oldest) this.recent.delete(oldest);
    }
  }

  private async onMessage(sock: WASocket, message: WAMessage): Promise<void> {
    this.remember(message);
    const groupJid = message.key.remoteJid;
    const messageId = message.key.id;
    if (!isGroupJid(groupJid) || !messageId) return;
    const mapping = await this.options.mappings.get(groupJid);
    if (!mapping) return;
    // Sent through the API: the app already has it, with its author.
    if (this.options.sent.isOwn(messageId)) return;

    const content = normaliseContent(message.message);
    if (!content) return;

    const fromMe = Boolean(message.key.fromMe);
    const account = this.current.account;
    const key = message.key as typeof message.key & { participantAlt?: string };
    const senderJid = fromMe
      ? (account?.jid ?? "me")
      : (key.participant ?? key.participantAlt ?? "unknown");
    let phoneE164 = fromMe
      ? (account?.phoneE164 ?? null)
      : firstPhone(key.participantAlt, key.participant);
    if (!phoneE164 && key.participant) {
      const pn = await sock.signalRepository.lidMapping
        .getPNForLID(key.participant)
        .catch(() => null);
      phoneE164 = phoneFromJid(pn);
    }

    let media: BridgeMedia | null = null;
    if (content.kind === "media") {
      media = await this.download(sock, message, messageId, content.media);
    }

    await this.options.outbox.enqueue(
      "message.received",
      {
        fromMe,
        groupJid,
        kind: content.kind,
        media,
        messageId,
        projectId: mapping.projectId,
        sender: {
          jid: bareJid(senderJid),
          name: fromMe
            ? (account?.name ?? null)
            : message.pushName?.trim() || null,
          phoneE164,
        },
        sentAt: messageSentAt(message),
        text: content.kind === "unsupported" ? "" : content.text,
        unsupportedType: content.kind === "unsupported" ? content.type : null,
      },
      `msg:${messageId}`,
    );
  }

  private async download(
    sock: WASocket,
    message: WAMessage,
    messageId: string,
    info: Extract<
      ReturnType<typeof normaliseContent>,
      { kind: "media" }
    >["media"],
  ): Promise<BridgeMedia> {
    const base = { ...info, available: false, unavailableReason: null };
    if (info.byteSize !== null && info.byteSize > this.options.mediaMaxBytes) {
      return {
        ...base,
        unavailableReason: `The file is larger than the bridge keeps (${Math.round(this.options.mediaMaxBytes / 1024 / 1024)} MB).`,
      };
    }
    try {
      const bytes = await downloadMediaMessage(
        message,
        "buffer",
        {},
        {
          logger: baileysLogger(this.options.logger),
          reuploadRequest: sock.updateMediaMessage,
        },
      );
      if (bytes.byteLength > this.options.mediaMaxBytes) {
        return {
          ...base,
          unavailableReason: "The file is larger than the bridge keeps.",
        };
      }
      const stored = await this.options.media.save(messageId, bytes, {
        fileName: info.fileName,
        mimeType: info.mimeType,
      });
      return {
        ...base,
        available: true,
        byteSize: stored.byteSize,
        sha256: stored.sha256,
      };
    } catch (error) {
      this.log.warn(
        { error: describe(error), messageId },
        "media download failed",
      );
      return {
        ...base,
        unavailableReason: "WhatsApp didn't let the bridge download the file.",
      };
    }
  }

  private async onStatus(
    groupJid: string | null | undefined,
    messageId: string | null | undefined,
    fromMe: boolean | null | undefined,
    status: number,
  ): Promise<void> {
    if (!fromMe || !isGroupJid(groupJid) || !messageId) return;
    const name = STATUS_NAMES[status];
    if (!name) return;
    if (!(await this.options.mappings.get(groupJid))) return;
    await this.options.outbox
      .enqueue(
        "message.status",
        { at: new Date().toISOString(), groupJid, messageId, status: name },
        `status:${messageId}:${name}`,
      )
      .catch((error) =>
        this.log.error({ error: describe(error) }, "could not queue a status"),
      );
  }

  private async onGroupUpdate(update: Partial<GroupMetadata>): Promise<void> {
    if (!update.id) return;
    this.groupCache.delete(update.id);
    const mapping = await this.options.mappings.get(update.id);
    if (!mapping || update.subject === undefined) return;
    await this.options.outbox.enqueue("group.updated", {
      groupJid: update.id,
      projectId: mapping.projectId,
      subject: update.subject ?? null,
    });
  }

  private async onParticipants(event: {
    id: string;
    participants: { id: string; phoneNumber?: string }[];
    action: string;
  }): Promise<void> {
    this.groupCache.delete(event.id);
    const mapping = await this.options.mappings.get(event.id);
    if (!mapping) return;
    if (!["add", "remove", "promote", "demote"].includes(event.action)) return;
    await this.options.outbox.enqueue("group.participants", {
      action: event.action as "add" | "remove" | "promote" | "demote",
      groupJid: event.id,
      participants: event.participants.map((participant) => ({
        jid: bareJid(participant.id),
        phoneE164: firstPhone(participant.phoneNumber, participant.id),
      })),
      projectId: mapping.projectId,
    });
  }

  // ── groups and sending ──────────────────────────────────────────────

  private requireSocket(): WASocket {
    if (!this.sock || this.current.status !== "open") {
      throw new BridgeError(503, "not_connected", NOT_CONNECTED_MESSAGE);
    }
    return this.sock;
  }

  private cacheGroup(metadata: GroupMetadata): void {
    this.groupCache.set(metadata.id, { at: Date.now(), metadata });
  }

  private async cachedGroup(jid: string): Promise<GroupMetadata | undefined> {
    const hit = this.groupCache.get(jid);
    if (hit && Date.now() - hit.at < GROUP_CACHE_MS) return hit.metadata;
    return undefined;
  }

  private toGroupInfo(metadata: GroupMetadata): GroupInfo {
    const me = this.sock?.user;
    const mine = new Set(
      [me?.id, me?.lid, me?.phoneNumber]
        .filter(Boolean)
        .map((jid) => bareJid(jid!)),
    );
    const participants = metadata.participants.map((participant) => ({
      admin: participant.admin ?? null,
      jid: bareJid(participant.id),
      phoneE164: firstPhone(participant.phoneNumber, participant.id),
    }));
    const self = metadata.participants.find((participant) =>
      [participant.id, participant.lid, participant.phoneNumber]
        .filter(Boolean)
        .some((jid) => mine.has(bareJid(jid!))),
    );
    return {
      announce: Boolean(metadata.announce),
      createdAt: metadata.creation
        ? new Date(metadata.creation * 1000).toISOString()
        : null,
      description: metadata.desc?.trim() || null,
      isAdmin: Boolean(self?.admin),
      jid: metadata.id,
      participants,
      subject: metadata.subject,
    };
  }

  /** WhatsApp's refusal, or a timeout, as the API reports it. */
  private failure(error: unknown, action: string): BridgeError {
    if (error instanceof BridgeError) return error;
    const status = statusOf(error);
    if (status === 404 || /item-not-found/i.test(describe(error))) {
      return new BridgeError(
        404,
        "not_found",
        "That group isn't on this WhatsApp account.",
      );
    }
    if (status === 401 || status === 403) {
      return new BridgeError(
        422,
        "not_admin",
        `WhatsApp refused to ${action}: Royal's number must be in the group, and an admin of it.`,
      );
    }
    if (status === 408 || status === 428 || status === null) {
      return new BridgeError(
        504,
        "whatsapp_timeout",
        `WhatsApp didn't answer in time to ${action}.`,
      );
    }
    return new BridgeError(
      502,
      "whatsapp_refused",
      `WhatsApp refused to ${action} (${status}).`,
    );
  }

  async listGroups(): Promise<GroupInfo[]> {
    const sock = this.requireSocket();
    try {
      const groups = await sock.groupFetchAllParticipating();
      return Object.values(groups)
        .filter((metadata) => !metadata.isCommunity)
        .map((metadata) => {
          this.cacheGroup(metadata);
          return this.toGroupInfo(metadata);
        })
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    } catch (error) {
      throw this.failure(error, "list the groups");
    }
  }

  async groupInfo(groupJid: string): Promise<GroupInfo> {
    const sock = this.requireSocket();
    try {
      const metadata = await sock.groupMetadata(groupJid);
      this.cacheGroup(metadata);
      return this.toGroupInfo(metadata);
    } catch (error) {
      throw this.failure(error, "read the group");
    }
  }

  async createGroup(input: {
    subject: string;
    participantJids: readonly string[];
    description: string | null;
  }): Promise<GroupInfo> {
    const sock = this.requireSocket();
    let metadata: GroupMetadata;
    try {
      metadata = await sock.groupCreate(input.subject, [
        ...input.participantJids,
      ]);
    } catch (error) {
      throw this.failure(error, "create the group");
    }
    this.cacheGroup(metadata);
    if (input.description) {
      await sock
        .groupUpdateDescription(metadata.id, input.description)
        .catch((error) =>
          this.log.warn(
            { error: describe(error) },
            "group description not set",
          ),
        );
    }
    return this.toGroupInfo(metadata);
  }

  async inviteLink(groupJid: string): Promise<string> {
    const sock = this.requireSocket();
    let code: string | undefined;
    try {
      code = await sock.groupInviteCode(groupJid);
    } catch (error) {
      throw this.failure(error, "share the group's invite link");
    }
    if (!code) {
      throw new BridgeError(
        502,
        "whatsapp_refused",
        "WhatsApp returned no invite link.",
      );
    }
    return `https://chat.whatsapp.com/${code}`;
  }

  async updateParticipants(
    groupJid: string,
    participantJids: readonly string[],
    action: "add" | "remove",
  ): Promise<ParticipantResult[]> {
    const sock = this.requireSocket();
    try {
      const results = await sock.groupParticipantsUpdate(
        groupJid,
        [...participantJids],
        action,
      );
      this.groupCache.delete(groupJid);
      return results.map((result, index) => {
        const jid = result.jid ?? participantJids[index] ?? "";
        return {
          jid: bareJid(jid),
          phoneE164: phoneFromJid(jid),
          status: result.status,
        };
      });
    } catch (error) {
      throw this.failure(error, `${action} participants`);
    }
  }

  newMessageId(): string {
    return generateMessageIDV2(this.sock?.user?.id);
  }

  async sendText(
    groupJid: string,
    text: string,
    messageId: string,
  ): Promise<{ messageId: string; sentAt: string }> {
    const sock = this.requireSocket();
    this.options.sent.expect(messageId);
    try {
      const sent = await sock.sendMessage(groupJid, { text }, { messageId });
      return {
        messageId: sent?.key.id ?? messageId,
        sentAt: new Date().toISOString(),
      };
    } catch (error) {
      const status = statusOf(error);
      // A refusal WhatsApp gave before anything left: not in the group, or
      // no such group. Anything else may have been delivered.
      if (
        status === 403
        || status === 404
        || status === 400
        || status === 401
      ) {
        throw new BridgeError(
          502,
          "whatsapp_refused",
          `WhatsApp refused the message (${status}). Royal's number may have been removed from the group.`,
        );
      }
      throw new BridgeError(
        504,
        "send_unconfirmed",
        "WhatsApp didn't confirm the message. It may have been delivered; check the group before sending again.",
      );
    }
  }
}
