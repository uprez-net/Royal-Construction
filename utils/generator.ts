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
  sentAt: string
): Promise<string> {
  const normalize = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/\r\n/g, "\n")
      .replace(/\s+/g, " ");

  const payload = JSON.stringify({
    to: normalize(to),
    from: normalize(from),
    subject: normalize(subject),
    body: normalize(body),
    sentAt: normalize(sentAt),
  });

  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload)
  );

  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}