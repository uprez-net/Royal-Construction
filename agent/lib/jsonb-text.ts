// What Postgres refuses inside a jsonb value, and its removal (#615).
//
// A NUL (`\u0000`) and a lone surrogate are both refused anywhere in a jsonb
// value, key or string, and the `JSON.stringify` round trip keeps both.

const NUL = /\u0000/g;
// A high surrogate not followed by a low one, or a low one not preceded by a
// high one. `JSON.stringify` writes either as a `\udXXX` escape, which jsonb
// refuses just as it refuses `\u0000`.
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function cleanString(value: string): string {
  return value.replace(NUL, "").replace(LONE_SURROGATE, "�");
}

/**
 * The value with every string and key cleaned. Built with `Object.fromEntries`,
 * which defines own properties: an own `__proto__` key (which `JSON.parse`
 * produces) stays data instead of reaching the inherited setter.
 */
export function cleanJson(value: unknown): unknown {
  if (typeof value === "string") return cleanString(value);
  if (Array.isArray(value)) return value.map(cleanJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        cleanString(key),
        cleanJson(entry),
      ]),
    );
  }
  return value;
}
