import { ToolLoopAgent, tool, type FilePart, type TextPart } from 'ai';
import { gateway } from '../model';
import { z } from 'zod';
import { stripEmailThread, stripHtml } from '@/utils/formatters';
import {
  EMPTY_LEAD_ATTACHMENTS,
  type LeadAttachmentSet,
} from './lead-attachments';
import { normalizeContactNumber } from './contact-number';

export interface LeadExtraction {
  Name: string;
  Email: string;
  /**
   * Text, not a number. An Australian mobile is "0433100349" and the leading
   * zero is part of it — the moment this was numeric, every one of them lost
   * that digit on the way in.
   */
  ContactNo: string;
  Address: string;
  Status: boolean;
  Type: string[];
  Info: string;
}

const PROJECT_TYPE_OPTIONS = [
  'Not Specified',
  'New Home',
  'Duplex',
  'Renovation',
  'Granny Flat',
  'Townhouse',
  'Dual Occupancy',
  'Single Storey',
  'Double Storey',
  'House and Granny',
  'Knockdown and rebuild',
  'House + land package',
] as const;

type ProjectTypeOption = (typeof PROJECT_TYPE_OPTIONS)[number];
const projectTypeList = PROJECT_TYPE_OPTIONS.map((type) => `"${type}"`).join(
  ', ',
);

const MODEL_NAME = 'google/gemini-2.5-flash';


const validationSchema = z
  .object({
    Name: z
      .string()
      .describe('Full name of the lead or sender. Empty string if missing.'),
    Email: z
      .string()
      .describe('Email address of the lead. Empty string if missing.'),
    ContactNo: z
      .string()
      .describe('Raw contact number, keep digits and formatting as provided.'),
    Address: z
      .string()
      .describe('Street address or location. Empty string if missing.'),
    Type: z
      .array(z.enum(PROJECT_TYPE_OPTIONS))
      .describe(
        `Project types from the approved list only: ${projectTypeList}. Use [] if missing or unclear.`,
      ),
    Status: z
      .boolean()
      .describe(
        'True if the message is spam, unrelated marketing, an automated bot submission, OR if the message is empty/lacks meaningful content (missing Name, Phone, Location, and Message). False only if it is a genuine real estate inquiry with real intent.',
      ),
    Info: z
      .string()
      .describe(
        'Short summary of the client query or request in their message. Empty string if missing.',
      ),
  })
  .describe('Lead extraction schema from email content.');


const emitLead = tool({
  description: 'Return the extracted lead fields from the email.',
  inputSchema: validationSchema,
  execute: async (input) => input,
});

const instruction =
  'You extract lead details from an email. Use the subject and body to fill ' +
  'the schema fields. Do not invent data. If a value is missing, return an ' +
  'empty string. Info should summarize the client query or request. ' +
  'empty string. Type must be an array of exact strings from this list: ' +
  `${projectTypeList}. Use [] if no clear match. ` +
  'If Type is only "Not Specified", return []. ' +
  'Set Status to false ONLY for genuine customer inquiries about residential ' +
  'construction or real estate work (new home, renovation, granny flat, ' +
  'townhouse, similar) that contain actual project details or questions. ' +
  'Set Status to true for spam, marketing, unrelated services, bot submissions, ' +
  'OR if the message lacks meaningful content (e.g. Name, Phone, Location, and ' +
  'Message are all empty or contain gibberish/random text). ' +
  'An email may carry attachments — plans, sketches, site photos, a written ' +
  'brief. Read them as part of the enquiry: they are often where the address, ' +
  'the project type and the real detail live when the body says little more ' +
  'than "see attached". Always call the emitLead tool with the final fields.';

const leadExtractionAgent = new ToolLoopAgent({
  model: gateway(MODEL_NAME),
  instructions: instruction,
  tools: {
    emitLead,
  },
  toolChoice: {
    type: 'tool',
    toolName: 'emitLead',
  },
});

