import { createGraphContext, GraphMessage } from "@/lib/graph/client";
import { isLeadMessage } from "@/lib/graph/lead-subject";
import { getGraphConfig, type GraphMailbox } from "@/lib/graph/config";
import prisma from "@/lib/prisma";
import { extractTradieScheduleInfoFromMessage } from "@/lib/graph/tradie-schedule-info-extractor";
import { applyTradieScheduleUpdate } from "@/lib/data/tradie-schedule-updates";
import { getAllAdminUsersIds } from "@/lib/data/user";
import {
  AWAITING_TRADIE_REPLY,
  findTradieReplyReference,
  isReplyFromTradie,
  matchTradieReplyToSchedule,
  referencedReplyTargets,
  tradieReplyStatus,
  type TradieReplyReference,
} from "@/lib/domain/tradies/replies";
import { extractTradieRefToken } from "@/lib/domain/tradies/reply-reference";
import { recordInboundTradieEmail } from "@/lib/domain/tradies/emails";
import { triggerNotification } from "@/lib/notification/novu";
import { createNotification } from "@/types/notification";
import { saveLeadEmailTrail } from "@/lib/graph/save-lead-email-trail";
import { evaluateEmail } from "@/utils/spam-detector";
import { recordOfferReply } from "@/lib/domain/offers/replies";
import { systemPrincipal } from "@/lib/domain/principal";
import {
  extractCertifierRefToken,
  isPublicMailDomain,
  subjectMentionsSiteAddress,
} from "@/lib/graph/certifier-subject";
import { extractPartyRefToken } from "@/lib/graph/party-subject";
import {
  looksLikePlanningNotification,
  normaliseReference,
  planningReferencesIn,
} from "@/lib/graph/planning-portal";
import {
  extractOfferReplyToken,
  isMachineGenerated,
} from "@/lib/graph/offer-reply-classify";
import { normalizeEmailAddress } from "@/utils/formatters";
import {
  CertifierEmailDirection,
  CompliancePartyType,
  GraphMailbox as PrismaGraphMailbox,
  TradieScheduleStatus,
} from "@prisma/client";
import { processInboundCertifierEmail } from "@/lib/workflow/certifier-email";
import { processInboundPartyEmail } from "@/lib/workflow/party-email";
import { isRetryableGraphError, withGraphRetry } from "@/lib/graph/retry";
import { checkLeadPresentWithEmailPhone } from "@/lib/leads/existing-lead";
import { processInboundLead } from "@/lib/workflow/lead-extraction";
import { storeOfferReplyAttachments } from "@/lib/workflow/offer-reply-attachments";
import { processTradieInvoiceEmail } from "@/lib/workflow/tradie-invoice-email";
import { start } from "workflow/api";
import { after } from "next/server";
import { isOwnMailbox, isSenderCopy } from "@/lib/graph/mailbox";
import { graphResourceBelongsToMailbox } from "@/lib/graph/resource";

// export const runtime = 'nodejs';

// Extraction already ran a model round-trip inline; downloading a set of plans
// and sending them up with it pushes the slow case well past the default
// serverless budget.
export const maxDuration = 300;

interface GraphNotification {
  changeType?: string;
  resource?: string;
  resourceData?: {
    id?: string;
    "@odata.type"?: string;
  };
  clientState?: string;
  tenantId?: string;
  subscriptionId?: string;
}

interface GraphNotificationBody {
  value?: GraphNotification[];
  lifecycleEvent?: string;
  [key: string]: unknown;
}

function textResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain",
    },
  });
}

async function isMessageAlreadyProcessed(messageId: string): Promise<boolean> {
  if (!messageId) return false;
  try {
    const existingLead = await prisma.lead.findUnique({
      where: { MicrosoftmessageId: messageId },
    });
    return existingLead !== null;
  } catch (error) {
    console.error(
      `Error checking if messageId ${messageId} is processed:`,
      error,
    );
    return false;
  }
}

/**
 * A tradie's email that carries attachments may be an invoice. Reading them
 * is the slow half, so it is a workflow of its own; it queues any invoice for
 * the office to confirm and counts nothing itself. Never throws: a failure to
 * enqueue is logged, and the rest of the batch still runs.
 */
async function startTradieInvoiceEmail(input: {
  message: { id: string; subject?: string | null; receivedDateTime?: string };
  mailbox: "business" | "admin";
  from: string;
  tradieId: string;
  content: string;
}) {
  try {
    const run = await start(processTradieInvoiceEmail, [
      {
        body: input.content,
        from: input.from,
        graphMessageId: input.message.id,
        mailbox: input.mailbox,
        receivedAt: input.message.receivedDateTime || new Date().toISOString(),
        subject: input.message.subject ?? "",
        tradieId: input.tradieId,
      },
    ]);
    console.log(
      `  Tradie ${input.tradieId}: invoice email workflow started for message ${input.message.id}: run ${run.runId}`,
    );
  } catch (error) {
    console.error(
      `  Tradie ${input.tradieId}: couldn't start the invoice email workflow`,
      error,
    );
  }
}

/**
 * Tell the admins a tradie's reply was not applied, instead of leaving it in a
 * log nobody reads. Never throws: the rest of the batch still has to run.
 */
