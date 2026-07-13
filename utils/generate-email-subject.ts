'use server';
import { generateText } from "ai";
import { gateway } from "@/lib/model";

/**
 * Generates a short, professional email subject line from raw email content.
 *
 * This utility uses an AI model to infer the main intent/context of an email
 * body and convert it into a concise subject suitable for email threads,
 * notifications, and project-related communication.
 *
 * Processing steps:
 * - Normalizes whitespace in the provided email body.
 * - Truncates the input content to reduce token usage and avoid sending
 *   unnecessarily large email threads to the AI model.
 * - Generates a deterministic, business-friendly subject line.
 * - Removes unwanted AI formatting artifacts such as:
 *   - "Subject:" prefixes
 *   - Wrapping quotation marks
 *
 * Subject generation constraints:
 * - Maximum length of 8 words.
 * - No marketing-style language.
 * - No extra explanations or formatting.
 *
 * @param body - Raw email body/content used as context for subject generation.
 *
 * @returns A cleaned subject line generated from the email content.
 * Falls back to `"Project Inquiry"` if the generated output is empty.
 *
 * @example
 * ```ts
 * const subject = await generateEmailSubject(
 *   "Hi, I would like a quote for a kitchen renovation..."
 * );
 *
 * console.log(subject);
 * // Output: "Kitchen Renovation Quote Request"
 * ```
 */
export async function generateEmailSubject(body: string): Promise<string> {

    const cleanBody = body
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 3000);

    const result = await generateText({
        model: gateway("google/gemini-2.5-flash"),
        prompt: `
Generate a clear professional email subject line.

Rules:
- Maximum 8 words
- No quotation marks
- Do not prefix with "Subject:"
- Keep it specific to the email
- Avoid marketing language

Email:
${cleanBody}
`,
        temperature: 0.2,
        maxOutputTokens: 30,
    });

    return (
        result.text
            ?.replace(/^subject:\s*/i, "")
            .replace(/["']/g, "")
            .trim()
        ||
        "Project Inquiry"
    );
}