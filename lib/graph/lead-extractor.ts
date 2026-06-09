import { ToolLoopAgent, tool } from 'ai';
import { google } from '../google';
import { z } from 'zod';

export interface LeadExtraction {
  Name: string;
  Email: string;
  ContactNo: number;
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

const MODEL_NAME = 'gemini-2.5-flash';


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

function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ') // Remove style blocks
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ') // Remove script blocks
    .replace(/<[^>]+>/g, ' ') // Remove all HTML tags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s{2,}/g, ' ') // Collapse multiple spaces/newlines into one space
    .trim();
}

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
  'Message are all empty or contain gibberish/random text). Always call the emitLead tool ' +
  'with the final fields.';

const leadExtractionAgent = new ToolLoopAgent({
  model: google(MODEL_NAME),
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

function normalizeContactNumber(value: string): number {
  const digits = value.replace(/\D/g, '');
  if (!digits) {
    return 0;
  }

  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : 0;
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

export async function extractLeadFromMessage(
  subject: string,
  body: string,
): Promise<LeadExtraction | null> {
  if (!leadExtractionAgent) {
    console.warn('Lead extraction skipped: missing Gemini API key');
    return null;
  }

  const cleanBody = stripHtml(body);

  console.log('Extracting lead from message with subject:', subject.trim());
  console.log('Message body (Cleaned):', cleanBody);

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
    'Return the structured fields only.';

  const result = await runWithRateLimit(() =>
    leadExtractionAgent.generate({
      prompt: finalPrompt,
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