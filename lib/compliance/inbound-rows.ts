import {
  CertifierEmailDirection,
  type GraphMailbox,
  type Prisma,
} from "@prisma/client";

import { isOwnMailbox } from "@/lib/graph/mailbox";
import { parseEmailDate, type EmailThread } from "@/utils/email-parser";
import { normalizeEmailAddress } from "@/utils/formatters";
import { generateEmailChecksum } from "@/utils/generator";

/**
 * The rows an inbound certifier message becomes: the message and each earlier
 * message it quotes.
 *
 * A message sent from one of our own mailboxes is never stored here. The body
 * of a certifier's reply quotes our earlier mail, and `sendCertifierReply`
 * already wrote that send as an OUTBOUND row. The quoted copy is rendered
 * differently (plain text against the HTML we sent, a missing To), so its
 * checksum differs and the unique index kept it as a second, INBOUND row —
 * "received from ourselves". In production 28 of 30 inbound rows from our own
 * domain were these, and they inflated the thread with messages nobody
 * received (#587).
 *
 * Skipped, not re-filed as OUTBOUND: the send gates read the OUTBOUND rows
 * ("has the certifier been sent this?"), so nothing parsed out of quoted text
 * may ever create one. A send made outside the app is `sent-mail-sync`'s to
 * record.
 */
export async function buildInboundCertifierRows(input: {
  attachments: { name: string; url: string }[];
  engagementId: string;
  fallback: {
    from: string;
    sentAt: Date;
    subject: string;
    to: string;
  };
  graphMailbox: GraphMailbox;
  threads: readonly EmailThread[];
}): Promise<Prisma.CertifierEmailCreateManyInput[]> {
  const { fallback } = input;
  const rows: Prisma.CertifierEmailCreateManyInput[] = [];

  // A reply that is only an attachment has nothing above the quoted history,
  // so the parser hands back our own earlier message as the newest one. The
  // message that arrived is still the envelope's: keep a row for it, or the
  // document is archived with no email in the thread to carry it.
  const newest = input.threads[0];
  const threads =
    input.attachments.length > 0
    && newest
    && isOwnMailbox(normalizeEmailAddress(newest.from))
    && !isOwnMailbox(normalizeEmailAddress(fallback.from))
      ? [
          {
            body: "",
            from: fallback.from,
            sentAt: "",
            subject: fallback.subject,
            to: fallback.to,
          },
          ...input.threads,
        ]
      : input.threads;

  for (const [index, thread] of threads.entries()) {
    const from = normalizeEmailAddress(thread.from || fallback.from);
    if (isOwnMailbox(from)) {
      continue;
    }

    const subject = thread.subject.trim() || fallback.subject;
    const to = normalizeEmailAddress(thread.to || fallback.to);
    const checksum = await generateEmailChecksum(
      subject,
      thread.body,
      from,
      to,
    );

    rows.push({
      engagementId: input.engagementId,
      emailFrom: from,
      emailTo: to,
      subject,
      body: thread.body,
      checksum,
      // getAllEmailThreads returns newest first, so only threads[0] is the
      // message that just arrived; what is quoted behind it is whatever the
      // other side said before. Ours are skipped above.
      direction: CertifierEmailDirection.INBOUND,
      graphMailbox: input.graphMailbox,
      attachments: (index === 0
        ? input.attachments
        : []) as unknown as Prisma.InputJsonValue,
      sentAt: parseEmailDate(thread.sentAt) ?? fallback.sentAt,
    });
  }

  return rows;
}
