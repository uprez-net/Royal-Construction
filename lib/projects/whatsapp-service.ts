import { idempotencyHeader } from "@/lib/idempotency/attempt-key";
import { fetchJson } from "@/utils/fetch";

import type {
  LinkableWhatsAppGroupDto,
  ProjectWhatsAppGroupDto,
  ProjectWhatsAppInviteDraftDto,
  ProjectWhatsAppInviteResultDto,
  ProjectWhatsAppMessageDto,
  ProjectWhatsAppRequestResultDto,
  ProjectWhatsAppSendResultDto,
  ProjectWhatsAppThreadDto,
} from "./whatsapp-types";

// The browser's side of a project's WhatsApp group routes. Each call unwraps
// the { success, data } envelope and lets the server's sentence through — the
// office needs "Meta only offers groups to Official Business Accounts", not
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

export function requestProjectWhatsAppGroup(
  projectId: string,
): Promise<ProjectWhatsAppRequestResultDto> {
  return unwrap<ProjectWhatsAppRequestResultDto>(
    base(projectId),
    { method: "POST" },
    "The WhatsApp group could not be requested.",
  );
}

export function fetchLinkableWhatsAppGroups(
  projectId: string,
  signal?: AbortSignal,
): Promise<{ groups: LinkableWhatsAppGroupDto[] }> {
  return unwrap<{ groups: LinkableWhatsAppGroupDto[] }>(
    `${base(projectId)}/link`,
    { cache: "no-store", method: "GET", signal },
    "Could not list the business's WhatsApp groups.",
  );
}

export function linkProjectWhatsAppGroup(
  projectId: string,
  providerGroupId: string,
): Promise<{ group: ProjectWhatsAppGroupDto; filedMessages: number }> {
  return unwrap(
    `${base(projectId)}/link`,
    {
      body: JSON.stringify({ providerGroupId }),
      headers: JSON_HEADERS,
      method: "POST",
    },
    "The WhatsApp group could not be linked.",
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
