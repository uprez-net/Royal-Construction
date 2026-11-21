import {
  BridgeError,
  NOT_CONNECTED_MESSAGE,
  type GroupInfo,
  type ParticipantResult,
  type SessionState,
  type WhatsAppClient,
} from "../src/whatsapp/client.js";

// A WhatsApp that lives in memory, for the API tests.

export class FakeClient implements WhatsAppClient {
  status: SessionState["status"] = "open";
  qr: string | null = null;
  groups = new Map<string, GroupInfo>();
  sends: { groupJid: string; text: string; messageId: string }[] = [];
  sendFailure: BridgeError | null = null;
  private counter = 0;
  connects = 0;
  logouts = 0;

  state(): SessionState {
    return {
      account:
        this.status === "open"
          ? {
              jid: "61280001234@s.whatsapp.net",
              name: "Royal",
              phoneE164: "+61280001234",
            }
          : null,
      lastDisconnect: null,
      qr: this.qr,
      qrIssuedAt: this.qr ? "2026-11-21T00:00:00.000Z" : null,
      status: this.status,
      updatedAt: "2026-11-21T00:00:00.000Z",
    };
  }

  private requireOpen() {
    if (this.status !== "open") {
      throw new BridgeError(503, "not_connected", NOT_CONNECTED_MESSAGE);
    }
  }

  async connect() {
    this.connects += 1;
  }

  async logout() {
    this.logouts += 1;
    this.status = "logged_out";
  }

  async restart() {}

  async listGroups() {
    this.requireOpen();
    return [...this.groups.values()];
  }

  async groupInfo(jid: string) {
    this.requireOpen();
    const group = this.groups.get(jid);
    if (!group) throw new BridgeError(404, "not_found", "No such group.");
    return group;
  }

  async createGroup(input: {
    subject: string;
    participantJids: readonly string[];
  }) {
    this.requireOpen();
    const jid = `1203630000000${this.groups.size + 1}@g.us`;
    const group: GroupInfo = {
      announce: false,
      createdAt: "2026-11-21T00:00:00.000Z",
      description: null,
      isAdmin: true,
      jid,
      participants: input.participantJids.map((participant) => ({
        admin: null,
        jid: participant,
        phoneE164: `+${participant.split("@")[0]}`,
      })),
      subject: input.subject,
    };
    this.groups.set(jid, group);
    return group;
  }

  async inviteLink(jid: string) {
    await this.groupInfo(jid);
    return `https://chat.whatsapp.com/INVITE${jid.slice(0, 6)}`;
  }

  async updateParticipants(
    jid: string,
    participantJids: readonly string[],
  ): Promise<ParticipantResult[]> {
    await this.groupInfo(jid);
    return participantJids.map((participant) => ({
      jid: participant,
      phoneE164: `+${participant.split("@")[0]}`,
      status: "200",
    }));
  }

  newMessageId() {
    this.counter += 1;
    return `3EB0TEST${String(this.counter).padStart(8, "0")}`;
  }

  async sendText(groupJid: string, text: string, messageId: string) {
    this.requireOpen();
    if (this.sendFailure) throw this.sendFailure;
    this.sends.push({ groupJid, messageId, text });
    return { messageId, sentAt: "2026-11-21T01:00:00.000Z" };
  }
}
