import { idempotencyHeader } from "@/lib/idempotency/attempt-key";
import { fetchJson } from "@/utils/fetch";

import type {
  ProjectWhatsAppCreateResultDto,
  ProjectWhatsAppGroupDto,
  ProjectWhatsAppInviteDraftDto,
  ProjectWhatsAppInviteResultDto,
  ProjectWhatsAppMessageDto,
  ProjectWhatsAppSendResultDto,
  ProjectWhatsAppThreadDto,
  WhatsAppBridgeGroupDto,
} from "./whatsapp-types";

// The browser's side of a project's WhatsApp group routes. Each call unwraps
// the { success, data } envelope and lets the server's sentence through — the
// office needs "The WhatsApp bridge isn't connected. Scan the QR code…", not
// "request failed".

async function unwrap<T>(
  input: string,
  init: RequestInit,
  fallback: string,
): Promise<T> {
  const body = await fetchJson<T>(input, init, fallback);
  if (!body.success) throw new Error(fallback);
  return body.data;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

function base(projectId: string) {
  return `/api/projects/${encodeURIComponent(projectId)}/whatsapp`;
}

/** Other parts of the page listen for this to refresh their copy. */
export const PROJECT_WHATSAPP_CHANGED = "project-whatsapp-changed";

export function announceProjectWhatsAppChange(projectId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(PROJECT_WHATSAPP_CHANGED, { detail: { projectId } }),
  );
}

export function fetchProjectWhatsApp(
  projectId: string,
  options: {
    before?: string | null;
    limit?: number;
    signal?: AbortSignal;
  } = {},
): Promise<ProjectWhatsAppThreadDto> {
  const params = new URLSearchParams();
  if (options.before) params.set("before", options.before);
  if (options.limit) params.set("limit", String(options.limit));
  const query = params.toString() ? `?${params.toString()}` : "";
  return unwrap<ProjectWhatsAppThreadDto>(
    `${base(projectId)}${query}`,
    { cache: "no-store", method: "GET", signal: options.signal },
    "Could not load the project's WhatsApp group.",
  );
}

/** Create the project's group on Royal's number (the owners are added). */
export function createProjectWhatsAppGroup(
  projectId: string,
  options: {
    /** After an unconfirmed create, the office checked: there is no group. */
    confirmNoGroup?: boolean;
  } = {},
): Promise<ProjectWhatsAppCreateResultDto> {
  return unwrap<ProjectWhatsAppCreateResultDto>(
    base(projectId),
    options.confirmNoGroup
      ? {
          body: JSON.stringify({ confirmNoGroup: true }),
          headers: JSON_HEADERS,
          method: "POST",
        }
      : { method: "POST" },
    "The WhatsApp group could not be created.",
  );
}

/** Groups Royal's number is in that no project has linked yet. */
export function fetchLinkableWhatsAppGroups(
  projectId: string,
  signal?: AbortSignal,
): Promise<{ groups: WhatsAppBridgeGroupDto[] }> {
  return unwrap<{ groups: WhatsAppBridgeGroupDto[] }>(
    `${base(projectId)}/link`,
    { cache: "no-store", method: "GET", signal },
    "Could not list the WhatsApp groups.",
  );
}

export function linkProjectWhatsAppGroup(
  projectId: string,
  groupJid: string,
): Promise<{ group: ProjectWhatsAppGroupDto; alreadyLinked: boolean }> {
  return unwrap(
    `${base(projectId)}/link`,
    {
      body: JSON.stringify({ groupJid }),
      headers: JSON_HEADERS,
      method: "POST",
    },
    "The WhatsApp group could not be linked.",
  );
}

/** `groupJid` is the group the person confirmed; refused if it changed. */
export function unlinkProjectWhatsAppGroup(
  projectId: string,
  groupJid: string,
): Promise<{ group: ProjectWhatsAppGroupDto; bridgeUpdated: boolean }> {
  return unwrap(
    `${base(projectId)}/link`,
    {
      body: JSON.stringify({ groupJid }),
      headers: JSON_HEADERS,
      method: "DELETE",
    },
    "The WhatsApp group could not be unlinked.",
  );
}

export function refreshProjectWhatsAppInviteLink(
  projectId: string,
): Promise<{ group: ProjectWhatsAppGroupDto }> {
  return unwrap(
    `${base(projectId)}/invite-link`,
    { method: "POST" },
    "Could not refresh the invite link.",
  );
}

/**
 * Send one message into the group. `idempotencyKey` is the attempt's key from
 * `useIdempotencyKey()`: the same for a double click or a retry, a new one
 * only after a send succeeded. The route refuses a request without one.
 */
export function sendProjectWhatsAppMessage(
  projectId: string,
  body: string,
  idempotencyKey: string,
): Promise<ProjectWhatsAppSendResultDto> {
  return unwrap<ProjectWhatsAppSendResultDto>(
    `${base(projectId)}/messages`,
    {
      body: JSON.stringify({ body }),
      headers: { ...JSON_HEADERS, ...idempotencyHeader(idempotencyKey) },
      method: "POST",
    },
    "The WhatsApp message could not be sent.",
  );
}

export function reconcileProjectWhatsAppMessage(
  projectId: string,
  messageId: string,
  outcome: "sent" | "not_sent",
): Promise<{ message: ProjectWhatsAppMessageDto }> {
  return unwrap(
    `${base(projectId)}/messages/${encodeURIComponent(messageId)}/reconcile`,
    {
      body: JSON.stringify({ outcome }),
      headers: JSON_HEADERS,
      method: "POST",
    },
    "Could not reconcile the message.",
  );
}

export function markProjectWhatsAppRead(projectId: string): Promise<unknown> {
  return unwrap(
    `${base(projectId)}/read`,
    { method: "POST" },
    "Could not mark the group as read.",
  );
}

export function fetchProjectWhatsAppInviteDraft(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectWhatsAppInviteDraftDto> {
  return unwrap<ProjectWhatsAppInviteDraftDto>(
    `${base(projectId)}/invite`,
    { cache: "no-store", method: "GET", signal },
    "Could not prepare the invite.",
  );
}

/** Email the invite. Same key discipline as a message send. */
export function sendProjectWhatsAppInvite(
  projectId: string,
  body: { recipients: string[]; subject: string; body: string },
  idempotencyKey: string,
): Promise<ProjectWhatsAppInviteResultDto> {
  return unwrap<ProjectWhatsAppInviteResultDto>(
    `${base(projectId)}/invite`,
    {
      body: JSON.stringify(body),
      headers: { ...JSON_HEADERS, ...idempotencyHeader(idempotencyKey) },
      method: "POST",
    },
    "The invite could not be sent.",
  );
}

/** Ask for a failed WhatsApp file to be copied again. */
export function retryWhatsAppMediaFile(
  mediaId: string,
): Promise<{ queued: boolean; started: boolean }> {
  return unwrap(
    `/api/whatsapp/media/${encodeURIComponent(mediaId)}/retry`,
    { method: "POST" },
    "Could not retry the file.",
  );
}
