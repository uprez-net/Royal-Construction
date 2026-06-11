# Offer Document AI Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build versioned offer document editing with controlled rich-text sections and AI-assisted review/apply flows.

**Architecture:** Keep structured offer data as the source of truth and use Plate only as the editing surface for rich-text sections. AI chat produces explicit patches that users review before saving a new offer version. Pricing and line items stay in structured `OfferItem` rows so totals, GST, exports, and audit trails remain deterministic.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7, PostgreSQL, PlateJS, AI SDK, Gemini, existing `OfferFile.offerContent Json`, `OfferItem`, `ChatSession`, and Graph/PDF utilities.

---

## File Structure

- Modify: `prisma/schema.prisma`
  - Add an offer version snapshot/audit model if the existing `OfferFile` cannot carry edit metadata cleanly.
  - Add optional fields to track editor JSON, plain-text fallback, author, and AI patch metadata.
- Create: `prisma/migrations/<timestamp>_offer_document_editor/migration.sql`
  - Add the schema changes for offer editor state and AI patch audit.
- Modify: `context/ChatContext.tsx`
  - Hold current offer structured content, editor draft state, version records, and pending AI patches.
- Modify: `components/offers/offer/offer-file.tsx`
  - Replace iframe-only preview flow with an edit/preview split for rich-text offer sections.
  - Keep the existing PDF generation path for accepted versions.
- Modify: `components/offers/offer/file-template.tsx`
  - Render structured sections from accepted offer content only.
  - Add static rendering support for Plate JSON sections.
- Create: `components/offers/offer/offer-section-editor.tsx`
  - Plate editor wrapper for one offer text section.
  - Emits Plate JSON and plain text back to the offer canvas.
- Create: `components/offers/offer/offer-ai-patch-review.tsx`
  - Shows AI-generated section changes with apply/reject controls.
- Create: `lib/offers/offer-content.ts`
  - Defines server-safe offer content types, parsing, and plain-text extraction.
- Create: `lib/offers/offer-versioning.ts`
  - Computes next version number and builds version snapshots.
- Modify: `lib/data/offers.ts`
  - Save accepted rich-text sections, AI patch metadata, line items, and file records transactionally.
- Modify: `lib/tools/offer-file.ts`
  - Return structured patches for rich-text sections instead of silently replacing full document content.
- Create: `lib/tools/offer-ai-patch.ts`
  - Zod schema and helper for AI edit proposals against a named offer section.
- Create: `tests/offer/offer-content.test.ts`
  - Covers parsing, fallback text extraction, and invalid payload rejection.
- Create: `tests/offer/offer-versioning.test.ts`
  - Covers next version calculation and immutable snapshot building.
- Create: `tests/offer/tools/offer-ai-patch.test.ts`
  - Covers allowed patch shapes and rejection of pricing-table edits through rich text.

---

### Task 1: Add Offer Content Types and Fallback Extraction

**Files:**
- Create: `lib/offers/offer-content.ts`
- Create: `tests/offer/offer-content.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/offer/offer-content.test.ts
import { describe, expect, it } from "vitest";
import {
  extractPlatePlainText,
  offerTextSectionSchema,
  parseOfferTextSection,
} from "@/lib/offers/offer-content";

describe("offer content sections", () => {
  it("extracts plain text from a Plate value", () => {
    const value = [
      {
        type: "p",
        children: [
          { text: "Build a " },
          { text: "custom home", bold: true },
          { text: "." },
        ],
      },
      {
        type: "p",
        children: [{ text: "Includes council coordination." }],
      },
    ];

    expect(extractPlatePlainText(value)).toBe(
      "Build a custom home.\nIncludes council coordination.",
    );
  });

  it("parses a rich text section and stores a plain text fallback", () => {
    const section = parseOfferTextSection({
      json: [{ type: "p", children: [{ text: "Deposit due on acceptance." }] }],
    });

    expect(section.plainText).toBe("Deposit due on acceptance.");
    expect(offerTextSectionSchema.parse(section)).toEqual(section);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/offer/offer-content.test.ts`