async function notifyTradieReplyNeedsReview(
  tradie: { id: string; name: string },
  subject: string,
  reason: string,
) {
  console.log(`  Tradie reply needs review (${tradie.id}): ${reason}`);
  try {
    await triggerNotification(
      await getAllAdminUsersIds(),
      createNotification("tradieReplyNeedsReview", {
        reason,
        subject,
        tradieId: tradie.id,
        tradieName: tradie.name,
      }),
    );
  } catch (error) {
    console.error("Could not notify admins about a tradie reply:", error);
  }
}

/**
 * Read a tradie's reply and apply it to the booking, or bookings, it answers.
 *
 * With a `reference`, only the bookings it names are candidates, and a reply
 * to a request email covering several activities can answer all of them at
 * once (`referencedReplyTargets`). Without one, every booking the tradie has
 * open is a candidate and the reply must pick out exactly one, as before.
 * Whatever cannot be applied goes to the admins rather than the log.
 */
async function handleTradieReply(input: {
  tradie: { id: string; name: string };
  /** The subject as received; "" when there was none. */
  subject: string;
  content: string;
  reference: TradieReplyReference | null;
}): Promise<void> {
  const { tradie, content, reference } = input;
  const subject = input.subject || "(no subject)";
  const label = reference
    ? `${reference.token} (${reference.projectName})`
    : `Tradie ${tradie.id}`;

  // Without a reference, a tradie with nothing open is skipped before the
  // model is asked. With one, the reply is about a job we can name, so it is
  // read and, if its bookings are closed, put in front of the office below.
  if (!reference) {
    const openBookings = await prisma.tradieSchedule.count({
      where: {
        status: { in: [...AWAITING_TRADIE_REPLY] },
        tradieId: tradie.id,
      },
    });
    if (openBookings === 0) {
      console.log(`  ${label}: no booking awaiting a reply. Skipping.`);
      return;
    }
  }

  const tradieInfo = await extractTradieScheduleInfoFromMessage(
    input.subject,
    content,
  );
  if (!tradieInfo) {
    await notifyTradieReplyNeedsReview(
      tradie,
      subject,
      `The reply${reference ? ` to ${label}` : ""} could not be read automatically. Check it and update the booking by hand.`,
    );
    return;
  }
  console.log(`  extractedTradieInfo: ${JSON.stringify(tradieInfo)}`);

  const match = await matchTradieReplyToSchedule(
    { hints: tradieInfo, scope: reference?.scope, tradieId: tradie.id },
    prisma,
  );
  if (match.kind === "none") {
    if (reference) {
      // A late quote or a change of mind on a closed or cancelled booking:
      // dropping it is the silent failure nobody here would notice.
      await notifyTradieReplyNeedsReview(
        tradie,
        subject,
        `The reply to ${label} arrived, but none of the bookings it is about are waiting on an answer any more. Read it and update the booking by hand if it changes anything.`,
      );
    } else {
      console.log(`  ${label}: no booking awaiting a reply. Skipping.`);
    }
    return;
  }

  // The email asked about several activities and some are no longer going
  // ahead: cancelled when another tradie was chosen, or declined. Nobody told
  // the tradie, so a "yes" to the whole email can mean they turn up for work
  // that is not happening. The open ones are still answered below.
  if (reference && "requestRecipientId" in reference.scope) {
    const withdrawn = await prisma.tradieSchedule.findMany({
      select: { milestone: { select: { name: true } } },
      where: {
        requestRecipientId: reference.scope.requestRecipientId,
        status: {
          in: [TradieScheduleStatus.CANCELLED, TradieScheduleStatus.DECLINED],
        },
      },
    });
    if (withdrawn.length > 0) {
      await notifyTradieReplyNeedsReview(
        tradie,
        subject,
        `The reply to ${label} also covers ${withdrawn.length} ${withdrawn.length === 1 ? "activity that is" : "activities that are"} no longer going ahead (${withdrawn
          .map((booking) => booking.milestone?.name ?? "general works")
          .join(
            ", ",
          )}). The tradie may not know; let them know. Their answer on the open activities has been applied.`,
      );
    }
  }

  let targets: readonly { id: string; status: TradieScheduleStatus }[];
  let where: string;
  if (match.kind === "matched") {
    targets = [match.schedule];
    where = match.schedule.project.name;
  } else {
    const all = reference
      ? referencedReplyTargets(match.candidates, {
          confirmed: tradieInfo.scheduleConfirmation,
          quoted: Boolean(tradieInfo.scheduleQuote),
        })
      : null;
    if (!all) {
      await notifyTradieReplyNeedsReview(
        tradie,
        subject,
        reference
          ? `The reply to ${label} covers ${match.candidates.length} open activities and could not be split between them automatically. Record any quote per activity with Manual quote on the Tradies tab, and update the bookings by hand.`
          : `The reply did not say which of ${match.candidates.length} open bookings it is about (${match.candidates
              .map((candidate) => candidate.project.name)
              .join(", ")}). Update the right one by hand.`,
      );
      return;
    }
    targets = all;
    where = `${all.length} activities on ${reference?.projectName}`;
  }

  const failed: string[] = [];
  for (const target of targets) {
    try {
      await applyTradieScheduleUpdate(
        systemPrincipal("graph:tradie-email-reply"),
        target.id,
        {
          status: tradieReplyStatus(
            target.status,
            tradieInfo.scheduleConfirmation,
          ),
          // A price is never spread over several bookings: one amount written
          // onto each would count it several times over.
          quote:
            targets.length === 1
              ? (tradieInfo.scheduleQuote ?? undefined)
              : undefined,
          // Without the basis the amount is unreadable: "$950" is a day rate
          // as often as it is a small job, and the schedule total and the
          // tradie's last quoted price both hang off which one it is. FIXED
          // when the tradie named a price and no basis.
          quoteUnit: tradieInfo.scheduleQuoteBasis ?? undefined,
        },
      );
    } catch (error) {
      console.error("Failed to apply a tradie reply:", error);
      failed.push(target.status);
    }
  }
  if (failed.length > 0) {
    await notifyTradieReplyNeedsReview(
      tradie,
      subject,
      `The reply was matched to ${where} but ${failed.length === targets.length ? "the booking" : `${failed.length} of ${targets.length} bookings`} could not be updated from ${[...new Set(failed)].join(", ")}. Update ${failed.length === 1 ? "it" : "them"} by hand.`,
    );
  }
}

