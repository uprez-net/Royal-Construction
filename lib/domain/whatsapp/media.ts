import { WhatsAppMediaStatus, WhatsAppMediaType } from "@prisma/client";

import type { DomainDb } from "../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainSideEffectError,
  DomainTransitionError,
} from "../errors";
import type { BlobPutPort } from "../ports/blob";
import {
  isWhatsAppMediaError,
  type WhatsAppMediaPort,
} from "../ports/whatsapp";
import { authorizeProjectRecording } from "../access/projects";
import {
  isInternalPrincipal,
  isOfficePrincipal,
  type DomainPrincipal,
} from "../principal";

// Files customers and owners send on WhatsApp: photos, videos, voice notes,
// documents and stickers. Shared by a lead's 1:1 conversation, a project's
// group and the unmatched review queue.
//
// Two halves, deliberately apart:
//
//   1. The webhook records WHAT arrived — Meta's media id, the type, caption
//      and file name — in the same transaction as the message, so the message
//      is never acknowledged to Meta without its attachment being on record.
//   2. A workflow copies the file into Blob storage afterwards
//      (lib/workflow/whatsapp-media.ts → storeWhatsAppMedia). Downloading can
//      take seconds and fail on its own; the webhook must not wait for it.
//
// The copy matters because Meta's download address lives five minutes and
// the media id thirty days. A failed copy is never silent: the message still
// shows, with the reason, and a person can retry it.

/** Automatic attempts before a transient failure is reported as FAILED. */
export const MAX_MEDIA_ATTEMPTS = 5;

/** What the webhook says about one attached file. */
export type InboundWhatsAppMedia = {
  readonly providerMediaId: string;
  readonly type: WhatsAppMediaType;
  readonly mimeType: string | null;
  readonly sha256: string | null;
  readonly fileName: string | null;
  readonly caption: string | null;
  readonly voice: boolean;
};

const META_TYPES: Record<string, WhatsAppMediaType> = {
  audio: WhatsAppMediaType.AUDIO,
  document: WhatsAppMediaType.DOCUMENT,
  image: WhatsAppMediaType.IMAGE,
  sticker: WhatsAppMediaType.STICKER,
  video: WhatsAppMediaType.VIDEO,
};

/** Meta's message `type` → our media type, or null for a non-media type. */
export function whatsappMediaTypeOf(
  metaType: string,
): WhatsAppMediaType | null {
  return META_TYPES[metaType] ?? null;
}

/**
 * The body stored for a media message: its caption, or a short label when it
 * has none. Plain text, so Eve, history and search read it like any message.
 */
export function whatsappMediaBody(media: InboundWhatsAppMedia): string {
  const caption = media.caption?.trim();
  if (caption) return caption;
  switch (media.type) {
    case WhatsAppMediaType.IMAGE:
      return "Photo";
    case WhatsAppMediaType.VIDEO:
      return "Video";
    case WhatsAppMediaType.AUDIO:
      return media.voice ? "Voice message" : "Audio";
    case WhatsAppMediaType.STICKER:
      return "Sticker";
    case WhatsAppMediaType.DOCUMENT:
      return media.fileName?.trim()
        ? `Document · ${media.fileName.trim()}`
        : "Document";
  }
}

/** The columns a media row is created with, for whichever message owns it. */
export function whatsappMediaCreateData(media: InboundWhatsAppMedia) {
  return {
    caption: media.caption?.trim() || null,
    fileName: media.fileName?.trim() || null,
    mimeType: media.mimeType,
    providerMediaId: media.providerMediaId,
    sha256: media.sha256,
    status: WhatsAppMediaStatus.PENDING,
    type: media.type,
    voice: media.voice,
  };
}

/** The media as every thread shows it. */
export const WHATSAPP_MEDIA_SELECT = {
  blobUrl: true,
  byteSize: true,
  caption: true,
  failureReason: true,
  fileName: true,
  id: true,
  mimeType: true,
  status: true,
  type: true,
  voice: true,
} as const;

export type WhatsAppMediaRecord = {
  readonly id: string;
  readonly type: WhatsAppMediaType;
  readonly status: WhatsAppMediaStatus;
  readonly mimeType: string | null;
  readonly fileName: string | null;
  readonly caption: string | null;
  readonly voice: boolean;
  readonly byteSize: number | null;
  /** Set once STORED. Public Blob address with an unguessable path. */
  readonly url: string | null;
  /** Why it isn't stored, when it isn't. Safe to show an operator. */
  readonly failureReason: string | null;
};

