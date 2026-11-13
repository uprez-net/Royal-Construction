import assert from "node:assert/strict";
import { test } from "vitest";

import {
  MAX_PASSAGES_PER_DOCUMENT,
  chunkPages,
  cleanPageText,
} from "@/lib/domain/agent-context/chunking";

// Uploaded documents are cut into passages before they are embedded. The cut
// has to be reproducible (an unchanged document is never re-embedded), keep
// page numbers true (the agent cites them), and never split a word.

const sentence = (n: number) =>
  `Clause ${n}: the builder shall provide the certificate within ten business days of completion.`;

test("a short document is one passage on its page", () => {
  const passages = chunkPages([`# Survey report\n\n${sentence(1)}`]);
  assert.deepEqual(passages, [
    {
      pageFrom: 1,
      pageTo: 1,
      text: `# Survey report\n\n${sentence(1)}`,
    },
  ]);
});

test("passages carry the pages they span, and empty pages keep their place", () => {
  const page = Array.from({ length: 12 }, (_, i) => sentence(i)).join("\n\n");
  const passages = chunkPages(["", page, page], { targetChars: 1_200 });
  assert.ok(passages.length > 2);
  assert.equal(passages[0]!.pageFrom, 2, "the empty first page still counts");
  assert.equal(passages.at(-1)!.pageTo, 3);
  for (const passage of passages) {
    assert.ok(passage.pageFrom <= passage.pageTo);
    assert.ok(passage.text.length <= 1_200 + 2);
  }
});

test("consecutive passages overlap, so a split sentence is still found", () => {
  const page = Array.from({ length: 20 }, (_, i) => sentence(i)).join("\n\n");
  const [first, second] = chunkPages([page], {
    overlapChars: 120,
    targetChars: 600,
  });
  const tail = first!.text.slice(-60);
  assert.ok(second!.text.includes(tail.slice(tail.indexOf(" ") + 1)));
});

test("a passage never ends mid-word, even inside one long paragraph", () => {
  const long = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
  const passages = chunkPages([long], { overlapChars: 0, targetChars: 500 });
  assert.ok(passages.length > 1);
  const words = new Set(long.split(" "));
  for (const passage of passages) {
    for (const word of passage.text.split(/\s+/)) {
      assert.ok(words.has(word), `"${word}" was cut`);
    }
  }
});

test("a heading starts a new passage once the current one has substance", () => {
  const body = Array.from({ length: 6 }, (_, i) => sentence(i)).join("\n\n");
  const passages = chunkPages([`${body}\n\n## Site classification\n\nClass M.`], {
    overlapChars: 0,
    targetChars: 1_000,
  });
  assert.ok(passages.at(-1)!.text.startsWith("## Site classification"));
});

test("a table is split between rows, not through them", () => {
  const rows = Array.from(
    { length: 80 },
    (_, i) => `| Room ${i} | ${3 + (i % 4)}.2 m | Tiled floor |`,
  );
  const passages = chunkPages([["| Room | Width | Finish |", ...rows].join("\n")], {
    overlapChars: 0,
    targetChars: 800,
  });
  assert.ok(passages.length > 1);
  for (const passage of passages) {
    for (const line of passage.text.split("\n")) {
      assert.match(line, /^\|.*\|$/);
    }
  }
});

test("OCR noise is dropped: image placeholders, and pages with almost no words", () => {
  assert.equal(
    cleanPageText("![img-0.jpeg](img-0.jpeg)\n\n\n\nLot 12   \n"),
    "Lot 12",
  );
  // A drawing sheet OCRs as dimension labels.
  assert.deepEqual(chunkPages(["3600\n\n2400 900\n\nA-01"]), []);
});

test("a very long document is capped, and the cut is reproducible", () => {
  const page = Array.from({ length: 30 }, (_, i) => sentence(i)).join("\n\n");
  const pages = Array.from({ length: 200 }, () => page);
  const first = chunkPages(pages);
  assert.equal(first.length, MAX_PASSAGES_PER_DOCUMENT);
  assert.deepEqual(chunkPages(pages), first);
});