/**
 * File a tradie's message on its project thread, before anything reads it.
 *
 * Whatever the reply does to a booking — applied, refused, sent to the office
 * for review — what the tradie wrote is kept, so the Tradies tab can show it.
 * A failure here is logged and does not stop the reply being applied.
 */
async function fileTradieMessage(input: {
  tradieId: string;
  reference: TradieReplyReference | null;
  message: GraphMessage;
  content: string;
  to: string;
}): Promise<void> {
  const { message } = input;
  try {
    const filed = await recordInboundTradieEmail(
      {
        body: input.content,
        from: message.from ?? "",
        graphMessageId: message.id,
        hasAttachments: Boolean(message.hasAttachments),
        receivedAt: new Date(message.receivedDateTime),
        reference: input.reference,
        subject: message.subject ?? "(no subject)",
        to: input.to,
        tradieId: input.tradieId,
      },
      prisma,
    );
    console.log(
      `  Tradie ${input.tradieId}: message ${filed.recorded ? "filed" : "already filed"} on ${filed.projectId ? `project ${filed.projectId}` : "no project"}`,
    );
  } catch (error) {
    console.error(
      `Could not file tradie ${input.tradieId}'s email on its project thread`,
      error,
    );
  }
}

async function isTradieMessage(fromEmail: string): Promise<boolean> {
  try {
    const existingTradie = await prisma.tradie.findUnique({
      where: {
        email: fromEmail,
      },
    });
    return existingTradie !== null;
  } catch (error) {
    console.error(
      `Error checking if fromEmail ${fromEmail} is a tradie message:`,
      error,
    );
    return false;
  }
}

interface CertifierMatch {
  refToken: string;
  /** Null only for a token with no engagement behind it. */
  engagement: { id: string } | null;
  matchedOn: "token" | "address";
}

interface PartyMatch {
  refToken: string;
  /** Null only for a token with no outreach behind it. */
  outreach: { id: string; party: CompliancePartyType } | null;
  matchedOn: "token" | "address";
}

/**
 * The compliance outreach an inbound message belongs to, if any.
 *
 * The same two correlations the certifier lookup makes, in the same order and
 * for the same reasons — our own token where it survived the round trip, the
 * site address in the subject where it did not — because a surveyor's office
 * mangles a subject exactly the way a certifier's does.
 *
 * Two things differ. The address route matches against the party's own
 * contactEmail rather than a certifier's, and it also considers the NSW
 * Planning Portal address: the council outreach is never written to, so it has
 * no outbound message to prove the address was ever told to anybody, and the
 * "we have talked to them" guard the certifier route uses would exclude it
 * permanently. The portal address is configured rather than picked, which is
 * what makes that safe — the sender is not being inferred, it is known.
 */
