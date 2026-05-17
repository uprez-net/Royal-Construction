import { ToolLoopAgent, tool } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';

export interface LeadExtraction {
  Name: string;
  Email: string;
  ContactNo: number;
  Address: string;
  Status: boolean;
  Info: string;
}

const MODEL_NAME = 'gemini-2.5-flash';
const apiKey =
  process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const googleProvider = apiKey ? createGoogleGenerativeAI({ apiKey }) : null;

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
    Status: z
      .boolean()
      .describe(
        'True if the message is spam or unrelated marketing; false if it is a genuine real estate inquiry (new home, renovation, granny flat, townhouse, similar).',
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
  'empty string. Set Status to false for genuine customer inquiries about ' +
  'residential construction or real estate work (new home, renovation, granny ' +
  'flat, townhouse, similar). Set Status to true for spam, marketing, or ' +
  'unrelated services. Always call the emitLead tool with the final fields.';

const leadExtractionAgent = googleProvider
  ? new ToolLoopAgent({
    model: googleProvider(MODEL_NAME),
    instructions: instruction,
    tools: {
      emitLead,
    },
    toolChoice: {
      type: 'tool',
      toolName: 'emitLead',
    },
  })
  : null;

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

export async function extractLeadFromMessage(
  subject: string,
  body: string,
): Promise<LeadExtraction | null> {
  if (!leadExtractionAgent) {
    console.warn('Lead extraction skipped: missing Gemini API key');
    return null;
  }

  console.log('Extracting lead from message with subject:', subject.trim());
  console.log('Message body:', body.trim());

  const finalPrompt =
    'Extract the lead data from the email below.\n\n' +
    `Subject:\n${subject.trim()}\n\n` +
    `Body:\n${body.trim()}\n\n` +
    'Info rules:\n' +
    '- Info should summarize the client query or request from the message.\n\n' +
    'Status rules:\n' +
    '- Status = false for genuine customer inquiries about residential construction or real estate work (new home, renovation, granny flat, townhouse, similar).\n' +
    '- Status = true for spam, marketing, or unrelated services.\n\n' +
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
    Status: output.Status,
    Info: output.Info,
  };
}
