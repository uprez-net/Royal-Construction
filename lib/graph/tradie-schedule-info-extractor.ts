import { stripEmailThread, stripHtml } from '@/utils/formatters';
import { z } from 'zod';
import { generateText, Output } from 'ai';
import { gateway } from '../model';


const tradieScheduleInfoSchema = z.object({
    scheduleDate: z.string().describe('The date of the scheduled appointment in YYYY-MM-DD format.'),
    scheduleConfirmation: z.boolean().describe('True if the appointment is confirmed, false otherwise.'),
    scheduleQuote: z.string().optional().describe("The quote provided for the scheduled appointment, if any only in case when standard rates weren't applicable."),
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
4. Project Location: The location of the project or appointment.
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
 * - A quoted price (if one was explicitly provided)
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