async function matchPartyOutreach(
  subject: string | undefined | null,
  fromEmail: string | undefined | null,
  /**
   * The message body, for the planning branch only.
   *
   * A portal notification routinely has a subject as bare as "Case PAN-123456
   * updated" and puts the application number, the address and what it wants in
   * the body. Every other correlation here reads the subject alone, because
   * every other correspondent is replying on a thread whose subject we wrote.
   */
  body?: string | null,
  mailbox: GraphMailbox = "business",
): Promise<PartyMatch | null> {
  const token = extractPartyRefToken(subject);
  const graphMailbox =
    mailbox === "admin"
      ? PrismaGraphMailbox.ADMIN
      : PrismaGraphMailbox.BUSINESS;
  if (token) {
    const outreach = await prisma.complianceOutreach.findFirst({
      where: { refToken: token, graphMailbox },
      select: { id: true, party: true },
    });
    return { refToken: token, outreach, matchedOn: "token" };
  }

  const sender = normalizeEmailAddress(fromEmail ?? "");
  const domain = sender.slice(sender.indexOf("@") + 1);
  if (!domain) {
    return null;
  }

  // The portal and the councils, which are the one correspondent here that
  // writes to us without ever having been written to -- and, unlike every
  // other party, without a fixed address to recognise them by. Three
  // deterministic layers, all of which have to hold: an authority domain, the
  // vocabulary of a planning matter, and a reference or an address naming
  // exactly one of our jobs. See lib/graph/planning-portal.ts.
  const isPlanningPortal = looksLikePlanningNotification({
    fromEmail: sender,
    domain,
    subject,
    body,
  });

  const candidates = await prisma.complianceOutreach.findMany({
    where: isPlanningPortal
      ? // Held to council rows so a portal notification cannot be filed against
        // a surveyor thread on the same job.
        { party: CompliancePartyType.COUNCIL, graphMailbox }
      : {
          graphMailbox,
          contactEmail: isPublicMailDomain(domain)
            ? // Nothing about "@gmail.com" says this is the surveyor rather
              // than the homeowner writing about the same site, so the whole
              // address has to match. Same trade the certifier route makes: a
              // missed correlation is a message in the lead queue, a wrong one
              // files a client's enquiry as compliance.
              { equals: sender, mode: "insensitive" }
            : { endsWith: `@${domain}`, mode: "insensitive" },
          // An outreach whose mail has never gone out has not told this party
          // the address, so a message quoting it cannot be a reply to it.
          emails: { some: { direction: CertifierEmailDirection.OUTBOUND } },
        },
    select: {
      id: true,
      party: true,
      refToken: true,
      engagement: {
        select: {
          subjectAddress: true,
          // The references we recorded when each application was lodged. Read
          // only on the planning branch, and the strongest layer there: unlike
          // an address, an application number is a value we wrote down
          // ourselves, and it names one job rather than one street.
          externalApplications: { select: { applicationRef: true } },
        },
      },
    },
  });

  // What the message quotes, normalised once rather than per candidate.
  const quotedRefs = isPlanningPortal
    ? planningReferencesIn(subject, body)
    : new Set<string>();

  const matches = candidates.filter((candidate) => {
    if (isPlanningPortal && quotedRefs.size > 0) {
      // The reference route, where the message carries one. It is checked
      // first and on its own, because a council quoting our DA number has
      // identified the job beyond argument -- and its subject often does not
      // carry the site address at all, so falling through to the address
      // comparison would lose a message that had already told us exactly what
      // it was about.
      const ours = candidate.engagement.externalApplications
        .map((application) => application.applicationRef)
        .filter((ref): ref is string => Boolean(ref))
        .map(normaliseReference)
        .filter((ref) => ref.length >= 6);

      if (ours.some((ref) => quotedRefs.has(ref))) {
        return true;
      }
    }

    return subjectMentionsSiteAddress(
      subject,
      candidate.engagement.subjectAddress,
    );
  });

  if (matches.length !== 1) {
    if (matches.length > 1) {
      // One surveyor, two of our jobs, and a subject that reads as both — two
      // units of the same address, most likely. Picking one files documents
      // against the wrong project, which is worse than filing them nowhere.
      console.log(
        `  Compliance party address match ambiguous for "${subject ?? ""}": ${matches
          .map((match) => match.refToken)
          .join(", ")}`,
      );
    }
    return null;
  }

  const [match] = matches;
  return {
    refToken: match.refToken,
    outreach: { id: match.id, party: match.party },
    matchedOn: "address",
  };
}

/**
 * The certifier engagement an inbound message belongs to, if any.
 *
 * Two correlations, in order of confidence:
 *
 * 1. The `[RCCERT-…]` token we minted. Exact, and the reason it exists.
 * 2. The site address in the subject. Certifiers run their own job numbering
 *    and answer under it — "260449-11 14 Example St, Marrickville" — with our
 *    token retyped away, stripped by a ticketing system, or never quoted
 *    because the reply was composed fresh rather than by hitting Reply. The
 *    address is the one thing always on the subject, because it is what
 *    identifies the job to them, so that is what the reverse lookup runs on.
 *
 * The address route is deliberately narrower than the token route, because it
 * is an inference and the token is not. It considers only engagements the pack
 * has actually gone out on, only a sender who looks like the certifier it went
 * to, and only when exactly one engagement matches. Anything short of that
 * falls through to the lead path — where an uncorrelated message went before
 * any of this existed — rather than guessing a project onto it.
 *
 * A null `engagement` alongside a token means the subject carried one of ours
 * with nothing behind it: a stale thread on a deleted project. Still ours, so
 * it stops at the certifier branch rather than being read as an enquiry.
 */
