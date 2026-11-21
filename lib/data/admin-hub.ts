import "server-only";

import prisma from "@/lib/prisma";
import { currentPrincipal } from "@/lib/data/current-principal";
import { getTradeTypes } from "@/lib/data/trade-types";
import { fetchApprovalKPI } from "@/lib/data/tradie-approvals";
import { getXeroConnectionStatus } from "@/lib/data/xero-connection";
import { readMilestoneTemplate } from "@/lib/domain/projects/templates";
import { commsChannel, readCommsConfig } from "@/lib/comms/config";
import {
  whatsappAdminConfig,
  whatsappAdminHealth,
} from "@/lib/whatsapp/admin-status";
import { readWhatsAppBridgeConfig } from "@/lib/whatsapp-bridge/config";
import { xeroConnectionExpiry } from "@/lib/xero/connection-expiry";

// The status shown beside each Admin tool on the hub. One loader per tool,
// run in parallel, each with its own catch: a failed count shows "—" on its
// row and never takes the hub down with it. Every failure is console.error'd
// with the tool's name, so "—" is never a silent failure.
//
// Nothing here calls out over the network. WhatsApp and phone statuses read
// the same local config the destination pages read; the WhatsApp rule mirrors
// the headline in components/admin/whatsapp-status-panel.tsx and the Xero
// rule mirrors components/admin/xero-connection-panel.tsx.

export type AdminHubTool =
  | "approvals"
  | "team"
  | "build-sequence"
  | "trade-types"
  | "offer-content"
  | "xero"
  | "whatsapp"
  | "whatsapp-bridge"
  | "phone-sms";

/**
 * `tone` set: a status pill. `tone` null: plain text, as a count reads.
 */
export type AdminHubStatus = {
  label: string;
  tone: "success" | "warning" | "danger" | "neutral" | null;
};

export type AdminHubStatuses = Record<AdminHubTool, AdminHubStatus | null>;

const PROVIDER_LABEL = { telnyx: "Telnyx", twilio: "Twilio" } as const;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

async function statusOf(
  tool: AdminHubTool,
  load: () => Promise<AdminHubStatus>,
): Promise<AdminHubStatus | null> {
  try {
    return await load();
  } catch (error) {
    console.error(`admin hub: ${tool} status failed`, error);
    return null;
  }
}

function approvalsStatus(): Promise<AdminHubStatus | null> {
  return statusOf("approvals", async () => {
    const { waiting } = await fetchApprovalKPI();
    return waiting > 0
      ? { label: `${waiting} pending`, tone: "warning" }
      : { label: "None pending", tone: null };
  });
}

function teamStatus(): Promise<AdminHubStatus | null> {
  // Matches what Team lists: /api/users pages every Clerk user with no role
  // filter, and each Clerk user has one User row. Pending invites are not in
  // this count.
  return statusOf("team", async () => {
    const count = await prisma.user.count();
    return { label: plural(count, "person", "people"), tone: null };
  });
}

function buildSequenceStatus(): Promise<AdminHubStatus | null> {
  return statusOf("build-sequence", async () => {
    const snapshot = await readMilestoneTemplate(
      await currentPrincipal(),
      prisma,
    );
    const stages = new Set(snapshot.activities.map((row) => row.projectStage));
    return { label: plural(stages.size, "stage", "stages"), tone: null };
  });
}

function tradeTypesStatus(): Promise<AdminHubStatus | null> {
  // getTradeTypes() already drops archived trades.
  return statusOf("trade-types", async () => {
    const trades = await getTradeTypes();
    return { label: plural(trades.length, "type", "types"), tone: null };
  });
}

function xeroStatus(): Promise<AdminHubStatus | null> {
  return statusOf("xero", async () => {
    const status = await getXeroConnectionStatus();
    if (!status.connected) return { label: "Not connected", tone: "neutral" };
    const { state } = xeroConnectionExpiry(status.refreshTokenExpiresAt);
    if (state === "expired") return { label: "Expired", tone: "danger" };
    if (state === "expiring") {
      return { label: "Expiring soon", tone: "warning" };
    }
    return { label: "Connected", tone: "success" };
  });
}

function whatsappStatus(): Promise<AdminHubStatus | null> {
  return statusOf("whatsapp", async () => {
    const health = whatsappAdminHealth(whatsappAdminConfig());
    if (health === "off") return { label: "Off", tone: "neutral" };
    return health === "connected"
      ? { label: "Connected", tone: "success" }
      : { label: "Needs attention", tone: "warning" };
  });
}

// Configuration only, like the rest of the hub: whether the bridge is linked
// right now is a network call, made on its own page.
function whatsappBridgeStatus(): Promise<AdminHubStatus | null> {
  return statusOf("whatsapp-bridge", async () => {
    const config = readWhatsAppBridgeConfig();
    if (!config.enabled && config.problems.length === 0) {
      return { label: "Off", tone: "neutral" };
    }
    return config.enabled && config.problems.length === 0
      ? { label: "Configured", tone: "success" }
      : { label: "Needs attention", tone: "warning" };
  });
}

function phoneSmsStatus(): Promise<AdminHubStatus | null> {
  return statusOf("phone-sms", async () => {
    const config = readCommsConfig();
    if (config.problems.length > 0) {
      return { label: "Needs attention", tone: "warning" };
    }
    const channel = commsChannel(config);
    if (!channel || !(channel.smsAvailable || channel.callsAvailable)) {
      return { label: "Off", tone: "neutral" };
    }
    return {
      label: `${PROVIDER_LABEL[channel.provider]} active`,
      tone: "success",
    };
  });
}

/**
 * Every hub status, loaded in parallel. Offer content has no cheap, meaningful
 * status, so it is always null and its row shows "—".
 */
export async function getAdminHubStatuses(): Promise<AdminHubStatuses> {
  const [
    approvals,
    team,
    buildSequence,
    tradeTypes,
    xero,
    whatsapp,
    whatsappBridge,
    phoneSms,
  ] = await Promise.all([
    approvalsStatus(),
    teamStatus(),
    buildSequenceStatus(),
    tradeTypesStatus(),
    xeroStatus(),
    whatsappStatus(),
    whatsappBridgeStatus(),
    phoneSmsStatus(),
  ]);
  return {
    approvals,
    team,
    "build-sequence": buildSequence,
    "trade-types": tradeTypes,
    "offer-content": null,
    xero,
    whatsapp,
    "whatsapp-bridge": whatsappBridge,
    "phone-sms": phoneSms,
  };
}
