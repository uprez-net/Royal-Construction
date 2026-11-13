import { reportWorkflowError } from "@/lib/workflow/report-failure";
import { createHash } from "node:crypto";

import { GraphMailbox } from "@prisma/client";
import { put } from "@vercel/blob";

import { isSignatureNoise } from "@/lib/domain/email/attachment-noise";
import { systemPrincipal } from "@/lib/domain/principal";
import {
  recordSentMessage,
  type SentMessageOutcome,
  type StoredAttachment,
} from "@/lib/domain/email/sent-mail-sync";
import {
  createGraphContext,
  type GraphContext,
  type GraphSentMessage,
} from "@/lib/graph/client";
import { getGraphConfig } from "@/lib/graph/config";
import { resolveMediaType } from "@/lib/graph/lead-attachments";
import { withGraphRetry } from "@/lib/graph/retry";
import prisma from "@/lib/prisma";
import { buildBlobPath } from "@/utils/formatters";

/**
 * Copies what was sent from Outlook onto the trails in the app.
 *
 * Started once a day by app/api/cron/sync-sent-mail. Reads each mailbox's Sent
 * Items for the window it is given and files every message the app did not
 * send itself on the lead, tradie or compliance thread it went to — the rule
 * is lib/domain/email/sent-mail-sync.ts; this file is only Graph, Blob and the
 * log.
 *
 * A workflow rather than a loop in the cron, because a message to a surveyor
 * can carry a plan set: each message is its own step, retried on its own, and
 * a run that dies halfway resumes at the message it reached instead of
 * starting the mailbox again.
 */

const LOG = "[sent-mail-sync]";
const PRINCIPAL = systemPrincipal("cron:sent-mail-sync");

/** The mailboxes the app sends from, in the order they are read. */
const MAILBOXES = ["business", "admin"] as const;
type MailboxName = (typeof MAILBOXES)[number];

// Well over anything Exchange will send by default (35 MB encoded), so in
// practice nothing real is skipped; it bounds what one step holds in memory.
const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;

const FILE_ATTACHMENT_ODATA_TYPE = "#microsoft.graph.fileAttachment";

export interface SentMailSyncInput {
  /** ISO time; Sent Items from here on are read. */
  since: string;
}

type MailboxListing =
  | { ok: true; address: string; messages: GraphSentMessage[] }
  | { ok: false; error: string };

type MessageResult =
  | { ok: true; outcome: SentMessageOutcome }
  | { ok: false; error: string };