Expected: FAIL because `lib/offers/offer-content.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/offers/offer-content.ts
import { z } from "zod";

type PlateNode = {
  text?: string;
  children?: PlateNode[];
};

export const offerTextSectionSchema = z.object({
  json: z.array(z.unknown()),
  plainText: z.string(),
});

export type OfferTextSection = z.infer<typeof offerTextSectionSchema>;

function collectText(node: PlateNode): string {
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.children)) return "";
  return node.children.map(collectText).join("");
}

export function extractPlatePlainText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((node) => collectText(node as PlateNode).trim())
    .filter(Boolean)
    .join("\n");
}

export function parseOfferTextSection(input: { json: unknown }): OfferTextSection {
  const json = Array.isArray(input.json) ? input.json : [];
  return offerTextSectionSchema.parse({
    json,
    plainText: extractPlatePlainText(json),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/offer/offer-content.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/offers/offer-content.ts tests/offer/offer-content.test.ts
git commit -m "Define offer rich text content sections

Offer text sections need a stable JSON source plus plain text fallback so
AI prompts, exports, and search do not depend on UI rendering.

Confidence: high
Scope-risk: narrow
Tested: pnpm test tests/offer/offer-content.test.ts"
```

---

### Task 2: Add Version Snapshot Helpers

**Files:**
- Create: `lib/offers/offer-versioning.ts`
- Create: `tests/offer/offer-versioning.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/offer/offer-versioning.test.ts
import { describe, expect, it } from "vitest";
import { buildOfferVersionSnapshot, getNextOfferVersion } from "@/lib/offers/offer-versioning";

describe("offer versioning", () => {
  it("calculates the next version from existing records", () => {
    expect(getNextOfferVersion([{ version: 1 }, { version: 3 }, { version: 2 }])).toBe(4);
    expect(getNextOfferVersion([])).toBe(1);
  });

  it("builds immutable snapshot metadata", () => {
    const snapshot = buildOfferVersionSnapshot({
      offerId: "offer_123",
      version: 2,
      authorId: "user_123",
      reason: "AI patch accepted",
      content: { projectDescription: { plainText: "New scope", json: [] } },
    });

    expect(snapshot.offerId).toBe("offer_123");
    expect(snapshot.version).toBe(2);
    expect(snapshot.reason).toBe("AI patch accepted");
    expect(snapshot.content).toEqual({
      projectDescription: { plainText: "New scope", json: [] },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/offer/offer-versioning.test.ts`
Expected: FAIL because `lib/offers/offer-versioning.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/offers/offer-versioning.ts
type VersionedRecord = { version: number };

export function getNextOfferVersion(records: VersionedRecord[]) {
  if (records.length === 0) return 1;
  return Math.max(...records.map((record) => record.version)) + 1;
}

export function buildOfferVersionSnapshot(input: {
  offerId: string;
  version: number;
  authorId: string;
  reason: string;
  content: unknown;
}) {
  return {
    offerId: input.offerId,
    version: input.version,
    authorId: input.authorId,
    reason: input.reason,
    content: input.content,
    createdAt: new Date(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/offer/offer-versioning.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/offers/offer-versioning.ts tests/offer/offer-versioning.test.ts
git commit -m "Add offer version snapshot helpers

Offer document edits need predictable version numbers and immutable
metadata before wiring the editor into persistence.

Confidence: high
Scope-risk: narrow
Tested: pnpm test tests/offer/offer-versioning.test.ts"
```

---

### Task 3: Add AI Patch Schema for Offer Text Sections

**Files:**
- Create: `lib/tools/offer-ai-patch.ts`
- Create: `tests/offer/tools/offer-ai-patch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/offer/tools/offer-ai-patch.test.ts
import { describe, expect, it } from "vitest";
import { offerAiPatchSchema } from "@/lib/tools/offer-ai-patch";

describe("offer AI patch schema", () => {
  it("allows patches to editable text sections", () => {
    const patch = offerAiPatchSchema.parse({
      section: "paymentTerms",
      changeSummary: "Changed payment terms to five stages.",
      replacementMarkdown: "1. Deposit on acceptance\n2. Slab stage\n3. Frame stage\n4. Lock-up stage\n5. Final payment",
    });

    expect(patch.section).toBe("paymentTerms");
  });

  it("rejects pricing table edits through rich text patches", () => {
    expect(() =>
      offerAiPatchSchema.parse({
        section: "lineItems",
        changeSummary: "Discounted all prices.",
        replacementMarkdown: "Everything is now cheaper.",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/offer/tools/offer-ai-patch.test.ts`