async function matchCertifierEngagement(
  subject: string | undefined | null,
  fromEmail: string | undefined | null,
  mailbox: GraphMailbox = "business",
): Promise<CertifierMatch | null> {
  const token = extractCertifierRefToken(subject);
  const graphMailbox =
    mailbox === "admin"
      ? PrismaGraphMailbox.ADMIN
      : PrismaGraphMailbox.BUSINESS;
  if (token) {
    const engagement = await prisma.certifierEngagement.findFirst({
      where: { refToken: token, graphMailbox },
      select: { id: true },
    });
    return { refToken: token, engagement, matchedOn: "token" };
  }

  const sender = normalizeEmailAddress(fromEmail ?? "");
  const domain = sender.slice(sender.indexOf("@") + 1);
  if (!domain) {
    return null;
  }

  const candidates = await prisma.certifierEngagement.findMany({
    where: {
      graphMailbox,
      certifierEmail: isPublicMailDomain(domain)
        ? // Nothing about "@gmail.com" says this is a certifier rather than the
          // homeowner writing about the same site, so the whole address has to
          // match. That costs the "whoever in the office picks the job up"
          // tolerance the next branch keeps, and it is the right trade: a
          // missed correlation is a message in the lead queue, a wrong one
          // files a client's enquiry as compliance.
          { equals: sender, mode: "insensitive" }
        : { endsWith: `@${domain}`, mode: "insensitive" },
      // An engagement still being assembled has never told this certifier the
      // address, so a message quoting it cannot be a reply to it.
      emails: { some: { direction: CertifierEmailDirection.OUTBOUND } },
    },
    select: { id: true, refToken: true, subjectAddress: true },
  });

  const matches = candidates.filter((candidate) =>
    subjectMentionsSiteAddress(subject, candidate.subjectAddress),
  );

  if (matches.length !== 1) {
    if (matches.length > 1) {
      // One certifier, two of our jobs, and a subject that reads as both —
      // two units of the same address, most likely. Picking one would file
      // documents against the wrong project, which is worse than filing them
      // nowhere, so it is left for a human and logged loudly enough to find.
      console.log(
        `  Certifier address match ambiguous for "${subject ?? ""}": ${matches
          .map((match) => match.refToken)
          .join(", ")}`,
      );
    }
    return null;
  }

  const [match] = matches;
  return {
    refToken: match.refToken,
    engagement: { id: match.id },
    matchedOn: "address",
  };
}

function handleValidationToken(request: Request): Response | null {
  const { searchParams } = new URL(request.url);
  const validationToken = searchParams.get("validationToken");

  if (!validationToken) {
    return null;
  }

  console.log("Received Graph webhook validation request");
  return textResponse(200, validationToken);
}

/**
 * Client state is the mailbox routing secret. A resource match is checked
 * again after loading the role's config because a notification can contain a
 * resource from another subscription in the same batch.
 */
function mailboxForNotification(
  notification: GraphNotification,
): GraphMailbox | null {
  const clientState = notification.clientState;
  if (!clientState) return null;

  if (clientState === process.env.GRAPH_ADMIN_WEBHOOK_CLIENT_STATE) {
    return "admin";
  }
  if (
    clientState
    === (process.env.GRAPH_WEBHOOK_CLIENT_STATE || "royal-leadgen-webhook")
  ) {
    return "business";
  }
  return null;
}

export async function GET(request: Request): Promise<Response> {
  const validation = handleValidationToken(request);
  if (validation) {
    return validation;
  }

  return textResponse(400, "Missing validationToken");
}

/**
 * Fetches and acts on each notified message.
 *
 * Runs after the 202 has gone out, so nothing in here can change what Graph
 * was told. That cuts both ways: the acknowledgement is no longer hostage to a
 * model round-trip, and a failure in here is invisible to Graph — it will not
 * resend the notification. Which is exactly why the Graph calls below retry
 * rather than giving up on the first transient error.
 */
