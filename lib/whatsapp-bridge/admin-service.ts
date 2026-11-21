import type { WhatsAppBridgeSession } from "@/lib/domain/ports/whatsapp-bridge";
import type {
  ProjectWhatsAppGroupDto,
  WhatsAppBridgeGroupDto,
} from "@/lib/projects/whatsapp-types";
import { fetchJson } from "@/utils/fetch";

// The browser's side of Admin › WhatsApp bridge. Each call unwraps the
// { success, data } envelope and lets the server's sentence through.

async function unwrap<T>(
  input: string,
  init: RequestInit,
  fallback: string,
): Promise<T> {
  // fetchJson takes the signal as its own argument and would drop one in init.
  const { signal, ...rest } = init;
  const body = await fetchJson<T>(input, rest, fallback, signal ?? undefined);
  if (!body.success) throw new Error(fallback);
  return body.data;
}

const BASE = "/api/admin/whatsapp-bridge";
const JSON_HEADERS = { "Content-Type": "application/json" };

export type WhatsAppBridgeSessionDto = WhatsAppBridgeSession;

export function fetchBridgeSession(signal?: AbortSignal) {
  return unwrap<WhatsAppBridgeSessionDto>(
    `${BASE}/session`,
    { cache: "no-store", method: "GET", signal },
    "Could not read the WhatsApp bridge's status.",
  );
}

export function connectBridge() {
  return unwrap<WhatsAppBridgeSessionDto>(
    `${BASE}/session/connect`,
    { method: "POST" },
    "Could not start the WhatsApp bridge.",
  );
}

export function fetchBridgeQr(signal?: AbortSignal) {
  return unwrap<{ dataUrl: string; issuedAt: string | null } | null>(
    `${BASE}/session/qr`,
    { cache: "no-store", method: "GET", signal },
    "Could not read the QR code.",
  );
}

export function disconnectBridge() {
  return unwrap<WhatsAppBridgeSessionDto>(
    `${BASE}/session/logout`,
    { method: "POST" },
    "Could not disconnect the WhatsApp bridge.",
  );
}

export function fetchBridgeGroups(signal?: AbortSignal) {
  return unwrap<{ groups: WhatsAppBridgeGroupDto[] }>(
    `${BASE}/groups`,
    { cache: "no-store", method: "GET", signal },
    "Could not list the WhatsApp groups.",
  );
}

export function linkBridgeGroup(groupJid: string, projectId: string) {
  return unwrap<{ group: ProjectWhatsAppGroupDto; alreadyLinked: boolean }>(
    `${BASE}/groups/link`,
    {
      body: JSON.stringify({ groupJid, projectId }),
      headers: JSON_HEADERS,
      method: "POST",
    },
    "The WhatsApp group could not be linked.",
  );
}

/** `groupJid` is the group the admin confirmed; refused if it changed. */
export function unlinkBridgeGroup(projectId: string, groupJid: string) {
  return unwrap<{ group: ProjectWhatsAppGroupDto; bridgeUpdated: boolean }>(
    `${BASE}/groups/unlink`,
    {
      body: JSON.stringify({ groupJid, projectId }),
      headers: JSON_HEADERS,
      method: "POST",
    },
    "The WhatsApp group could not be unlinked.",
  );
}

export function resyncBridgeGroups() {
  return unwrap<{
    added: number;
    removed: number;
    changed: number;
    total: number;
  }>(
    `${BASE}/groups/resync`,
    { method: "POST" },
    "Could not resync the WhatsApp bridge.",
  );
}

/** Projects for the "link to project" picker: name or address search. */
export function searchProjects(query: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ limit: "8", mode: "lookup" });
  if (query.trim()) params.set("q", query.trim());
  return unwrap<{ items: { id: string; name: string; location: string }[] }>(
    `/api/projects?${params.toString()}`,
    { cache: "no-store", method: "GET", signal },
    "Could not search projects.",
  );
}