export interface MailboxSummary {
  mailbox: MailboxName;
  listed: number;
  sentByApp: number;
  unmatched: number;
  /** Rows written: one message to two people is two. */
  recorded: number;
  alreadyRecorded: number;
  attachments: number;
  failed: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/**
 * Rebuilt inside each step: it holds a credential and a token cache, neither
 * of which belongs in a workflow's event log.
 */
async function graphClient(mailbox: MailboxName) {
  const config = getGraphConfig(mailbox);
  return { client: await createGraphContext(config), config };
}

/**
 * The window's Sent Items for one mailbox.
 *
 * A mailbox that is not configured answers rather than throws: there is
 * nothing a retry can fix, and the other mailbox still has to be read. A Graph
 * failure throws, so the runtime retries the step.
 */
async function listSentMail(
  mailbox: MailboxName,
  since: string,
): Promise<MailboxListing> {
  "use step";

  let context: Awaited<ReturnType<typeof graphClient>>;
  try {
    context = await graphClient(mailbox);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${LOG} ${mailbox}: mailbox not configured: ${message}`);
    return { ok: false, error: message };
  }

  const { client, config } = context;
  const messages = await withGraphRetry(`list ${mailbox} Sent Items`, () =>
    client.listSentMessages(new Date(since)),
  );
  console.log(
    `${LOG} ${mailbox}: ${messages.length} sent since ${since} `
      + `(${messages.filter((message) => message.sentByApp).length} by the app)`,
  );
  return { ok: true, address: config.senderUpn ?? "", messages };
}

/** A blob id from the message and the attachment, so a replay overwrites itself. */
function deterministicFileId(messageId: string, attachmentId: string): string {
  const digest = createHash("sha256")
    .update(`sent-mail:${messageId}:attachment:${attachmentId}`)
    .digest("hex");
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join("-");
}

/**
 * Copies a message's attachments under a project.
 *
 * Never throws for one file: the message is worth recording without it, and
 * every skip and failure is logged with the file's name so it can be found in
 * Outlook. Stored under projects/<id>/ like every other file on the job.
 */
async function storeAttachments(
  client: GraphContext,
  message: GraphSentMessage,
  projectId: string,
): Promise<StoredAttachment[]> {
  const listed = await withGraphRetry(`list attachments on ${message.id}`, () =>
    client.listMessageAttachments(message.id),
  );

  const stored: StoredAttachment[] = [];
  for (const file of listed) {
    if (file.odataType !== FILE_ATTACHMENT_ODATA_TYPE) {
      console.log(`${LOG}   skipped "${file.name}": not a file attachment`);
      continue;
    }
    // The same cut every inbound path makes: our own signature is on every
    // message we send, and storing it once per message is all this would do.
    if (isSignatureNoise(file)) continue;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      console.log(
        `${LOG}   skipped "${file.name}": ${(file.size / 1048576).toFixed(1)} MB is over the limit`,
      );
      continue;
    }

    try {
      const data = await withGraphRetry(`download ${file.name}`, () =>
        client.downloadMessageAttachment(message.id, file.id),
      );
      const blob = await put(
        buildBlobPath({
          fileId: deterministicFileId(message.id, file.id),
          fileName: file.name,
          projectId,
        }),
        data,
        {
          access: "public",
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: resolveMediaType(file.name, file.contentType),
        },
      );
      stored.push({ name: file.name, url: blob.url });
    } catch (error) {
      console.error(
        `${LOG}   failed to store "${file.name}" from ${message.id}; the email is recorded without it`,
        error,
      );
    }
  }
  return stored;
}

/** Files one message. Throws on a database or Graph failure, so it is retried. */
async function fileSentMessage(
  mailbox: MailboxName,
  address: string,
  message: GraphSentMessage,
): Promise<SentMessageOutcome> {
  "use step";

  const outcome = await recordSentMessage(
    PRINCIPAL,
    {
      graphMessageId: message.id,
      mailbox: mailbox === "admin" ? GraphMailbox.ADMIN : GraphMailbox.BUSINESS,
      from: address,
      subject: message.subject,
      body: message.body,
      recipients: message.recipients,
      sentAt: new Date(message.sentDateTime),
      sentByApp: message.sentByApp,
      hasAttachments: message.hasAttachments,
    },
    prisma,
    {
      storeAttachments: async (projectId) => {
        const { client } = await graphClient(mailbox);
        return storeAttachments(client, message, projectId);
      },
    },
  );

  const label = `${LOG} ${mailbox} ${message.id} "${message.subject}"`;
  if (outcome.status === "filed") {
    for (const { target, outcome: filed } of outcome.filings) {
      const where =
        target.kind === "compliance"
          ? `${target.outreachId ? `outreach ${target.outreachId}` : "certifier"} on engagement ${target.engagementId} (matched on ${target.matchedOn})`
          : target.kind === "tradie"
            ? `tradie ${target.tradieId}`
            : `lead ${target.leadId}`;
      console.log(`${label}: ${filed} on ${where}`);
    }
    if (outcome.attachments > 0) {
      console.log(`${label}: ${outcome.attachments} attachment(s) stored`);
    }
  } else if (outcome.status === "unmatched") {
    console.log(
      `${label}: not filed — none of ${message.recipients.length} recipient(s) is a lead, tradie or compliance party`,
    );
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

// The workflow body stays to steps and plain values: it runs in the workflow
// sandbox, which replays it, and has no business loading Prisma.
export const syncSentMail = async (
  input: SentMailSyncInput,
): Promise<MailboxSummary[]> => {
  "use workflow";
  try {
    return await runSyncSentMail(input);
  } catch (error) {
    await reportWorkflowError("syncSentMail", error);
    throw error;
  }
};

// The body, split out so the workflow function above can report a run that
// fails once its steps are out of retries. A plain function: it runs in the
// same sandbox and calls its steps exactly as before.
const runSyncSentMail = async (
  input: SentMailSyncInput,
): Promise<MailboxSummary[]> => {

  console.log(`${LOG} starting: Sent Items since ${input.since}`);
  const summaries: MailboxSummary[] = [];

  for (const mailbox of MAILBOXES) {
    const summary: MailboxSummary = {
      mailbox,
      listed: 0,
      sentByApp: 0,
      unmatched: 0,
      recorded: 0,
      alreadyRecorded: 0,
      attachments: 0,
      failed: 0,
    };
    summaries.push(summary);

    let listing: MailboxListing;
    try {
      listing = await listSentMail(mailbox, input.since);
    } catch (error) {
      listing = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (!listing.ok) {
      summary.error = listing.error;
      continue;
    }

    summary.listed = listing.messages.length;
    for (const message of listing.messages) {
      // The app's own mail is skipped here as well as in the rule, so a day of
      // automated sends does not cost a step each.
      if (message.sentByApp) {
        summary.sentByApp += 1;
        continue;
      }

      let result: MessageResult;
      try {
        result = {
          ok: true,
          outcome: await fileSentMessage(mailbox, listing.address, message),
        };
      } catch (error) {
        result = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }

      if (!result.ok) {
        summary.failed += 1;
        console.error(
          `${LOG} ${mailbox} ${message.id} "${message.subject}": failed after retries: ${result.error}`,
        );
        continue;
      }
      const { outcome } = result;
      if (outcome.status === "sent-by-app") summary.sentByApp += 1;
      if (outcome.status === "unmatched") summary.unmatched += 1;
      if (outcome.status === "filed") {
        for (const filing of outcome.filings) {
          if (filing.outcome === "recorded") summary.recorded += 1;
          else summary.alreadyRecorded += 1;
        }
        summary.attachments += outcome.attachments;
      }
    }
  }

  console.log(`${LOG} finished: ${JSON.stringify(summaries)}`);

  // A failed message or an unreadable mailbox fails the run, so it shows as
  // failed in the workflow dashboard instead of as a quiet success with a
  // trail short of an email. Everything that could be filed already was.
  const problems = summaries.filter(
    (summary) => summary.error || summary.failed > 0,
  );
  if (problems.length > 0) {
    throw new Error(
      `Sent-mail sync incomplete: ${problems
        .map((summary) =>
          summary.error
            ? `${summary.mailbox} not read (${summary.error})`
            : `${summary.mailbox}: ${summary.failed} message(s) not filed`,
        )
        .join("; ")}`,
    );
  }
  return summaries;
};
