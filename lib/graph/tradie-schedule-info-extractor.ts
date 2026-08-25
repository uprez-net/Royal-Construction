import { stripEmailThread, stripHtml } from '@/utils/formatters';
import { z } from 'zod';
import { generateText, Output } from 'ai';
import { gateway } from '../model';


const tradieScheduleInfoSchema = z.object({
    scheduleDate: z.string().describe('The date of the scheduled appointment in YYYY-MM-DD format.'),
    scheduleConfirmation: z.boolean().describe('True if the appointment is confirmed, false otherwise.'),
    scheduleQuote: z.string().optional().describe("The bare quoted amount for the scheduled appointment, if any, only in case when standard rates weren't applicable. Amount only, no unit words and no other numbers. eg. $5000.00"),
    scheduleQuoteBasis: z
        .enum(['FIXED', 'HOURLY', 'DAILY'])
        .optional()
        .describe(
            "What the quoted amount is charged against: FIXED for the whole job, HOURLY per hour, DAILY per day. Only set when scheduleQuote is set.",
        ),
    projectLocation: z.string().describe('The location of the project or appointment.'),
});

type TradieScheduleInfo = z.infer<typeof tradieScheduleInfoSchema>;

/**
 * System prompt used to instruct the AI model how to extract structured
 * tradie scheduling information from an email.
 */
const INSTRUCTION = `
You are an AI assistant that extracts tradie schedule information from email content. 
The email content may contain HTML formatting, quoted replies, and signatures. 
Your task is to extract the following information:
1. Schedule Date: The date of the scheduled appointment in YYYY-MM-DD format.
2. Schedule Confirmation: A boolean indicating whether the appointment is confirmed (true) or not (false).
3. Schedule Quote: The quote provided for the scheduled appointment, if any. This field is optional and should only be included if standard rates weren't applicable.
   Return the amount on its own - currency symbol and digits only, e.g. "$5000.00". Do NOT include unit words ("per day", "/hr"), a duration, a reference number, or a second amount. If the email contains more than one price and you cannot tell which is the quote, omit this field.
4. Schedule Quote Basis: How that amount is charged. Only include it when Schedule Quote is included. Use exactly one of:
   - FIXED: a lump sum for the whole job ("$5,000 for the job", "all up", "total", "supply and install").
   - HOURLY: a rate per hour ("$120/hr", "$120 an hour", "plus GST per hour").
   - DAILY: a rate per day ("$950 a day", "$950 per day", "day rate").
   If the tradie states an amount with no basis at all, treat it as FIXED - a quote for a specific job is a lump sum unless they say otherwise.
5. Project Location: The location of the project or appointment.
`
/**
 * Extracts structured tradie scheduling information from an email message using an AI model.
 *
 * Before extraction, the email body is cleaned by removing quoted reply threads,
 * signatures, HTML markup, and other formatting to ensure only the latest message
 * content is analyzed.
 *
 * The AI returns the following information when available:
 * - Scheduled appointment date
 * - Whether the appointment was confirmed
 * - A quoted price (if one was explicitly provided) and how it is charged
 *   (whole job, per hour, or per day)
 * - The project location
 *
 * If the extraction fails or the model cannot produce a valid response,
 * `null` is returned.
 *
 * @param subject - The email subject line.
 * @param content - The raw email body, which may contain HTML, reply history, and signatures.
 * @returns A promise that resolves to the extracted schedule information, or `null` if extraction fails.
 */
export async function extractTradieScheduleInfoFromMessage(
    subject: string,
    content: string,
): Promise<TradieScheduleInfo | null> {
    try {
        // 1. Strip the previous email history thread
        const threadBody = stripEmailThread(content);
        const cleanBody = stripHtml(threadBody);

        const { output } = await generateText({
            model: gateway("google/gemini-2.5-flash"),
            system: INSTRUCTION,
            temperature: 0.15,
            topK: 20,
            prompt: `
                Subject: ${subject}
                Email Body: ${cleanBody}

                Please extract the tradie schedule information in JSON format according to the schema:
            `,
            output: Output.object({
                schema: tradieScheduleInfoSchema,
            }),

        })

        return output as TradieScheduleInfo;
    } catch (error) {
        console.error('Error extracting tradie schedule info:', error);
        return null;
    }
}