export function toWhatsAppMediaRecord(
  row: {
    id: string;
    type: WhatsAppMediaType;
    status: WhatsAppMediaStatus;
    mimeType: string | null;
    fileName: string | null;
    caption: string | null;
    voice: boolean;
    byteSize: number | null;
    blobUrl: string | null;
    failureReason: string | null;
  } | null,
): WhatsAppMediaRecord | null {
  if (!row) return null;
  return {
    byteSize: row.byteSize,
    caption: row.caption,
    failureReason: row.failureReason,
    fileName: row.fileName,
    id: row.id,
    mimeType: row.mimeType,
    status: row.status,
    type: row.type,
    url: row.status === WhatsAppMediaStatus.STORED ? row.blobUrl : null,
    voice: row.voice,
  };
}

const EXTENSIONS: Record<string, string> = {
  "application/msword": ".doc",
  "application/pdf": ".pdf",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    ".docx",
  "audio/aac": ".aac",
  "audio/amr": ".amr",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "text/plain": ".txt",
  "video/3gpp": ".3gp",
  "video/mp4": ".mp4",
};

/** A file extension for the stored copy, so a browser opens it sensibly. */
export function whatsappMediaExtension(
  mimeType: string | null,
  fileName: string | null,
): string {
  const base = mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (EXTENSIONS[base]) return EXTENSIONS[base];
  const fromName = fileName?.match(/\.([A-Za-z0-9]{1,8})$/)?.[1];
  return fromName ? `.${fromName.toLowerCase()}` : "";
}

export type StoreWhatsAppMediaOutcome =
  | { readonly outcome: "stored"; readonly url: string }
  | { readonly outcome: "already_stored" }
  /** Retrying cannot help, or the attempts ran out. Recorded on the row. */
  | { readonly outcome: "failed"; readonly reason: string }
  /** Someone marked it FAILED and nobody has asked for a retry. */
  | { readonly outcome: "not_pending" };

/**
 * Copy one recorded file into Blob storage.
 *
 * System principal only: the workflow and the sweep cron call this, never a
 * person directly — a person asks for a retry, and the workflow does the copy.
 *
 * A transient failure throws `DomainSideEffectError(retryable: true)` so the
 * workflow step is retried; after MAX_MEDIA_ATTEMPTS, or on a permanent
 * failure, the row is marked FAILED with the reason and nothing is thrown.
 */