async function processNotifications(
  notifications: GraphNotification[],
): Promise<void> {
  const contexts = new Map<
    GraphMailbox,
    {
      config: ReturnType<typeof getGraphConfig>;
      client: Awaited<ReturnType<typeof createGraphContext>>;
    } | null
  >();

  for (const notification of notifications) {
    const mailbox = mailboxForNotification(notification);
    if (!mailbox) {
      console.log("Ignored notification with invalid or missing clientState");
      continue;
    }

    let context = contexts.get(mailbox);
    if (context === undefined) {
      try {
        const config = getGraphConfig(mailbox);
        context = {
          config,
          client: await createGraphContext(config),
        };
      } catch (error) {
        console.error(
          `Graph auth/config failed for ${mailbox} webhook fetch`,
          error,
        );
        context = null;
      }
      contexts.set(mailbox, context);
    }

    if (!context) continue;
    const { config, client: graphClient } = context;
    if (
      !graphResourceBelongsToMailbox(
        notification.resource,
        config.webhookSubscriptionResource,
        config.senderUpn,
      )
    ) {
      console.log(`Ignored ${mailbox} notification for an unexpected resource`);
      continue;
    }

    console.log(`Notification: ${notification.changeType ?? "unknown"}`);
    console.log(`  resource: ${notification.resource ?? "unknown"}`);
    console.log(`  messageId: ${notification.resourceData?.id ?? "unknown"}`);
    console.log(
      `  type: ${notification.resourceData?.["@odata.type"] ?? "unknown"}`,
    );
    console.log(
      `  subscriptionId: ${notification.subscriptionId ?? "unknown"}`,
    );
    console.log(`  tenantId: ${notification.tenantId ?? "unknown"}`);

    if (graphClient && notification.resource) {
      // Captured so the retry closure keeps the narrowing on both.
      const client = graphClient;
      const resource = notification.resource;
      let message: GraphMessage | null = null;

      try {
        message = await withGraphRetry(
          "fetch message details",
          () => client.getMessageByResource(resource, true),
          {
            // The notification routinely beats Graph's own index, so a 404
            // here means "not visible yet", not "does not exist" — the one
            // place a 404 is worth repeating.
            shouldRetry: (error) =>
              isRetryableGraphError(error)
              || (error as { status?: number })?.status === 404,
          },
        );
      } catch {
        console.error("All attempts to fetch message details failed.");
      }

      if (message) {
        try {
          // Outbound compliance mail is copied back into the watched inbox by
          // Exchange. It is a message in the admin mailbox, but never an
          // inbound party response and must not reach lead extraction.
          if (mailbox === "admin" && isOwnMailbox(message.from)) {
            console.log(`  Ignored self-generated admin message ${message.id}`);
            continue;
          }

          // Every send CCs the mailbox it went from, as the office's
          // confirmation copy (lib/graph/mailbox.ts, ccWithSender). On the
          // business inbox that copy would otherwise read as a client reply:
          // an offer email carries its [RCOFR-…] token and would be recorded
          // as the client answering. Narrower than the admin rule above,
          // because a website form is relayed by our own mailbox to itself.
          if (isSenderCopy(message)) {
            console.log(`  Ignored our own sent-mail copy ${message.id}`);
            continue;
          }

          const contentType = message.body?.contentType ?? "text";
          const content = message.body?.content ?? message.bodyPreview ?? "";
          console.log(`  subject: ${message.subject}`);
          console.log(`  from: ${message.from}`);
          console.log(`  received: ${message.receivedDateTime}`);
          console.log(`  body(${contentType}): ${content || "[no body]"}`);

          // Offer proposal reply: the subject carries [RCOFR-…]. Correlate it
          // back to the send and stop — it is not a lead/tradie message.
          const offerReplyToken =
            mailbox === "business"
              ? extractOfferReplyToken(message.subject)
              : null;
          if (offerReplyToken) {
            const record = await recordOfferReply(
              systemPrincipal("graph:offer-reply"),
              {
                body: content,
                from: message.from,
                graphMessageId: message.id,
                hasAttachments: message.hasAttachments,
                headers: message.headers,
                receivedAt: message.receivedDateTime || null,
                subject: message.subject ?? "",
                token: offerReplyToken,
              },
              prisma,
            );
            const outcome = record.outcome;
            if (record.outcome === "recorded") {
              // The message is committed; its files are the slow half, and
              // Graph has already been told 202. `start` only enqueues. Should
              // it fail, the reply still reads "still being saved — if this
              // stays, open the email in Outlook", which is the truth.
              try {
                const run = await start(storeOfferReplyAttachments, [
                  { graphMessageId: message.id, replyId: record.replyId },
                ]);
                console.log(
                  `  Offer ${offerReplyToken}: attachment workflow started: run ${run.runId}`,
                );
              } catch (error) {
                console.error(
                  `  Offer ${offerReplyToken}: couldn't start the attachment workflow`,
                  error,
                );
              }
            }
            // Log the negatives too. An "auto-generated" line here is a
            // bounce or an out-of-office arriving, and today this is the only
            // trace of it — it is what a bounce classifier gets tuned against
            // before one is built.
            console.log(
              `  Offer ${offerReplyToken}: ${outcome}`,
              JSON.stringify({
                from: message.from,
                subject: message.subject,
                autoSubmitted: message.headers.autoSubmitted ?? null,
                returnPath: message.headers.returnPath ?? null,
                contentType: message.headers.contentType ?? null,
              }),
            );
            continue;
          }

          // Compliance party thread: the surveyor, the architect, or the NSW
          // Planning Portal. Checked before the certifier because the two
          // lookups are exclusive by construction — a subject carries at most
          // one of our tokens, and an address match is held to rows of one
          // kind — so the order is about cost rather than precedence: this one
          // is the cheaper miss, a single indexed lookup on a token that is
          // absent from almost every message.
          const partyMatch = await matchPartyOutreach(
            message.subject,
            message.from,
            // Read only by the planning branch, whose subjects are routinely
            // bare — "Case PAN-123456 updated" — with the application number
            // and the address in the message instead.
            content,
            mailbox,
          );
          if (partyMatch) {
            const { refToken: partyToken, outreach } = partyMatch;

            if (!outreach) {
              console.log(
                `  Compliance party ${partyToken}: no matching outreach`,
              );
            } else if (isMachineGenerated(message.headers)) {
              // A bounce quotes the original subject, so "Undeliverable: …
              // [RCSURV-…]" correlates perfectly and is not the surveyor
              // replying. Logged rather than dropped silently: it is the only
              // trace of a failed delivery today.
              console.log(
                `  Compliance party ${partyToken}: auto-generated`,
                JSON.stringify({
                  from: message.from,
                  subject: message.subject,
                  autoSubmitted: message.headers.autoSubmitted ?? null,
                  returnPath: message.headers.returnPath ?? null,
                  contentType: message.headers.contentType ?? null,
                }),
              );
            } else {
              // Same reasoning as the certifier branch below: downloading a
              // survey set, OCR, the classification call and the alert read are
              // the slow, failure-prone half, and Graph has already been told
              // 202. `start` only enqueues, so nothing here waits on it.
              const run = await start(processInboundPartyEmail, [
                {
                  messageId: message.id,
                  refToken: partyToken,
                  subject: message.subject ?? "",
                  body: content,
                  from: message.from,
                  to:
                    message.to?.[0]
                    ?? config.senderUpn
                    ?? "info@royalconstructions.com.au",
                  receivedDateTime: message.receivedDateTime,
                },
              ]);
              console.log(
                `  Compliance ${outreach.party} ${partyToken}: workflow started for message ${message.id} `
                  + `(matched on ${partyMatch.matchedOn}): run ${run.runId}`,
              );
            }
            continue;
          }

          // Certifier thread: correlated on our [RCCERT-…] token where it
          // survived the round trip, and on the site address in the subject
          // where it did not. Never on the sender alone — a certifier's office
          // answers from whichever address picks the job up.
          const certifierMatch = await matchCertifierEngagement(
            message.subject,
            message.from,
            mailbox,
          );
          if (certifierMatch) {
            const { refToken: certifierToken, engagement } = certifierMatch;

            if (!engagement) {
              console.log(
                `  Certifier ${certifierToken}: no matching engagement`,
              );
            } else if (isMachineGenerated(message.headers)) {
              // A bounce quotes the original subject, so "Undeliverable: …
              // [RCCERT-…]" correlates perfectly and is not the certifier
              // replying. Logged rather than dropped silently: this is the
              // only trace of a failed delivery today, and it is what a bounce
              // classifier gets tuned against before one is built.
              console.log(
                `  Certifier ${certifierToken}: auto-generated`,
                JSON.stringify({
                  from: message.from,
                  subject: message.subject,
                  autoSubmitted: message.headers.autoSubmitted ?? null,
                  returnPath: message.headers.returnPath ?? null,
                  contentType: message.headers.contentType ?? null,
                }),
              );
            } else {
              // Everything past this point — downloading attachments, OCR, the
              // classification call, the document rows, the notification — is
              // the slow, failure-prone half, and Graph has already been told
              // 202. Handing it to a workflow makes each of those a step that
              // retries on its own and resumes at the last boundary it
              // cleared. `start` only enqueues, so nothing below waits on it.
              const run = await start(processInboundCertifierEmail, [
                {
                  messageId: message.id,
                  refToken: certifierToken,
                  subject: message.subject ?? "",
                  body: content,
                  from: message.from,
                  to:
                    message.to?.[0]
                    ?? config.senderUpn
                    ?? "info@royalconstructions.com.au",
                  receivedDateTime: message.receivedDateTime,
                },
              ]);
              console.log(
                `  Certifier ${certifierToken}: workflow started for message ${message.id} `
                  + `(matched on ${certifierMatch.matchedOn}): run ${run.runId}`,
              );
            }
            continue;
          }

          // Check if this message was already processed before calling the LLM extraction
          if (message.id && (await isMessageAlreadyProcessed(message.id))) {
            console.log(
              `  Lead with MicrosoftmessageId: ${message.id} already exists in database. Skipping duplicate processing.`,
            );
            continue;
          }

          // A tradie answering a booking request. Which booking, and what the
          // answer moves it to, is lib/domain/tradies/replies.ts; the status
          // change itself runs as the system, because this webhook has no
          // signed-in user — `updateTradieSchedule` is the browser's door and
          // refused every reply here with "User not authenticated".
          //
          // A reply that quotes one of our references ([RCTRQ-…] on a
          // request, [RCTBK-…] on one booking) is matched to the bookings it
          // names. One that does not — or names nothing we have — falls back
          // to the sender and the tradie's open bookings, as before.
          const tradieRefToken = extractTradieRefToken(
            message.subject,
            content,
          );
          const tradieReference = tradieRefToken
            ? await findTradieReplyReference(tradieRefToken, prisma)
            : null;
          if (tradieReference) {
            const subject = message.subject ?? "(no subject)";
            if (isMachineGenerated(message.headers)) {
              // A bounce or an out-of-office quotes the subject, reference
              // and all. Logged: it is the only trace of either today.
              console.log(
                `  Tradie reply ${tradieReference.token}: auto-generated`,
                JSON.stringify({
                  autoSubmitted: message.headers.autoSubmitted ?? null,
                  from: message.from,
                  subject: message.subject,
                }),
              );
            } else if (!isReplyFromTradie(tradieReference, message.from)) {
              await notifyTradieReplyNeedsReview(
                tradieReference.tradie,
                subject,
                `The reply quotes ${tradieReference.token} (${tradieReference.projectName}) but came from ${message.from || "an unknown sender"}, which is not an address on ${tradieReference.tradie.name}'s record. Check it and update the booking by hand.`,
              );
            } else {
              await fileTradieMessage({
                content,
                message,
                reference: tradieReference,
                to:
                  message.to?.[0]
                  ?? config.senderUpn
                  ?? "info@royalconstructions.com.au",
                tradieId: tradieReference.tradie.id,
              });
              if (message.hasAttachments) {
                await startTradieInvoiceEmail({
                  content,
                  from: message.from,
                  mailbox,
                  message,
                  tradieId: tradieReference.tradie.id,
                });
              }
              await handleTradieReply({
                content,
                reference: tradieReference,
                subject: message.subject ?? "",
                tradie: tradieReference.tradie,
              });
            }
            continue;
          }

          if (message.from && (await isTradieMessage(message.from))) {
            const tradie = await prisma.tradie.findUnique({
              select: { id: true, name: true },
              where: { email: message.from },
            });
            if (!tradie) continue;
            if (!isMachineGenerated(message.headers)) {
              await fileTradieMessage({
                content,
                message,
                reference: null,
                to:
                  message.to?.[0]
                  ?? config.senderUpn
                  ?? "info@royalconstructions.com.au",
                tradieId: tradie.id,
              });
            }
            if (
              message.hasAttachments
              && !isMachineGenerated(message.headers)
            ) {
              await startTradieInvoiceEmail({
                content,
                from: message.from,
                mailbox,
                message,
                tradieId: tradie.id,
              });
            }
            await handleTradieReply({
              content,
              reference: null,
              subject: message.subject ?? "",
              tradie,
            });
            continue;
          }

          //Check if the message is part of a lead trail
          if (
            await checkLeadPresentWithEmailPhone(message.from, message.to, "")
          ) {
            console.log(
              `  Lead with Email: ${message.from} already exists in database. Saving to the email trail.`,
            );
            await saveLeadEmailTrail({
              from: message.from,
              to: config.senderUpn ?? "info@royalconstructions.com.au",
              subject: message.subject,
              body: content,
              sentAt: new Date(message.receivedDateTime),
            });
            continue;
          }

          // Check if the message subject matches any of the predefined lead subject lines
          if (
            !isLeadMessage(
              message.subject,
              message.from,
              config.senderUpn ?? "info@royalconstructions.com.au",
            )
          ) {
            console.log(
              `Message subject "${message.subject}" does not match any lead subject lines. Skipping lead extraction.`,
            );
            continue;
          }

          // Evaluate the email for spam likelihood before proceeding with lead extraction
          const emailEvaluation = evaluateEmail(
            message.subject ?? "",
            content,
            message.headers,
          );
          if (!emailEvaluation.shouldEvaluate) {
            console.log(
              `  Email evaluation scored ${emailEvaluation.score}. Language: ${emailEvaluation.language ?? "unknown"}.`,
            );
            console.log(
              ` Email evaluation signals: ${emailEvaluation.signals.map((signal) => `${signal.code} (${signal.delta}): ${signal.reason}`).join("; ")}`,
            );
            console.log(
              `  Email evaluation indicates this message is likely spam. Reasons: ${emailEvaluation.reasons.join(", ")}`,
            );
            continue; // Skip processing this message
          }

          // Everything past this point — attachments, OCR, the model call, the
          // lead row, the welcome email — is the slow, failure-prone half, and
          // it used to run right here. Graph had already been told 202 by then,
          // so a timeout or a rate-limited model call lost the enquiry with no
          // trace and no second attempt.
          //
          // Handing it to a workflow makes each of those a step that retries on
          // its own and resumes at the last boundary it cleared. `start` only
          // enqueues the run, so nothing below waits on any of it.
          const run = await start(processInboundLead, [
            {
              messageId: message.id,
              subject: message.subject ?? "",
              body: content,
              from: message.from,
            },
          ]);

          console.log(
            `  Lead extraction workflow started for message ${message.id}: run ${run.runId}`,
          );
        } catch (error) {
          console.error("Failed to extract or save lead to database:", error);
        }
      }
    }
  }
}