Expected: FAIL because `lib/tools/offer-ai-patch.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/tools/offer-ai-patch.ts
import { z } from "zod";

export const editableOfferTextSections = [
  "projectDescription",
  "paymentTerms",
  "termsAndConditions",
  "serviceInclusions",
  "serviceExclusions",
  "serviceExclusionsFootnote",
] as const;

export const offerAiPatchSchema = z.object({
  section: z.enum(editableOfferTextSections),
  changeSummary: z.string().trim().min(1),
  replacementMarkdown: z.string().trim().min(1),
});

export type OfferAiPatch = z.infer<typeof offerAiPatchSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/offer/tools/offer-ai-patch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tools/offer-ai-patch.ts tests/offer/tools/offer-ai-patch.test.ts
git commit -m "Constrain AI offer edits to text sections

AI patches should not mutate pricing tables through free-form rich text,
so line item edits remain in structured tools.

Rejected: Let AI rewrite the full offer document | pricing and GST would become unauditable
Confidence: high
Scope-risk: narrow
Tested: pnpm test tests/offer/tools/offer-ai-patch.test.ts"
```

---

### Task 4: Render Editable Offer Sections With Plate

**Files:**
- Create: `components/offers/offer/offer-section-editor.tsx`
- Modify: `components/offers/offer/offer-file.tsx`
- Modify: `context/ChatContext.tsx`

- [ ] **Step 1: Write the failing component smoke test**

```tsx
// tests/offer/offer-section-editor.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OfferSectionEditor } from "@/components/offers/offer/offer-section-editor";

describe("OfferSectionEditor", () => {
  it("renders the editable section label and initial text", () => {
    render(
      <OfferSectionEditor
        label="Payment Terms"
        value={[{ type: "p", children: [{ text: "Deposit on acceptance." }] }]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Payment Terms")).toBeInTheDocument();
    expect(screen.getByText("Deposit on acceptance.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/offer/offer-section-editor.test.tsx`
Expected: FAIL because `OfferSectionEditor` does not exist.

- [ ] **Step 3: Write minimal implementation**

```tsx
// components/offers/offer/offer-section-editor.tsx
"use client";

import { Plate, usePlateEditor } from "platejs/react";
import type { Value } from "platejs";

import { RichTextEditorSurface } from "@/components/rich-text/rich-text-editor-surface";

type OfferSectionEditorProps = {
  label: string;
  value: Value;
  onChange: (value: Value) => void;
};

export function OfferSectionEditor({ label, value, onChange }: OfferSectionEditorProps) {
  const editor = usePlateEditor({ value });

  return (
    <section className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <Plate editor={editor} onChange={({ value: nextValue }) => onChange(nextValue)}>
        <RichTextEditorSurface placeholder={`Edit ${label.toLowerCase()}...`} />
      </Plate>
    </section>
  );
}
```

- [ ] **Step 4: Wire the editor into the offer canvas**

In `components/offers/offer/offer-file.tsx`, add an edit mode beside the existing preview and render `OfferSectionEditor` for `projectDescription`, `paymentTerms`, and `serviceExclusionsFootnote`. Keep the existing iframe preview as the customer-facing view.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm test tests/offer/offer-section-editor.test.tsx && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/offers/offer/offer-section-editor.tsx components/offers/offer/offer-file.tsx context/ChatContext.tsx tests/offer/offer-section-editor.test.tsx
git commit -m "Add Plate editing surface for offer text sections

Offer documents need controlled rich text editing without turning pricing
tables into free-form content.

