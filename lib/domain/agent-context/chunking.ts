// Cuts a document's pages into passages the agent's search can embed.
//
// Pure and deterministic, like ./text.ts: the same pages always give the same
// passages, so an unchanged document is never re-embedded. Passages follow the
// document's own structure — they break between paragraphs, before headings
// and between table rows, never mid-word — and carry the pages they came from,
// so the agent can say "page 4 of the survey".

/** About 450 tokens: long enough to hold a clause or a schedule, short enough to rank sharply. */
export const PASSAGE_TARGET_CHARS = 1_800;
/** Text repeated from the end of one passage at the start of the next, so a sentence split across them is still found. */
export const PASSAGE_OVERLAP_CHARS = 200;
/** A 600-page specification is indexed by its first passages rather than costing the night. */
export const MAX_PASSAGES_PER_DOCUMENT = 120;
/**
 * Fewer letters than this is a drawing's dimension labels or a photo's noise.
 * Kept low on purpose: "Site classification: Class M" is a whole finding.
 */
const MIN_LETTERS = 12;

export type Passage = {
  readonly text: string;
  /** 1-based, inclusive. */
  readonly pageFrom: number;
  readonly pageTo: number;
};

type Block = { text: string; page: number };

/**
 * OCR markdown as a reader wants it: no image placeholders
 * ("![img-0.jpeg](img-0.jpeg)"), no runs of blank lines, no trailing spaces.
 */
export function cleanPageText(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function letters(text: string): number {
  return text.match(/\p{L}/gu)?.length ?? 0;
}

/** Cut text at the last space before `max`, or at `max` when there is none. */
function cutAt(text: string, max: number): [string, string] {
  if (text.length <= max) return [text, ""];
  const space = text.lastIndexOf(" ", max);
  const at = space > max / 2 ? space : max;
  return [text.slice(0, at).trimEnd(), text.slice(at).trimStart()];
}

/** A block longer than a passage, split by its lines and then by words. */
function splitLongBlock(block: Block, max: number): Block[] {
  const pieces: Block[] = [];
  let current = "";
  for (const line of block.text.split("\n")) {
    let rest = line;
    while (rest.length > max) {
      if (current) {
        pieces.push({ page: block.page, text: current });
        current = "";
      }
      const [head, tail] = cutAt(rest, max);
      pieces.push({ page: block.page, text: head });
      rest = tail;
    }
    const joined = current ? `${current}\n${rest}` : rest;
    if (joined.length > max && current) {
      pieces.push({ page: block.page, text: current });
      current = rest;
    } else {
      current = joined;
    }
  }
  if (current) pieces.push({ page: block.page, text: current });
  return pieces;
}

function blocksOf(pages: readonly string[], max: number): Block[] {
  const blocks: Block[] = [];
  pages.forEach((raw, index) => {
    const page = index + 1;
    for (const paragraph of cleanPageText(raw).split(/\n\s*\n/)) {
      const text = paragraph.trim();
      if (!text) continue;
      const block = { page, text };
      blocks.push(
        ...(text.length > max ? splitLongBlock(block, max) : [block]),
      );
    }
  });
  return blocks;
}

/** The end of a passage, from a word boundary, to open the next one with. */
function overlapOf(blocks: readonly Block[], size: number): Block[] {
  const last = blocks.at(-1);
  if (!last || size <= 0) return [];
  if (last.text.length <= size) return [last];
  const tail = last.text.slice(-size);
  const space = tail.indexOf(" ");
  const text = (space >= 0 ? tail.slice(space + 1) : tail).trim();
  return text ? [{ page: last.page, text }] : [];
}

function isHeading(text: string): boolean {
  return /^#{1,6}\s/.test(text);
}

/**
 * The passages of a document, in order.
 *
 * `pages` is one string per page, as the reader returned them; empty pages
 * keep their place so page numbers stay true.
 */
export function chunkPages(
  pages: readonly string[],
  options: {
    readonly targetChars?: number;
    readonly overlapChars?: number;
    readonly maxPassages?: number;
  } = {},
): Passage[] {
  const target = options.targetChars ?? PASSAGE_TARGET_CHARS;
  const overlap = Math.min(
    options.overlapChars ?? PASSAGE_OVERLAP_CHARS,
    Math.floor(target / 4),
  );
  const maxPassages = options.maxPassages ?? MAX_PASSAGES_PER_DOCUMENT;

  const passages: Passage[] = [];
  let current: Block[] = [];
  let length = 0;
  /** True while `current` holds only text carried over from the last passage. */
  let onlyOverlap = false;

  const flush = () => {
    if (!current.length || onlyOverlap) return;
    const text = current.map((block) => block.text).join("\n\n");
    if (letters(text) >= MIN_LETTERS) {
      passages.push({
        pageFrom: Math.min(...current.map((block) => block.page)),
        pageTo: Math.max(...current.map((block) => block.page)),
        text,
      });
    }
    current = overlapOf(current, overlap);
    length = current.reduce((sum, block) => sum + block.text.length + 2, 0);
    onlyOverlap = current.length > 0;
  };

  for (const block of blocksOf(pages, target - overlap)) {
    if (passages.length >= maxPassages) break;
    const startsSection = isHeading(block.text) && length >= target / 2;
    if (
      current.length
      && (length + block.text.length > target || startsSection)
    )
      flush();
    current.push(block);
    length += block.text.length + 2;
    onlyOverlap = false;
  }
  if (passages.length < maxPassages) flush();
  return passages.slice(0, maxPassages);
}
