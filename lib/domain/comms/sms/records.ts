import type {
  CommsDirection,
  Prisma,
  SmsReviewStatus,
  SmsStatus,
  SmsUnmatchedReason,
} from "@prisma/client";

import type { CommsProviderName } from "../../ports/comms";
import { providerName } from "../shared";

// The one shape an SMS leaves the domain in. Screens and routes shape it
// further; nothing outside reads the row directly.

export const SMS_MESSAGE_SELECT = {
  author: { select: { name: true } },
  body: true,
  businessNumber: true,
  customerNumber: true,
  deliveredAt: true,
  direction: true,
  failedAt: true,
  id: true,
  leadId: true,
  mediaCount: true,
  needsReconciliation: true,
  occurredAt: true,
  provider: true,
  providerErrorCode: true,
  providerErrorTitle: true,
  providerMessageId: true,
  readAt: true,
  reviewStatus: true,
  status: true,
  statusAt: true,
  unmatchedReason: true,
  candidateLeadIds: true,
} satisfies Prisma.SmsMessageSelect;

export type SmsMessageRow = Prisma.SmsMessageGetPayload<{
  select: typeof SMS_MESSAGE_SELECT;
}>;

export type SmsMessageRecord = {
  readonly id: string;
  readonly leadId: number | null;
  readonly direction: CommsDirection;
  readonly provider: CommsProviderName;
  readonly businessNumber: string;
  readonly customerNumber: string;
  readonly body: string;
  readonly mediaCount: number;
  readonly status: SmsStatus;
  readonly statusAt: Date;
  readonly occurredAt: Date;
  readonly deliveredAt: Date | null;
  readonly failedAt: Date | null;
  readonly readAt: Date | null;
  readonly needsReconciliation: boolean;
  readonly providerErrorCode: string | null;
  readonly providerErrorTitle: string | null;
  readonly authorName: string | null;
  readonly unmatchedReason: SmsUnmatchedReason | null;
  readonly reviewStatus: SmsReviewStatus | null;
  readonly candidateLeadIds: readonly number[];
};

export function toSmsMessageRecord(row: SmsMessageRow): SmsMessageRecord {
  return {
    authorName: row.author?.name ?? null,
    body: row.body,
    businessNumber: row.businessNumber,
    candidateLeadIds: row.candidateLeadIds,
    customerNumber: row.customerNumber,
    deliveredAt: row.deliveredAt,
    direction: row.direction,
    failedAt: row.failedAt,
    id: row.id,
    leadId: row.leadId,
    mediaCount: row.mediaCount,
    needsReconciliation: row.needsReconciliation,
    occurredAt: row.occurredAt,
    provider: providerName(row.provider),
    providerErrorCode: row.providerErrorCode,
    providerErrorTitle: row.providerErrorTitle,
    readAt: row.readAt,
    reviewStatus: row.reviewStatus,
    status: row.status,
    statusAt: row.statusAt,
    unmatchedReason: row.unmatchedReason,
  };
}