Constraint: Line items remain structured OfferItem rows
Confidence: medium
Scope-risk: moderate
Tested: pnpm test tests/offer/offer-section-editor.test.tsx && pnpm typecheck"
```

---

### Task 5: Add AI Patch Review and Version Save

**Files:**
- Create: `components/offers/offer/offer-ai-patch-review.tsx`
- Modify: `components/offers/offer/offer-chat.tsx`
- Modify: `components/offers/offer/offer-file.tsx`
- Modify: `lib/tools/offer-file.ts`
- Modify: `lib/data/offers.ts`

- [ ] **Step 1: Write the failing component test**

```tsx
// tests/offer/offer-ai-patch-review.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OfferAiPatchReview } from "@/components/offers/offer/offer-ai-patch-review";

describe("OfferAiPatchReview", () => {
  it("lets users apply or reject an AI patch", () => {
    const onApply = vi.fn();
    const onReject = vi.fn();

    render(
      <OfferAiPatchReview
        patch={{
          section: "paymentTerms",
          changeSummary: "Changed to staged payments.",
          replacementMarkdown: "Deposit, frame, lock-up, final.",
        }}
        onApply={onApply}
        onReject={onReject}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply change" }));
    expect(onApply).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onReject).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/offer/offer-ai-patch-review.test.tsx`
Expected: FAIL because `OfferAiPatchReview` does not exist.

- [ ] **Step 3: Write minimal implementation**

```tsx
// components/offers/offer/offer-ai-patch-review.tsx
"use client";

import type { OfferAiPatch } from "@/lib/tools/offer-ai-patch";

type OfferAiPatchReviewProps = {
  patch: OfferAiPatch;
  onApply: () => void;
  onReject: () => void;
};

export function OfferAiPatchReview({ patch, onApply, onReject }: OfferAiPatchReviewProps) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
      <div className="text-sm font-semibold text-slate-900">{patch.changeSummary}</div>
      <div className="mt-2 whitespace-pre-wrap rounded border bg-white p-2 text-sm text-slate-700">
        {patch.replacementMarkdown}
      </div>
      <div className="mt-3 flex gap-2">
        <button className="rounded bg-[#0D9488] px-3 py-1.5 text-sm text-white" onClick={onApply}>
          Apply change
        </button>
        <button className="rounded border px-3 py-1.5 text-sm text-slate-700" onClick={onReject}>
          Reject
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire AI tool output into review state**

Update `lib/tools/offer-file.ts` so AI-generated text edits include `changeDescription`, `section`, and replacement text. In `components/offers/offer/offer-chat.tsx`, display `OfferAiPatchReview` when a tool result contains an offer patch. Applying the patch updates draft offer content but does not save until the user clicks `Save Offer`.

- [ ] **Step 5: Save accepted patches as new versions**

Update `lib/data/offers.ts` so `createOrUpdateOffer` records a new `OfferFile` version when accepted rich-text content changes. Include a version reason such as `AI patch accepted: paymentTerms`.

- [ ] **Step 6: Run verification**

Run: `pnpm test tests/offer/offer-ai-patch-review.test.tsx tests/offer/tools/offer-ai-patch.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/offers/offer/offer-ai-patch-review.tsx components/offers/offer/offer-chat.tsx components/offers/offer/offer-file.tsx lib/tools/offer-file.ts lib/data/offers.ts tests/offer/offer-ai-patch-review.test.tsx
git commit -m "Review AI offer edits before versioning

AI changes should remain explicit user-accepted patches so offer versions
are auditable and customer PDFs only reflect approved edits.

Constraint: User approval required before saving AI-generated offer edits
Rejected: Apply model output directly to offer state | creates silent document mutations
Confidence: medium
Scope-risk: moderate
Tested: pnpm test tests/offer/offer-ai-patch-review.test.tsx tests/offer/tools/offer-ai-patch.test.ts && pnpm typecheck"
```

---

## Self-Review

**Spec coverage:** This plan covers versioned offer document editing, editable rich-text sections, AI conversation-driven changes, user review/apply, and the rule that pricing stays structured.

**Placeholder scan:** No `TBD`, `TODO`, or unspecified test instructions remain. The only migration filename placeholder is the standard timestamp path for Prisma migrations.

**Type consistency:** `OfferTextSection`, `OfferAiPatch`, and section names are defined before later tasks consume them. Later tasks use the same field names: `projectDescription`, `paymentTerms`, `termsAndConditions`, `serviceInclusions`, `serviceExclusions`, and `serviceExclusionsFootnote`.
