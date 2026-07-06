import { generateText } from "ai";
import { gateway } from "@/lib/model";

/**
 * Generates a random phone number with the specified country code. The phone number consists of 9 random digits.
 * @param countryCode - The country code to prepend to the generated phone number. Defaults to "+61" if not provided.
 * @returns A string representing the generated phone number with the country code.
 */
export const randomPhoneNumberGenerator = (
  countryCode: string = "+61"
): string => {
  // Seed using current time
  let seed = Date.now();

  const seededRandom = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  // Generate 9 random digits
  const number = Array.from({ length: 9 }, () =>
    Math.floor(seededRandom() * 10)
  ).join("");

  return `${countryCode}${number}`;
};

export const PIE_CHART_COLORS = [
  "#0D9488", // Teal
  "#2563EB", // Blue
  "#16A34A", // Emerald
  "#7C3AED", // Violet
  "#D97706", // Amber
  "#DC2626", // Red
  "#0891B2", // Cyan
  "#475569", // Slate
  "#4B5563", // Gray
  "#0F172A", // Dark Slate
];

/**
 * Generates a random hex color based on a given key. The same key will always produce the same color.
 * @param key - The input string used to generate the color. Different keys will produce different colors.
 * @returns a hex color string in the format "#RRGGBB".
 */
export const randomColourHexGenerator = (key: string): string => {
  // generate a random number in the range of available colors based on the key
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % PIE_CHART_COLORS.length;
  return PIE_CHART_COLORS[index];
}


/**
 * Generates a deterministic SHA-256 checksum for an email.
 *
 * The checksum is generated from a normalized representation of the
 * email's subject, body, and sender to ensure semantically identical
 * emails produce the same hash despite differences in casing or
 * whitespace.
 *
 * @param subject - Email subject.
 * @param body - Email body.
 * @param from - Sender email address.
 * @returns A hexadecimal SHA-256 checksum.
 */
export async function generateEmailChecksum(
  subject: string,
  body: string,
  from: string,
  to: string,
): Promise<string> {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      // Normalize line endings
      .replace(/\r\n/g, "\n")
      // Remove mailto duplicates:
      // test@gmail.com<mailto:test@gmail.com>
      .replace(
        /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})<mailto:\1>/gi,
        "$1"
      )
      // Remove remaining html tags
      .replace(/<[^>]*>/g, "")
      // Remove invisible chars
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      // Collapse whitespace
      .replace(/\s+/g, " ")
      .trim();

  const payload = JSON.stringify({
    to: normalize(to),
    from: normalize(from),
    subject: normalize(subject),
    body: normalize(body),
  });

  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload)
  );

  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

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
  'use server';
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