export async function POST(request: Request): Promise<Response> {
  const validation = handleValidationToken(request);
  if (validation) {
    return validation;
  }

  let payload: GraphNotificationBody;
  try {
    const rawBody = await request.text();
    payload = rawBody ? (JSON.parse(rawBody) as GraphNotificationBody) : {};
  } catch (error) {
    console.error("Invalid webhook payload", error);
    return textResponse(400, "Bad Request");
  }

  const notifications = payload.value ?? [];
  if (notifications.length === 0) {
    if (payload.lifecycleEvent) {
      console.log(
        `Received lifecycle event: ${String(payload.lifecycleEvent)}`,
      );
    } else {
      console.log("Received unknown webhook payload");
    }
    return textResponse(202, "accepted");
  }

  console.log(`Received ${notifications.length} Graph notification(s)`);

  // Graph expects an acknowledgement within seconds. Miss it often enough and
  // it stops trusting the endpoint and drops the subscription — and this
  // handler fetches the message, runs a model round-trip and now pulls
  // attachments down before it would ever have replied.
  //
  // after() writes the 202 first and keeps the invocation alive for the rest,
  // which is what makes the retries above affordable. It runs on the same
  // invocation, so `maxDuration` still bounds the whole thing.
  after(async () => {
    try {
      await processNotifications(notifications);
    } catch (error) {
      // after() swallows what it catches; without this the only trace of a
      // failed batch would be a silent absence of leads.
      console.error("Graph notification processing failed", error);
    }
  });

  return textResponse(202, "accepted");
}
