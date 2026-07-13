/**
 * Any value that {@link ObjectToMarkdown} knows how to render.
 *
 * This is a documentation-only type (the function itself accepts a loosely typed
 * `Record<string, unknown>` at the top level so callers aren't forced to satisfy it
 * exactly), but it describes what you can expect to see rendered sensibly:
 * primitives, `Date`s, arrays of `MarkdownValue`, and nested objects of the same shape.
 */
export type MarkdownValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | MarkdownValue[]
  | { [key: string]: MarkdownValue };

/** Options controlling how {@link ObjectToMarkdown} renders a value. */
export interface MarkdownOptions {
  /**
   * Maximum Markdown heading level to emit, from 1 (`#`) to 6 (`######`).
   * Once nesting goes deeper than this, headings simply stop growing (they clamp
   * at this level) rather than producing invalid/oversized heading markup.
   * Values outside 1-6 are clamped into that range.
   * @default 6
   */
  maxHeadingDepth?: number;
  /**
   * Number of spaces used per nesting level when indenting list bullets.
   * Negative values are clamped to 0.
   * @default 2
   */
  bulletIndent?: number;
}

/** Smallest valid Markdown heading level. */
const MIN_HEADING_DEPTH = 1;
/** Largest valid Markdown heading level (`######`). */
const MAX_HEADING_DEPTH = 6;

/**
 * Recursively converts a plain JavaScript object into a human-readable Markdown
 * document.
 *
 * Rendering rules:
 * - Object keys become headings (e.g. `firstName` -> `## First Name`), or bold
 *   inline labels once the nesting depth exceeds `maxHeadingDepth`.
 * - Arrays become Markdown bullet lists; nested arrays/objects are indented
 *   further using `bulletIndent` spaces per level.
 * - `null` / `undefined` render as inline code (`` `null` `` / `` `undefined` ``).
 * - `boolean` renders as "Yes" / "No".
 * - `Date` renders as an ISO-8601 string (or `` `Invalid Date` `` if invalid).
 * - `number` renders as-is, with `NaN` / `Infinity` / `-Infinity` shown as inline code.
 * - `string` has Markdown-sensitive characters (`* _ \` ~ | # > [ ] \`) escaped so
 *   the original text renders literally instead of being interpreted as markup.
 * - `Map` / `Set` / `RegExp` and other non-plain objects are rendered as their
 *   `String(value)` form rather than being recursed into.
 * - Circular references (an object/array that (in)directly contains itself) are
 *   detected via the current recursion path and rendered as a note instead of
 *   causing infinite recursion. Note that the *same* object referenced twice in
 *   two different, non-overlapping branches is **not** circular and renders
 *   normally in both places.
 *
 * @param obj - The object to convert. Must be a plain object at the top level;
 * nested values may be any {@link MarkdownValue} (or effectively `unknown` -
 * unrecognized types fall back to `String(value)`).
 * @param depth - Current nesting depth. Used to compute heading levels and bullet
 * indentation. Callers normally omit this; it defaults to 0 and is incremented
 * internally as the function recurses.
 * @param options - Rendering options. See {@link MarkdownOptions}.
 * @param visited - Internal set tracking objects/arrays currently on the
 * recursion stack, used to detect circular references. Callers should not pass
 * this themselves; it is created fresh per top-level call.
 * @returns The rendered Markdown string, trimmed of leading/trailing whitespace.
 *
 * @example
 * ```ts
 * ObjectToMarkdown({ firstName: "Ada", tags: ["math", "computing"] });
 * // "## First Name\n\nAda\n\n## Tags\n\n- math\n- computing"
 * ```
 *
 * @example Handling circular references
 * ```ts
 * const node: Record<string, unknown> = { name: "root" };
 * node.self = node;
 * ObjectToMarkdown(node);
 * // "## Name\n\nroot\n\n## Self\n\n_Circular reference detected_"
 * ```
 */
