import { createGraphContext, GraphMessage } from '@/lib/graph/client';
import { isLeadMessage } from "@/lib/graph/lead-subject";
import { getGraphConfig } from '@/lib/graph/config';
import { extractLeadFromMessage } from '@/lib/graph/lead-extractor';
import prisma from "@/lib/prisma";
import { renderEmailHtml } from '@/lib/leads/render-email-html';
import { Prisma } from '@prisma/client';
import { extractTradieScheduleInfoFromMessage } from '@/lib/graph/tradie-schedule-info-extractor';
import { updateTradieSchedule } from '@/lib/data/tradieSchedules';
import { saveLeadEmailTrail } from '@/lib/graph/save-lead-email-trail';
import { evaluateEmail } from '@/utils/spam-detector';
import { extractOfferReplyToken, recordOfferReply } from '@/lib/graph/offer-reply-tracker';

// export const runtime = 'nodejs';

interface GraphNotificationBody {
  value?: Array<{
    changeType?: string;
    resource?: string;
    resourceData?: {
      id?: string;
      '@odata.type'?: string;
    };
    clientState?: string;
    tenantId?: string;
    subscriptionId?: string;
  }>;
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

/**
 * Checks whether a lead already exists by matching:
 * - sender email
 * - recipient emails
 * - contact number
 *
 * Returns true if any matching lead exists.
 *
 * @param fromEmail - Email address of the sender
 * @param toEmails - Recipient email addresses
 * @param contactNo - Extracted contact number
 */
export async function checkLeadPresentWithEmailPhone(
  fromEmail?: string,
  toEmails: string[] = [],
  contactNo?: string
): Promise<boolean> {
  const orConditions: Prisma.LeadWhereInput[] = [];

  const normalizedFromEmail = fromEmail?.trim().toLowerCase();
  const normalizedContactNo = contactNo?.trim();

  const normalizedToEmails = toEmails
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (normalizedFromEmail) {
    orConditions.push({
      email: {
        equals: normalizedFromEmail,
        mode: "insensitive",
      },
    });
  }

  if (normalizedToEmails.length > 0) {
    orConditions.push({
      email: {
        in: normalizedToEmails,
        mode: "insensitive",
      },
    });
  }

  if (
    normalizedContactNo &&
    normalizedContactNo !== "0"
  ) {
    orConditions.push({
      phone: normalizedContactNo,
    });
  }

  // Nothing useful to search with
  if (orConditions.length === 0) {
    return false;
  }

  const existingLead = await prisma.lead.findFirst({
    where: {
      OR: orConditions,
    },
    select: {
      id: true,
    },
  });

  return Boolean(existingLead);
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

export async function POST(request: Request): Promise<Response> {
  const validation = handleValidationToken(request);
  if (validation) {
    return validation;
  }

  const config = getGraphConfig();
  let graphClient: Awaited<ReturnType<typeof createGraphContext>> | null = null;
  try {
    graphClient = await createGraphContext(config);
  } catch (error) {
    console.error('Graph auth failed for webhook fetch', error);
  }

  try {
    const rawBody = await request.text();
    const payload = rawBody ? (JSON.parse(rawBody) as GraphNotificationBody) : {};

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
        let message: GraphMessage | null = null;
        let attempt = 0;
        const maxAttempts = 3;

        while (attempt < maxAttempts) {
          try {
            message = await graphClient.getMessageByResource(
              notification.resource,
              true,
            );
            break; // Successfully fetched, exit the retry loop
          } catch (error) {
            attempt++;
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(`[Attempt ${attempt}/${maxAttempts}] Failed to fetch message details: ${errorMessage}`);
            if (attempt < maxAttempts) {
              console.log('Waiting 1500ms before retrying due to potential Graph indexing lag...');
              await new Promise((resolve) => setTimeout(resolve, 1500));
            } else {
              console.error('All attempts to fetch message details failed.');
            }
          }
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

            // Check if the message identifies a website enquiry. The sender is
            // part of the test: our own outbound comes back here as a cc or a
            // self-copy and is written to customers, so it reads like an
            // enquiry no matter how the subject vocabulary is tuned.
            if (
              !isLeadMessage(
                message.subject,
                message.from,
                process.env.BUSINESS_EMAIL ?? 'info@royalconstructions.com.au'
              )
            ) {
              console.log(
                `Message subject "${message.subject}" from ${message.from} does not identify a new lead. Skipping lead extraction.`
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

            const extracted = await extractLeadFromMessage(
              message.subject ?? '',
              content,
            );

            if (extracted) {
              console.log(`  extractedLead: ${JSON.stringify(extracted)}`);
              if (extracted.Status === false) {
                // Double-check one final time right before saving to prevent race conditions from concurrent webhook calls
                if (message.id && await isMessageAlreadyProcessed(message.id)) {
                  console.log(`  Lead with MicrosoftmessageId: ${message.id} was already processed while extracting. Aborting database save.`);
                  continue;
                }
                else if (await checkLeadPresentWithEmailPhone(extracted.Email, [], extracted.ContactNo == null ? "" : String(extracted.ContactNo))) {
                  console.log(`  Lead with Email: ${extracted.Email} or ContactNo: ${extracted.ContactNo} already exists in database. Aborting database save.`);
                  continue;
                }

                const phoneVal = extracted.ContactNo != null ? String(extracted.ContactNo) : '';
                console.log('  Saving lead to database...');
                const newLead = await prisma.lead.create({
                  data: {
                    name: extracted.Name || 'Unknown Lead',
                    email: message.from || extracted.Email,
                    phone: phoneVal,
                    location: extracted.Address || '',
                    sourceDetail: 'Website',
                    stage: 'CONTACTED',
                    type: extracted.Type || [],
                    notes: extracted.Info || '',
                    MicrosoftmessageId: message.id,
                  },
                });
                console.log(`  Lead successfully saved to database with ID: ${newLead.id} and MicrosoftmessageId: ${message.id}`);
                // After data Create Successfully Now give the Welcome Email Message to this client if Email and Name are present
                // ═══════════════════════════════════════════════════════
                // SEND WELCOME EMAIL AUTOMATICALLY
                // ═══════════════════════════════════════════════════════
                if (newLead.email && newLead.name && graphClient) {
                  console.log('  Sending welcome email to new lead...');
                  try {
                    // 1. Map Prisma Lead to LeadPreview shape (converting null to undefined)
                    const leadPreview = {
                      id: newLead.id,
                      name: newLead.name,
                      email: newLead.email,
                      type: newLead.type,
                      location: newLead.location,
                      notes: newLead.notes ?? undefined,
                      budget: newLead.budget ?? undefined,
                    };

                    // 2. Generate the HTML body using your React Email template
                    const htmlBody = await renderEmailHtml('Welcome', leadPreview);

                    if (htmlBody) {
                      // 2. Define the subject line
                      const emailSubject = 'Welcome to Royal Constructions — Your Home Building Journey Starts Here';

                      // 3. Send the email directly using the existing Graph Client
                      await graphClient.sendMail({
                        to: newLead.email,
                        subject: emailSubject,
                        body: htmlBody,
                        cc: config.cc, // Include CC if configured
                      });

                      console.log(`  ✅ Welcome email successfully sent to ${newLead.email}`);
                    } else {
                      console.warn('  ⚠️ Failed to render welcome email HTML. No email sent.');
                    }
                  } catch (emailError) {
                    // We catch this error separately so that an email failure 
                    // doesn't crash the webhook and prevent the lead from being saved
                    console.error('  ❌ Failed to send welcome email:', emailError);
                  }
                }
              } else {
                console.log('  Lead Extracted Found as Spam, Ignoring the lead');
              }
            }
          } catch (error) {
            console.error('Failed to extract or save lead to database:', error);
          }
        }
      }
    }

    return textResponse(202, 'accepted');
  } catch (error) {
    console.error('Invalid webhook payload', error);
    return textResponse(400, 'Bad Request');
  }
}