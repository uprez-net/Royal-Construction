import { createGraphContext, GraphMessage } from '@/lib/graph/client';
import { isLeadMessage, isLeadSubject } from "@/lib/graph/lead-subject";
import { getGraphConfig } from '@/lib/graph/config';
import prisma from "@/lib/prisma";
import { extractTradieScheduleInfoFromMessage } from '@/lib/graph/tradie-schedule-info-extractor';
import { updateTradieSchedule } from '@/lib/data/tradieSchedules';
import { saveLeadEmailTrail } from '@/lib/graph/save-lead-email-trail';
import { evaluateEmail } from '@/utils/spam-detector';
import { extractOfferReplyToken, recordOfferReply } from '@/lib/graph/offer-reply-tracker';
import { isRetryableGraphError, withGraphRetry } from '@/lib/graph/retry';
import { checkLeadPresentWithEmailPhone } from '@/lib/leads/existing-lead';
import { processInboundLead } from '@/lib/workflow/lead-extraction';
import { start } from 'workflow/api';
import { after } from 'next/server';

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
    '@odata.type'?: string;
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
      'Content-Type': 'text/plain',
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
    console.error(`Error checking if messageId ${messageId} is processed:`, error);
    return false;
  }
}

async function isTradieMessage(fromEmail: string): Promise<boolean> {
  try {
    const existingTradie = await prisma.tradie.findUnique({
      where: {
        email: fromEmail,
      }
    });
    return existingTradie !== null;
  } catch (error) {
    console.error(`Error checking if fromEmail ${fromEmail} is a tradie message:`, error);
    return false;
  }
}

function handleValidationToken(request: Request): Response | null {
  const { searchParams } = new URL(request.url);
  const validationToken = searchParams.get('validationToken');

  if (!validationToken) {
    return null;
  }

  console.log('Received Graph webhook validation request');
  return textResponse(200, validationToken);
}

