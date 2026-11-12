import { randomBytes } from "node:crypto";

import { CallRecordingStatus } from "@prisma/client";

import { canAccessLead } from "../../access/leads";
import type { DomainDb } from "../../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainSideEffectError,
  DomainTransitionError,
} from "../../errors";
import type { BlobPutPort } from "../../ports/blob";
import {
  isCommsError,
  type CommsProviderName,
  type RecordingPort,
} from "../../ports/comms";
import { isInternalPrincipal, type DomainPrincipal } from "../../principal";
import { providerName } from "../shared";

// Copying a call recording off the carrier and into Royal's own storage.
//
// Recordings are personal information sent overseas (Privacy Act, APP 8), so
// the rule is one copy, ours: download by id (never from a URL a callback
// supplied — that is an SSRF hole), store it under an unguessable path, then
// delete the carrier's copy. A failed delete is retried by the sweep; a
// failed download is retried a few times and then left FAILED for a person.

export const MAX_RECORDING_ATTEMPTS = 5;
/** A two-hour dual-channel MP3 is well under this. */
export const MAX_RECORDING_BYTES = 200 * 1024 * 1024;

export type StoreRecordingOutcome =
  | "stored"
  | "already_stored"
  | "provider_deleted"
  | "gave_up";

export async function storeCallRecording(
  principal: DomainPrincipal,
  input: { readonly recordingId: string },
  db: DomainDb,
  ports: {
    readonly recordingsFor: (
      provider: CommsProviderName,
    ) => RecordingPort | null;
    readonly put: BlobPutPort;
  },
): Promise<StoreRecordingOutcome> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Recordings are copied by the recording workflow only.",
    );
  }
  const recording = await db.callRecording.findUnique({
    select: {
      attempts: true,
      blobPathname: true,
      callId: true,
      id: true,
      provider: true,
      providerDeletedAt: true,
      providerRecordingId: true,
      status: true,
    },
    where: { id: input.recordingId },
  });
  if (!recording) throw new DomainNotFoundError("Recording not found");
  const provider = providerName(recording.provider);
  const port = ports.recordingsFor(provider);
  if (!port) {
    throw new DomainSideEffectError(
      `Recordings on ${provider} can't be fetched: it isn't configured here.`,
      "recordings",
      false,
    );
  }

  if (recording.status === CallRecordingStatus.STORED) {
    if (recording.providerDeletedAt) return "already_stored";
    await deleteProviderCopy(
      db,
      recording.id,
      recording.providerRecordingId,
      port,
    );
    return "provider_deleted";
  }
  if (recording.status === CallRecordingStatus.FAILED) return "gave_up";

  const attempts = recording.attempts + 1;
  await db.callRecording.update({
    data: { attempts },
    where: { id: recording.id },
  });

  let download;
  try {
    download = await port.fetchRecording(recording.providerRecordingId, {
      maxBytes: MAX_RECORDING_BYTES,
    });
  } catch (error) {
    const retryable =
      attempts < MAX_RECORDING_ATTEMPTS
      && !(
        isCommsError(error)
        && (error.kind === "rejected" || error.kind === "config")
      );
    const reason = isCommsError(error)
      ? error.message
      : "The recording could not be downloaded.";
    await db.callRecording.update({
      data: retryable
        ? { failureReason: reason }
        : { failureReason: reason, status: CallRecordingStatus.FAILED },
      where: { id: recording.id },
    });
    throw new DomainSideEffectError(reason, "recordings", retryable, {
      cause: error,
    });
  }

  // Reuse the path on a retry so a replayed step overwrites, never orphans.
  const pathname =
    recording.blobPathname
    ?? `call-recordings/${recording.callId}/${randomBytes(16).toString("hex")}.${extensionFor(download.mimeType)}`;
  const stored = await ports.put({
    allowOverwrite: true,
    body: download.bytes,
    contentType: download.mimeType,
    pathname,
  });
  await db.callRecording.update({
    data: {
      blobPathname: pathname,
      blobUrl: stored.url,
      byteSize: download.bytes.byteLength,
      failureReason: null,
      mimeType: download.mimeType,
      status: CallRecordingStatus.STORED,
      storedAt: new Date(),
    },
    where: { id: recording.id },
  });
  await deleteProviderCopy(
    db,
    recording.id,
    recording.providerRecordingId,
    port,
  );
  return "stored";
}

function extensionFor(mimeType: string): string {
  return /wav/i.test(mimeType) ? "wav" : "mp3";
}

async function deleteProviderCopy(
  db: DomainDb,
  recordingId: string,
  providerRecordingId: string,
  port: RecordingPort,
): Promise<void> {
  try {
    await port.deleteRecording(providerRecordingId);
    await db.callRecording.update({
      data: { providerDeletedAt: new Date() },
      where: { id: recordingId },
    });
  } catch {
    // Our copy is safe. The sweep tries the delete again; it is not a reason
    // to fail the step and re-download.
  }
}

/** Recordings the daily sweep should (re)start: pending, or stored but still on the carrier. */
export async function recordingsNeedingWork(db: DomainDb): Promise<string[]> {
  const rows = await db.callRecording.findMany({
    select: { id: true },
    take: 100,
    where: {
      OR: [
        { status: CallRecordingStatus.PENDING },
        { providerDeletedAt: null, status: CallRecordingStatus.STORED },
      ],
    },
  });
  return rows.map((row) => row.id);
}

/** Put a FAILED recording back in the queue, for the retry button. */
export async function retryCallRecording(
  principal: DomainPrincipal,
  input: { readonly recordingId: string },
  db: DomainDb,
): Promise<void> {
  if (!isInternalPrincipal(principal) || principal.kind !== "user") {
    throw new DomainAuthorizationError(
      "Retrying a recording requires a member of staff.",
    );
  }
  const recording = await db.callRecording.findUnique({
    select: { id: true, status: true },
    where: { id: input.recordingId },
  });
  if (!recording) throw new DomainNotFoundError("Recording not found");
  if (recording.status !== CallRecordingStatus.FAILED) {
    throw new DomainTransitionError("Only a failed recording can be retried.");
  }
  await db.callRecording.update({
    data: {
      attempts: 0,
      failureReason: null,
      status: CallRecordingStatus.PENDING,
    },
    where: { id: recording.id },
  });
}

/** The stored copy's location, for a staff member allowed to see the call. */
export async function recordingLocation(
  principal: DomainPrincipal,
  input: { readonly recordingId: string },
  db: DomainDb,
): Promise<{ url: string; mimeType: string | null }> {
  if (!isInternalPrincipal(principal) || principal.kind !== "user") {
    throw new DomainAuthorizationError("Recordings are for members of staff.");
  }
  const recording = await db.callRecording.findUnique({
    select: {
      blobUrl: true,
      call: { select: { lead: { select: { assignedId: true, id: true } } } },
      mimeType: true,
      status: true,
    },
    where: { id: input.recordingId },
  });
  if (!recording) throw new DomainNotFoundError("Recording not found");
  if (recording.call.lead && !canAccessLead(principal, recording.call.lead)) {
    throw new DomainNotFoundError("Recording not found");
  }
  if (recording.status !== CallRecordingStatus.STORED || !recording.blobUrl) {
    throw new DomainTransitionError("This recording hasn't been stored yet.");
  }
  return { mimeType: recording.mimeType, url: recording.blobUrl };
}
