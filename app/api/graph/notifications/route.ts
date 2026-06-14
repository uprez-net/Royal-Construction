import { createGraphContext } from '@/lib/graph/client';
import { getGraphConfig } from '@/lib/graph/config';
import { extractLeadFromMessage } from '@/lib/graph/lead-extractor';
import prisma from "@/lib/prisma";
import { renderEmailHtml } from '@/lib/leads/render-email-html';

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
        let message = null;
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

            // Check if this message was already processed before calling the LLM extraction
            if (message.id && await isMessageAlreadyProcessed(message.id)) {
              console.log(`  Lead with MicrosoftmessageId: ${message.id} already exists in database. Skipping duplicate processing.`);
              continue;
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

                const phoneVal = extracted.ContactNo != null ? String(extracted.ContactNo) : '';
                console.log('  Saving lead to database...');
                const newLead = await prisma.lead.create({
                  data: {
                    name: extracted.Name || 'Unknown Lead',
                    email: extracted.Email || '',
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