export async function GET(request: Request): Promise<Response> {
  const validation = handleValidationToken(request);
  if (validation) {
    return validation;
  }

  return textResponse(400, 'Missing validationToken');
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
async function processNotifications(notifications: GraphNotification[]): Promise<void> {
  const config = getGraphConfig();
  let graphClient: Awaited<ReturnType<typeof createGraphContext>> | null = null;
  try {
    graphClient = await createGraphContext(config);
  } catch (error) {
    console.error('Graph auth failed for webhook fetch', error);
  }

  for (const notification of notifications) {
    if (
      config.webhookClientState &&
      notification.clientState !== config.webhookClientState
    ) {
      console.log('Ignored notification with invalid clientState');
      continue;
    }

    console.log(`Notification: ${notification.changeType ?? 'unknown'}`);
    console.log(`  resource: ${notification.resource ?? 'unknown'}`);
    console.log(`  messageId: ${notification.resourceData?.id ?? 'unknown'}`);
    console.log(
      `  type: ${notification.resourceData?.['@odata.type'] ?? 'unknown'}`,
    );
    console.log(`  subscriptionId: ${notification.subscriptionId ?? 'unknown'}`);
    console.log(`  tenantId: ${notification.tenantId ?? 'unknown'}`);

    if (graphClient && notification.resource) {
      // Captured so the retry closure keeps the narrowing on both.
      const client = graphClient;
      const resource = notification.resource;
      let message: GraphMessage | null = null;

      try {
        message = await withGraphRetry(
          'fetch message details',
          () => client.getMessageByResource(resource, true),
          {
            // The notification routinely beats Graph's own index, so a 404
            // here means "not visible yet", not "does not exist" — the one
            // place a 404 is worth repeating.
            shouldRetry: (error) =>
              isRetryableGraphError(error) ||
              (error as { status?: number })?.status === 404,
          },
        );
      } catch {
        console.error('All attempts to fetch message details failed.');
      }

      if (message) {
        try {
          const contentType = message.body?.contentType ?? 'text';
          const content = message.body?.content ?? message.bodyPreview ?? '';
          console.log(`  subject: ${message.subject}`);
          console.log(`  from: ${message.from}`);
          console.log(`  received: ${message.receivedDateTime}`);
          console.log(
            `  body(${contentType}): ${content || '[no body]'}`,
          );

          // Offer proposal reply: the subject carries [RCOFR-…]. Correlate it
          // back to the send and stop — it is not a lead/tradie message.
          const offerReplyToken = extractOfferReplyToken(message.subject);
          if (offerReplyToken) {
            const outcome = await recordOfferReply(offerReplyToken, message);
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

          // Check if this message was already processed before calling the LLM extraction
          if (message.id && await isMessageAlreadyProcessed(message.id)) {
            console.log(`  Lead with MicrosoftmessageId: ${message.id} already exists in database. Skipping duplicate processing.`);
            continue;
          }

          // Check if the message is from a tradie and extract tradie schedule info
          if (message.from && await isTradieMessage(message.from)) {
            const tradie = await prisma.tradie.findUnique({
              where: { email: message.from },
            });
            const tradieSchedules = await prisma.tradieSchedule.findMany({
              where: {
                tradieId: tradie!.id,
                status: {
                  not: {
                    in: ['DECLINED', 'AWAITING_ADMIN_APPROVAL', 'CONFIRMED', 'QUOTE_RECEIVED']
                  }
                } // Only consider non-declined schedules 
              },
            });
            console.log(`  Found ${tradieSchedules.length} existing schedule(s) for tradieId: ${tradie!.id}`);
            if (tradieSchedules.length === 0) {
              console.log(`  No existing schedules found for tradieId: ${tradie!.id}. Skipping lead extraction.`);
              continue;
            }
            console.log(`  Message from ${message.from} is identified as a tradie message. Skipping lead extraction.`);
            const tradieInfo = await extractTradieScheduleInfoFromMessage(message.subject ?? '', content);
            if (!tradieInfo) {
              console.log('  No tradie schedule information could be extracted from the message.');
              continue;
            }
            console.log(`  extractedTradieInfo: ${JSON.stringify(tradieInfo)}`);
            const schedule = await prisma.tradieSchedule.findFirst({
              where: {
                tradieId: tradie!.id,
                scheduledDate: new Date(tradieInfo.scheduleDate),
                project: {
                  location: {
                    contains: tradieInfo.projectLocation ?? "",
                    mode: "insensitive",
                  },
                },
              },
            });
            if (!schedule) {
              console.log(`  Tradie schedule already exists for tradieId: ${tradie!.id}, scheduleDate: ${tradieInfo.scheduleDate}, projectLocation: ${tradieInfo.projectLocation}. Skipping duplicate processing.`);
              continue;
            }
            const status = tradieInfo.scheduleConfirmation
              ? tradieInfo.scheduleQuote != null
                ? "QUOTE_RECEIVED"
                : "AWAITING_ADMIN_APPROVAL"
              : "DECLINED";
            await updateTradieSchedule(schedule.id, {
              status,
              quote: tradieInfo.scheduleQuote ?? undefined,
              // Without the basis the amount is unreadable: "$950" is a day
              // rate as often as it is a small job, and the schedule total
              // and the tradie's last quoted price both hang off which one
              // it is. FIXED when the tradie named a price and no basis.
              quoteUnit: tradieInfo.scheduleQuoteBasis ?? undefined,
            });
            continue;
          }

          //Check if the message is part of a lead trail
          if (await checkLeadPresentWithEmailPhone(message.from, message.to, "")) {
            console.log(`  Lead with Email: ${message.from} already exists in database. Saving to the email trail.`);
            await saveLeadEmailTrail({
              from: message.from,
              to: process.env.BUSINESS_EMAIL ?? 'info@royalconstructions.com.au',
              subject: message.subject,
              body: content,
              sentAt: new Date(message.receivedDateTime),
            });
            continue;
          }

          // Check if the message subject matches any of the predefined lead subject lines
          if (!isLeadSubject(message.subject)) {
            console.log(
              `Message subject "${message.subject}" does not match any lead subject lines. Skipping lead extraction.`
            );
            continue;
          }

          // Evaluate the email for spam likelihood before proceeding with lead extraction
          const emailEvaluation = evaluateEmail(message.subject ?? '', content, message.headers);
          if (!emailEvaluation.shouldEvaluate) {
            console.log(`  Email evaluation scored ${emailEvaluation.score}. Language: ${emailEvaluation.language ?? 'unknown'}.`);
            console.log(` Email evaluation signals: ${emailEvaluation.signals.map(signal => `${signal.code} (${signal.delta}): ${signal.reason}`).join('; ')}`);
            console.log(`  Email evaluation indicates this message is likely spam. Reasons: ${emailEvaluation.reasons.join(', ')}`);
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
              subject: message.subject ?? '',
              body: content,
              from: message.from,
            },
          ]);

          console.log(
            `  Lead extraction workflow started for message ${message.id}: run ${run.runId}`,
          );
        } catch (error) {
          console.error('Failed to extract or save lead to database:', error);
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
    console.error('Invalid webhook payload', error);
    return textResponse(400, 'Bad Request');
  }

  const notifications = payload.value ?? [];
  if (notifications.length === 0) {
    if (payload.lifecycleEvent) {
      console.log(`Received lifecycle event: ${String(payload.lifecycleEvent)}`);
    } else {
      console.log('Received unknown webhook payload');
    }
    return textResponse(202, 'accepted');
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
      console.error('Graph notification processing failed', error);
    }
  });

  return textResponse(202, 'accepted');
}