export function ObjectToMarkdown(
  obj: Record<string, unknown>,
  depth = 0,
  options: MarkdownOptions = {},
  visited = new WeakSet<object>(),
): string {
  const { maxHeadingDepth = MAX_HEADING_DEPTH, bulletIndent = 2 } = options;

  // Guard against out-of-range options so "#".repeat(n) / " ".repeat(n) never
  // throw (negative n) and never silently produce an empty/invalid heading (n = 0).
  const safeMaxHeadingDepth = Math.min(
    Math.max(Math.trunc(maxHeadingDepth), MIN_HEADING_DEPTH),
    MAX_HEADING_DEPTH,
  );
  const safeBulletIndent = Math.max(Math.trunc(bulletIndent), 0);

  /**
   * Turns a camelCase / PascalCase / snake_case / kebab-case key into a
   * human-readable, capitalized title (e.g. `firstName` -> `First Name`,
   * `user_id` -> `User id`).
   */
  const normalizeKey = (key: string) =>
    key
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^./, (char) => char.toUpperCase());

  /** Escapes characters with special meaning in Markdown so text renders literally. */
  const escapeMarkdown = (value: string) => value.replace(/([*_`~|#>[\]\\])/g, "\\$1");

  /** Renders `title` as a heading, with the level clamped to `safeMaxHeadingDepth`. */
  const heading = (title: string, level: number) => {
    const headingLevel = Math.min(level + 2, safeMaxHeadingDepth);
    return `${"#".repeat(headingLevel)} ${normalizeKey(title)}\n\n`;
  };

  /** Type guard for values that should be treated as recursible plain objects. */
  const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof Map) &&
    !(value instanceof Set) &&
    !(value instanceof RegExp);

  /** Renders a single non-object, non-array value inline. */
  const renderPrimitive = (value: unknown): string => {
    if (value === null) return "`null`";
    if (value === undefined) return "`undefined`";
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? "`Invalid Date`" : value.toISOString();
    }
    if (typeof value === "string") return escapeMarkdown(value);
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "number") {
      if (Number.isNaN(value)) return "`NaN`";
      if (!Number.isFinite(value)) return value > 0 ? "`Infinity`" : "`-Infinity`";
      return String(value);
    }
    // Map, Set, RegExp, class instances, functions, symbols, bigints, etc.
    return escapeMarkdown(String(value));
  };

  /** Renders an array as a Markdown bullet list, recursing into nested arrays/objects. */
  const renderArray = (arr: unknown[], currentDepth: number): string => {
    if (visited.has(arr)) {
      return "_Circular reference detected_\n\n";
    }
    if (arr.length === 0) {
      return "_No items_\n\n";
    }
    visited.add(arr);
    try {
      return arr
        .map((item, index) => {
          const indent = " ".repeat(currentDepth * safeBulletIndent);
          if (Array.isArray(item)) {
            return `${indent}- Item ${index + 1}\n` + renderArray(item, currentDepth + 1);
          }
          if (isPlainObject(item)) {
            return `${indent}- **Item ${index + 1}**\n\n` + renderObject(item, currentDepth + 1);
          }
          return `${indent}- ${renderPrimitive(item)}`;
        })
        .join("\n")
        .concat("\n\n");
    } finally {
      // Only guards against true cycles (this array appearing inside itself), not
      // against the same array being referenced again from an unrelated branch.
      visited.delete(arr);
    }
  };

  /** Renders a plain object's entries as headings/labels, recursing into nested values. */
  const renderObject = (object: Record<string, unknown>, currentDepth: number): string => {
    if (visited.has(object)) {
      return "_Circular reference detected_\n\n";
    }
    visited.add(object);
    try {
      const entries = Object.entries(object);
      if (entries.length === 0) {
        return "_No data_\n\n";
      }
      return entries
        .map(([key, value]) => {
          if (Array.isArray(value)) {
            return heading(key, currentDepth) + renderArray(value, currentDepth);
          }
          if (isPlainObject(value)) {
            return heading(key, currentDepth) + renderObject(value, currentDepth + 1);
          }
          return `**${normalizeKey(key)}:** ${renderPrimitive(value)}\n`;
        })
        .join("\n");
    } finally {
      visited.delete(object);
    }
  };

  return renderObject(obj, depth).trim();
}