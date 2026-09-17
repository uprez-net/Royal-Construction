/**
 * Tidies a phone number without reinterpreting it.
 *
 * This used to run the digits through `Number()`, which silently rewrote every
 * number it touched: "0433100349" came out 433100349, "+61 433 100 349" lost
 * the plus that made it international, and anything past 15 digits came out
 * arithmetically wrong or in exponential notation. A phone number is a string
 * of symbols, not a quantity, so the only safe normalization is whitespace.
 *
 * Returns '' when there is no digit to keep, so the caller stores an empty
 * phone rather than the literal "0" the old `Number()` path produced.
 *
 * Lives apart from the extractor so it can be tested without loading the AI
 * gateway, which throws at import when its key is unset.
 */
export function normalizeContactNumber(
  value: string | null | undefined,
): string {
  const collapsed = (value ?? "").replace(/\s+/g, " ").trim();
  return /\d/.test(collapsed) ? collapsed : "";
}
