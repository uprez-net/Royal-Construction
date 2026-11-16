import type {
  CallAnsweredBy,
  CallFlowStep,
  CallRecordingKind,
  CallRecordingStatus,
  CallStaffTarget,
  CallStatus,
  CallTranscriptStatus,
  CommsDirection,
  Prisma,
  RecordingConsent,
} from "@prisma/client";

import type { CommsProviderName } from "../../ports/comms";
import { providerName } from "../shared";
import { isUnreadCall } from "../unread";

export const CALL_SELECT = {
  agentTranscript: true,
  answeredAt: true,
  answeredBy: true,
  businessNumber: true,
  candidateLeadIds: true,
  connectedAt: true,
  customerNumber: true,
  direction: true,
  durationSeconds: true,
  endedAt: true,
  flowStep: true,
  hangupCause: true,
  id: true,
  lead: { select: { id: true, name: true } },
  leadId: true,
  needsReconciliation: true,
  provider: true,
  providerErrorTitle: true,
  recordingConsent: true,
  recordings: {
    orderBy: { createdAt: "asc" },
    select: {
      blobUrl: true,
      durationSeconds: true,
      failureReason: true,
      id: true,
      kind: true,
      status: true,
      transcript: true,
      transcriptStatus: true,
    },
  },
  seenAt: true,
  staffPhoneLabel: true,
  staffTarget: true,
  staffUser: { select: { name: true } },
  startedAt: true,
  status: true,
} satisfies Prisma.CallSelect;

export type CallRow = Prisma.CallGetPayload<{ select: typeof CALL_SELECT }>;

export type CallRecordingRecord = {
  readonly id: string;
  readonly kind: CallRecordingKind;
  readonly status: CallRecordingStatus;
  readonly durationSeconds: number | null;
  /** True once a copy is stored; the URL itself is served by a staff route. */
  readonly available: boolean;
  readonly failureReason: string | null;
  /** Speech-to-text of the recording, once it has been transcribed. */
  readonly transcript: string | null;
  readonly transcriptStatus: CallTranscriptStatus;
};

export type CallRecord = {
  readonly id: string;
  readonly provider: CommsProviderName;
  readonly direction: CommsDirection;
  readonly leadId: number | null;
  readonly leadName: string | null;
  readonly candidateLeadIds: readonly number[];
  readonly businessNumber: string;
  readonly customerNumber: string;
  readonly status: CallStatus;
  readonly flowStep: CallFlowStep;
  readonly staffTarget: CallStaffTarget | null;
  /** Outbound to a phone: the nickname of the phone it rang. */
  readonly staffPhoneLabel: string | null;
  readonly staffName: string | null;
  readonly answeredBy: CallAnsweredBy | null;
  readonly recordingConsent: RecordingConsent;
  readonly startedAt: Date;
  readonly answeredAt: Date | null;
  readonly connectedAt: Date | null;
  readonly endedAt: Date | null;
  readonly durationSeconds: number | null;
  readonly hangupCause: string | null;
  readonly needsReconciliation: boolean;
  readonly problem: string | null;
  readonly recordings: readonly CallRecordingRecord[];
  /** What the caller and Mili said, one "Speaker: text" line per turn. */
  readonly agentTranscript: string | null;
  readonly seenAt: Date | null;
  /** Mili or the voicemail took it and nobody has opened it (../unread). */
  readonly unread: boolean;
};

export function toCallRecord(row: CallRow): CallRecord {
  return {
    agentTranscript: row.agentTranscript,
    answeredAt: row.answeredAt,
    answeredBy: row.answeredBy,
    businessNumber: row.businessNumber,
    candidateLeadIds: row.candidateLeadIds,
    connectedAt: row.connectedAt,
    customerNumber: row.customerNumber,
    direction: row.direction,
    durationSeconds: row.durationSeconds,
    endedAt: row.endedAt,
    flowStep: row.flowStep,
    hangupCause: row.hangupCause,
    id: row.id,
    leadId: row.leadId,
    leadName: row.lead?.name ?? null,
    needsReconciliation: row.needsReconciliation,
    problem: row.providerErrorTitle,
    provider: providerName(row.provider),
    recordingConsent: row.recordingConsent,
    recordings: row.recordings.map((recording) => ({
      available: recording.status === "STORED" && recording.blobUrl !== null,
      durationSeconds: recording.durationSeconds,
      failureReason: recording.failureReason,
      id: recording.id,
      kind: recording.kind,
      status: recording.status,
      transcript: recording.transcript,
      transcriptStatus: recording.transcriptStatus,
    })),
    seenAt: row.seenAt,
    staffName: row.staffUser?.name ?? null,
    staffPhoneLabel: row.staffPhoneLabel,
    staffTarget: row.staffTarget,
    startedAt: row.startedAt,
    status: row.status,
    unread: isUnreadCall(row),
  };
}