const requestsPerMinute = Math.max(
  1,
  Number(process.env.GEMINI_RPM ?? '5'),
);
const minIntervalMs = Math.ceil(60000 / requestsPerMinute);
let lastRequestAt = 0;
let throttleQueue: Promise<void> = Promise.resolve();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Serialize Gemini calls per instance to stay under free-tier rate limits.
async function runWithRateLimit<T>(task: () => Promise<T>): Promise<T> {
  const run = async () => {
    const now = Date.now();
    const waitMs = Math.max(0, lastRequestAt + minIntervalMs - now);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    lastRequestAt = Date.now();
    return task();
  };

  const result = throttleQueue.then(run, run);
  throttleQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function normalizeProjectTypes(
  types: ProjectTypeOption[] | null | undefined,
): ProjectTypeOption[] {
  const cleaned = (types ?? []).filter((type) =>
    PROJECT_TYPE_OPTIONS.includes(type),
  );
  const unique = Array.from(new Set(cleaned));
  const filtered = unique.filter((type) => type !== 'Not Specified');
  return filtered.length > 0 ? filtered : [];
}

/**
 * Describes the sender's attachments to the model.
 *
 * The names matter even for files we could not open: "granny-flat-plans.dwg"
 * tells the model an enquiry with a real project behind it arrived, which is
 * the difference between a lead and a message scored as empty and dropped.
 */
function buildAttachmentPrompt(attachments: LeadAttachmentSet): string {
  if (attachments.names.length === 0) {
    return '';
  }

  const unreadable = attachments.skipped.filter((item) =>
    attachments.names.includes(item.name),
  );

  let section =
    '\nAttachments on this email:\n' +
    attachments.names.map((name) => `- ${name}`).join('\n') +
    '\n';

  if (unreadable.length > 0) {
    section +=
      '\nNot included below (' +
      unreadable.map((item) => `${item.name}: ${item.reason}`).join('; ') +
      '). Treat these as attachments that exist but that you cannot read.\n';
  }

  for (const attachment of attachments.attachments) {
    if (attachment.kind === 'text') {
      section += `\nText read from ${attachment.name}:\n${attachment.text}\n`;
    }
  }

  section +=
    '\nAttachment rules:\n' +
    '- Use details from the attachments to fill Name, Email, ContactNo, Address, Type and Info.\n' +
    '- Text read from an attachment is OCR output and may be garbled or incomplete. Use what is legible and do not invent values it does not contain.\n' +
    '- The email body and the attachments describe one enquiry; do not treat an attachment as a separate lead.\n' +
    '- Say in Info what the client sent (for example "attached floor plans for a granny flat").\n' +
    '- A genuine attachment such as plans, a sketch, a site photo or a written brief IS meaningful content: do not set Status = true for a thin body when the attachment carries the enquiry.\n' +
    '- An attachment does not make a message genuine on its own. Invoices, resumes, catalogues and marketing decks are still Status = true.\n';

  return section;
}

export async function extractLeadFromMessage(
  subject: string,
  body: string,
  attachments: LeadAttachmentSet = EMPTY_LEAD_ATTACHMENTS,
): Promise<LeadExtraction | null> {
  if (!leadExtractionAgent) {
    console.warn('Lead extraction skipped: missing Gemini API key');
    return null;
  }

  // 1. Strip the previous email history thread
  const threadBody = stripEmailThread(body);

  const cleanBody = stripHtml(threadBody);

  console.log('Extracting lead from message with subject:', subject.trim());
  console.log('Message body (Cleaned):', cleanBody);
  if (attachments.names.length > 0) {
    console.log(
      `Attachments: ${attachments.names.join(', ')} ` +
        `(${attachments.attachments.length} readable, ${attachments.skipped.length} skipped)`,
    );
  }

  const finalPrompt =
    'Extract the lead data from the email below.\n\n' +
    `Subject:\n${subject.trim()}\n\n` +
    `Body:\n${cleanBody}\n\n` +
    'Info rules:\n' +
    '- Info should summarize the client query or request from the message.\n\n' +
    'Project type rules:\n' +
    `- Type must use exact strings from this list: ${projectTypeList}.\n` +
    '- If missing or unclear, return [].\n' +
    '- If Type is only "Not Specified", return [].\n\n' +
    'Status rules:\n' +
    '- Status = false ONLY for genuine customer inquiries about residential construction or real estate work with actual questions or project intent.\n' +
    '- Status = true for spam, marketing, or unrelated services.\n' +
    '- Status = true for pitches offering marketing, website, SEO, ads, or similar services.\n' +
    '- IMPORTANT: Status = true if the message is empty, or if it lacks meaningful content (e.g., Name, Phone, Location, and Message are all empty, missing, or contain only random/gibberish text like bot submissions). Incomplete forms with no real message are spam.\n\n' +
    buildAttachmentPrompt(attachments) +
    '\nReturn the structured fields only.';

  // Readable binaries ride alongside the prompt as file parts. With none, this
  // is a single text part — exactly what a plain string prompt compiles to.
  const content: Array<TextPart | FilePart> = [{ type: 'text', text: finalPrompt }];
  for (const attachment of attachments.attachments) {
    if (attachment.kind === 'file') {
      content.push({
        type: 'file',
        data: attachment.data,
        mediaType: attachment.mediaType,
        filename: attachment.name,
      });
    }
  }

  const result = await runWithRateLimit(() =>
    leadExtractionAgent.generate({
      messages: [{ role: 'user', content }],
    }),
  );

  //console.log('Lead extraction result:', JSON.stringify(result, null, 2));

  const toolResult = result.toolResults.find(
    (item) => item.type === 'tool-result' && item.toolName === 'emitLead',
  );

  if (!toolResult) {
    return null;
  }

  const output = toolResult.output as z.infer<typeof validationSchema>;
  return {
    Name: output.Name,
    Email: output.Email,
    ContactNo: normalizeContactNumber(output.ContactNo),
    Address: output.Address,
    Type: normalizeProjectTypes(output.Type),
    Status: output.Status,
    Info: output.Info,
  };
}