export async function storeWhatsAppMedia(
  principal: DomainPrincipal,
  input: { readonly mediaId: string; readonly maxBytes: number },
  db: DomainDb,
  ports: {
    readonly download: WhatsAppMediaPort | null;
    readonly put: BlobPutPort;
  },
  now: Date = new Date(),
): Promise<StoreWhatsAppMediaOutcome> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Only the WhatsApp media workflow may store a file.",
    );
  }
  const row = await db.whatsAppMedia.findUnique({
    select: {
      attempts: true,
      fileName: true,
      id: true,
      mimeType: true,
      providerMediaId: true,
      status: true,
    },
    where: { id: input.mediaId },
  });
  if (!row)
    throw new DomainNotFoundError("That WhatsApp file is not on record.");
  if (row.status === WhatsAppMediaStatus.STORED) {
    return { outcome: "already_stored" };
  }
  if (row.status !== WhatsAppMediaStatus.PENDING) {
    return { outcome: "not_pending" };
  }
  if (!ports.download) {
    // Not configured in this runtime. Left PENDING for the sweep, which runs
    // where the token is; retrying the step here would only fail again.
    throw new DomainSideEffectError(
      "WhatsApp media can't be downloaded from this runtime (no access token).",
      "whatsapp",
      false,
    );
  }

  const attempt = row.attempts + 1;
  await db.whatsAppMedia.update({
    data: { attempts: attempt },
    where: { id: row.id },
  });

  const fail = async (reason: string) => {
    await db.whatsAppMedia.updateMany({
      data: { failureReason: reason, status: WhatsAppMediaStatus.FAILED },
      where: { id: row.id, status: WhatsAppMediaStatus.PENDING },
    });
    return { outcome: "failed" as const, reason };
  };

  let download;
  try {
    download = await ports.download(row.providerMediaId, {
      maxBytes: input.maxBytes,
    });
  } catch (error) {
    const mediaError = isWhatsAppMediaError(error) ? error : null;
    const reason =
      mediaError?.message ?? "The file couldn't be downloaded from WhatsApp.";
    if (mediaError?.permanent || attempt >= MAX_MEDIA_ATTEMPTS) {
      return fail(reason);
    }
    await db.whatsAppMedia.update({
      data: { failureReason: reason },
      where: { id: row.id },
    });
    throw new DomainSideEffectError(reason, "whatsapp", true, { cause: error });
  }

  const mimeType = download.mimeType ?? row.mimeType;
  const month = now.toISOString().slice(0, 7).replace("-", "/");
  const pathname = `whatsapp-media/${month}/${row.id}${whatsappMediaExtension(mimeType, row.fileName)}`;
  let stored: { url: string };
  try {
    stored = await ports.put({
      allowOverwrite: true,
      body: download.bytes,
      contentType: mimeType ?? "application/octet-stream",
      pathname,
    });
  } catch (error) {
    const reason = "The file couldn't be saved to storage.";
    if (attempt >= MAX_MEDIA_ATTEMPTS) return fail(reason);
    await db.whatsAppMedia.update({
      data: { failureReason: reason },
      where: { id: row.id },
    });
    throw new DomainSideEffectError(reason, "blob", true, { cause: error });
  }

  await db.whatsAppMedia.updateMany({
    data: {
      blobPathname: pathname,
      blobUrl: stored.url,
      byteSize: download.byteSize,
      failureReason: null,
      mimeType,
      status: WhatsAppMediaStatus.STORED,
      storedAt: now,
    },
    where: { id: row.id, status: WhatsAppMediaStatus.PENDING },
  });
  return { outcome: "stored", url: stored.url };
}

/**
 * Put a FAILED file back in the queue, at a person's request.
 *
 * Who may ask depends on whose thread the file came from. A project group's
 * file is site work, so anyone who may record on that project may ask (a site
 * manager on every job). A prospect's file, and a file from an unmatched
 * message, are the office's: a site manager cannot open either. The check runs
 * before the status is read, so a refused caller learns nothing about the file.
 * The caller then starts the workflow.
 */
export async function retryWhatsAppMedia(
  principal: DomainPrincipal,
  input: { readonly mediaId: string },
  db: DomainDb,
): Promise<{ readonly mediaId: string }> {
  if (!isInternalPrincipal(principal) || principal.kind !== "user") {
    throw new DomainAuthorizationError(
      "Retrying a WhatsApp file requires a signed-in member of staff.",
    );
  }
  const row = await db.whatsAppMedia.findUnique({
    select: {
      id: true,
      status: true,
      projectMessage: { select: { projectId: true } },
    },
    where: { id: input.mediaId },
  });
  if (!row)
    throw new DomainNotFoundError("That WhatsApp file is not on record.");
  if (row.projectMessage) {
    await authorizeProjectRecording(
      principal,
      row.projectMessage.projectId,
      db,
    );
  } else if (!isOfficePrincipal(principal)) {
    throw new DomainAuthorizationError(
      "This WhatsApp file belongs to a client's conversation, which the office handles.",
    );
  }
  if (row.status === WhatsAppMediaStatus.STORED) {
    throw new DomainTransitionError(
      "This file is already saved.",
      row.status,
      WhatsAppMediaStatus.PENDING,
    );
  }
  await db.whatsAppMedia.update({
    data: {
      attempts: 0,
      failureReason: null,
      status: WhatsAppMediaStatus.PENDING,
    },
    where: { id: row.id },
  });
  return { mediaId: row.id };
}

/** Files still waiting to be copied, oldest first, for the sweep. */
export async function findPendingWhatsAppMedia(
  db: DomainDb,
  options: { readonly olderThan: Date; readonly limit: number },
): Promise<string[]> {
  const rows = await db.whatsAppMedia.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true },
    take: options.limit,
    where: {
      createdAt: { lt: options.olderThan },
      status: WhatsAppMediaStatus.PENDING,
    },
  });
  return rows.map((row) => row.id);
}
