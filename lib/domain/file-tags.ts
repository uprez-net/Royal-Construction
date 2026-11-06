// What a file's tags and origin may hold. A leaf with no imports: the upload
// controls normalise in the browser so the payload stays small, and saveFile
// normalises again because the browser's copy is not to be trusted.

/** More than this and a tag column stops being a hint and becomes noise. */
export const MAX_FILE_TAGS = 12;
export const MAX_FILE_TAG_LENGTH = 48;
export const MAX_FILE_ORIGIN_LENGTH = 200;

/** Joins the steps of an origin trail: "Project › Compliance › Survey". */
export const FILE_ORIGIN_SEPARATOR = " › ";

/** The upload hints one upload carries. */
export type FileUploadHints = {
  readonly tags: readonly string[];
  readonly origin: string | null;
};

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  // Control characters and runs of whitespace collapse to one space, so a tag
  // typed with a stray newline matches the one typed without it.
  const text = value.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Trim, collapse, drop empties and duplicates (case-insensitively, keeping the
 * first spelling), and cap the count. Order is kept: the first tags are the
 * screen's, and they are the ones worth showing when space runs out.
 */
export function normalizeFileTags(
  ...lists: ReadonlyArray<readonly unknown[] | null | undefined>
): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const list of lists) {
    for (const value of list ?? []) {
      const tag = clean(value, MAX_FILE_TAG_LENGTH);
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
      if (tags.length === MAX_FILE_TAGS) return tags;
    }
  }
  return tags;
}

export function normalizeFileOrigin(value: unknown): string | null {
  return clean(value, MAX_FILE_ORIGIN_LENGTH);
}

/** An origin trail from its steps, skipping empty ones. */
export function joinFileOrigin(
  steps: ReadonlyArray<string | null | undefined | false>,
): string | null {
  return normalizeFileOrigin(
    steps
      .filter((step): step is string => typeof step === "string")
      .map((step) => step.trim())
      .filter(Boolean)
      .join(FILE_ORIGIN_SEPARATOR),
  );
}

/** Both hints, normalised, from whatever the caller was handed. */
export function normalizeFileUploadHints(input: {
  readonly tags?: readonly unknown[] | null;
  readonly origin?: unknown;
}): FileUploadHints {
  return {
    tags: normalizeFileTags(input.tags),
    origin: normalizeFileOrigin(input.origin),
  };
}

/**
 * Words in a file name that say what the document is. Matched as whole words,
 * so "planning" does not read as "plan".
 */
const NAME_KEYWORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\btenders?\b/, "Tender"],
  [/\bcontracts?\b/, "Contract"],
  [/\binvoices?\b|\binv\b/, "Invoice"],
  [/\bquotes?\b|\bquotations?\b/, "Quote"],
  [/\breceipts?\b/, "Receipt"],
  [/\bplans?\b|\bdrawings?\b|\belevations?\b|\bfloorplan\b/, "Plans"],
  [/\bsurvey\b/, "Survey"],
  [/\binsurance\b|\bhbcf\b/, "Insurance"],
  [/\bcertificates?\b|\bcert\b|\bcdc\b/, "Certificate"],
  [/\bpermits?\b|\bapprovals?\b/, "Approval"],
  [/\bvariations?\b/, "Variation"],
  [/\bbasix\b/, "BASIX"],
  [/\bbushfire\b|\bbal\b/, "Bushfire"],
  [/\bsoil\b|\bgeotech\w*\b/, "Soil report"],
];

/** Tags read off the name and type, for files nobody tagged. */
export function inferFileTags(
  name: string,
  fileType: string | null | undefined,
): string[] {
  const words = name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9]+/g, " ");
  const tags = NAME_KEYWORDS.filter(([pattern]) => pattern.test(words)).map(
    ([, tag]) => tag,
  );
  if (fileType?.startsWith("image/")) tags.push("Photo");
  return tags;
}
