// How the record index and the document index rank a request: the words worth
// matching by name, and how much an exact match adds to the embedding score.

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "what",
  "whats",
  "where",
  "when",
  "who",
  "how",
  "job",
  "lead",
  "project",
  "offer",
  "about",
  "please",
  "can",
  "you",
  "our",
  "have",
  "has",
  "are",
  "was",
  "any",
  "all",
  "show",
  "tell",
  "give",
  "find",
  "get",
  "status",
  "update",
  "today",
]);

/** The words in a request worth matching against a record's name. */
export function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
    ),
  ].slice(0, 8);
}

/** Exact-name evidence: embeddings are weak on surnames and street names. */
export function lexicalBoost(
  terms: readonly string[],
  title: string,
  content: string,
) {
  if (!terms.length) return 0;
  const t = title.toLowerCase();
  const c = content.toLowerCase();
  const inTitle = terms.filter((term) => t.includes(term)).length;
  const inContent = terms.filter((term) => c.includes(term)).length;
  return Math.min(0.45, inTitle * 0.2 + (inContent - inTitle) * 0.04);
}
