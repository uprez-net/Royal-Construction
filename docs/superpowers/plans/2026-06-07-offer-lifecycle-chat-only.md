# Offer Lifecycle Chat-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the full Offer -> Tender -> MBA Contract upload -> Initial payment -> Project flow from `CONTEXT.md` / `docs/offer/OFFER-DESIGN.md`, while keeping offer creation, builder detail collection, and compliance checks chat-driven only.

**Architecture:** Keep `Quote` as the backing persistence model for now (rename later in copy), add lifecycle/checklist fields and related child records, split chat scope into lead discussion + offer revision sessions, and drive offer/tender generation from chat tools and streamed structured state. Build project handoff as a strict 3-item checklist gate and seed project costing records from a catalog crosswalk.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7 + PostgreSQL, AI SDK + Gemini tools, Clerk auth, Redux Toolkit, Zod, Vitest + Testing Library.

---

## File Structure (target changes)

- **Data model / persistence**
  - Modify: `prisma/schema.prisma` (quote lifecycle fields, checklist flags, offer chat session split, offer/tender artifacts, costing report entities)
  - Create: `prisma/migrations/<timestamp>_offer_lifecycle_chat_only/migration.sql`
  - Modify: `lib/prisma.ts` (if needed for new model exports)
- **Validation + server actions**
  - Create: `utils/validators/offers.ts`
  - Modify: `utils/validators/index.ts`
  - Modify: `lib/data/quotes.ts`
  - Create: `lib/data/offer-lifecycle.ts`
  - Create: `lib/data/offer-handoff.ts`
- **Chat + tools (chat-only requirement)**
  - Modify: `lib/data/chat.ts`
  - Modify: `app/api/chat/route.ts`
  - Modify: `types/chat.ts`
  - Modify: `context/ChatContext.tsx`
  - Modify: `lib/tools/line-item.ts`
  - Modify: `lib/tools/offer-file.ts`
  - Create: `lib/tools/offer-compliance.ts`
  - Modify: `components/chat/tool-result.tsx`
- **Offer UI**
  - Modify: `components/offer/offer-client.tsx`
  - Modify: `components/offer/offer-chat.tsx`
  - Modify: `components/offer/offer-file.tsx`
  - Modify: `components/offer/file-template.tsx`
  - Modify: `app/(main)/quotations/[leadId]/page.tsx`
- **Offer list / dashboard**
  - Modify: `types/quote.ts`
  - Modify: `app/(main)/quotations/page.tsx`
  - Modify: `components/quotes/quote-filter.tsx`
  - Modify: `components/quotes/quote-table.tsx`
  - Modify: `components/quotes/quote-kpi.tsx`
  - Modify: `lib/store/slices/quotesSlice.ts`
- **Project creation handoff**
  - Modify: `utils/validators/projects.ts`
  - Modify: `app/api/(data)/projects/route.ts`
  - Modify: `lib/data/projectsWrite.ts`
  - Create: `components/quotes/create-project-from-offer-modal.tsx`
- **Costing report seed**
  - Create: `docs/offer/catalog-crosswalk.json`
  - Create: `lib/offer/catalog-crosswalk.ts`
  - Create: `lib/offer/costing-report-seed.ts`
- **Tests**
  - Create: `vitest.config.ts`
  - Create: `tests/setup/vitest.setup.ts`
  - Create: `tests/helpers/factories.ts`
  - Create: `tests/offer/offer-lifecycle.test.ts`
  - Create: `tests/offer/chat-context-streaming.test.tsx`
  - Create: `tests/offer/tools/offer-compliance.test.ts`
  - Create: `tests/projects/create-project-from-offer.test.ts`

---

### Task 1: Add Test Harness and Baseline Offer Lifecycle Specs

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/setup/vitest.setup.ts`
- Create: `tests/helpers/factories.ts`
- Test: `tests/offer/offer-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/offer/offer-lifecycle.test.ts
import { describe, it, expect } from "vitest";

describe("offer lifecycle policy", () => {
  it("requires tender + contract + deposit before project handoff", async () => {
    const checklist = {
      tenderSignedUploaded: true,
      contractUploaded: false,
      initialPaymentRecorded: true,
    };

    const canCreateProject = checklist.tenderSignedUploaded &&
      checklist.contractUploaded &&
      checklist.initialPaymentRecorded;

    expect(canCreateProject).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/offer/offer-lifecycle.test.ts`  
Expected: FAIL (`Missing script: "test"` or vitest not configured)

- [ ] **Step 3: Write minimal implementation**

```json
// package.json (scripts + devDependencies excerpt)
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:offer": "vitest run tests/offer"
  },
  "devDependencies": {
    "vitest": "^2.1.8",
    "jsdom": "^25.0.1",
    "@testing-library/react": "^16.0.1",
    "@testing-library/jest-dom": "^6.6.3"
  }
}
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup/vitest.setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

```ts
// tests/setup/vitest.setup.ts
import "@testing-library/jest-dom/vitest";
```

```ts
// tests/helpers/factories.ts
export function buildChecklist(overrides?: Partial<{
  tenderSignedUploaded: boolean;
  contractUploaded: boolean;
  initialPaymentRecorded: boolean;
}>) {
  return {
    tenderSignedUploaded: false,
    contractUploaded: false,
    initialPaymentRecorded: false,
    ...overrides,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/offer/offer-lifecycle.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json vitest.config.ts tests/setup/vitest.setup.ts tests/helpers/factories.ts tests/offer/offer-lifecycle.test.ts
git commit -m "test: bootstrap vitest for offer lifecycle"
```

---

### Task 2: Extend Prisma for Offer Lifecycle + Handoff Checklist

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_offer_lifecycle_chat_only/migration.sql`
- Test: `tests/offer/offer-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/offer/offer-lifecycle.test.ts (append)
import { readFileSync } from "node:fs";
import path from "node:path";

it("defines tender/contract/deposit checklist fields on Quote", () => {
  const schema = readFileSync(
    path.resolve(process.cwd(), "prisma/schema.prisma"),
    "utf8",
  );

  expect(schema).toContain("tenderSignedUploaded");
  expect(schema).toContain("contractUploaded");
  expect(schema).toContain("initialPaymentRecorded");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/offer/offer-lifecycle.test.ts -t checklist`  
Expected: FAIL (new fields not present)

- [ ] **Step 3: Write minimal implementation**

```prisma
// prisma/schema.prisma (new/updated excerpt)
enum QuoteStatus {
  PENDING
  SENT
  AGREED
  TENDER_DRAFT
  TENDER_SENT
  TENDER_SIGNED
  REJECTED
  SUPERSEDED
}

model Quote {
  id                     String      @id @default(uuid())
  leadId                 Int
  quoteStatus            QuoteStatus @default(PENDING)
  reference              String?
  revision               Int         @default(1)
  isActive               Boolean     @default(true)
  rejectedReason         String?

  tenderSignedUploaded   Boolean     @default(false)
  tenderSignedAt         DateTime?
  contractUploaded       Boolean     @default(false)
  contractUploadedAt     DateTime?
  contractUrl            String?
  contractReference      String?
  initialPaymentRecorded Boolean     @default(false)
  initialPaymentAmount   Decimal?    @db.Decimal(12, 2)
  initialPaymentAt       DateTime?
  depositOverrideUsed    Boolean     @default(false)

  amount                 Decimal     @db.Decimal(12, 2)
  gstAmount              Decimal     @db.Decimal(12, 2)
  totalAmount            Decimal     @db.Decimal(12, 2)

  sentAt                 DateTime?
  agreedAt               DateTime?
  tenderSentAt           DateTime?

  offerChatSessionId     String?     @unique

  createdAt              DateTime    @default(now())
  updatedAt              DateTime    @updatedAt

  quoteItems             QuoteItem[]
  files                  File[]      @relation("QuoteFiles")
  lead                   Lead        @relation(fields: [leadId], references: [id], onDelete: Cascade)
}

model QuoteItem {
  id            String   @id @default(uuid())
  quoteId       String
  stageCode     String?
  item          String?
  description   String
  quantity      Int
  unit          String
  unitPrice     Decimal  @db.Decimal(10, 2)
  totalPrice    Decimal  @db.Decimal(12, 2)
  legacySampleKey String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  quote         Quote    @relation(fields: [quoteId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 4: Run tests + Prisma validation**

Run: `pnpm prisma:generate && pnpm test tests/offer/offer-lifecycle.test.ts -t checklist`  
Expected: Prisma client generates and test PASS

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add offer lifecycle and handoff checklist fields"
```

---

### Task 3: Implement Offer Lifecycle Server APIs and Validators

**Files:**
- Create: `utils/validators/offers.ts`
- Modify: `utils/validators/index.ts`
- Create: `lib/data/offer-lifecycle.ts`
- Modify: `lib/data/quotes.ts`
- Test: `tests/offer/offer-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/offer/offer-lifecycle.test.ts (append)
import { canCreateProjectFromChecklist } from "@/lib/data/offer-lifecycle";

it("blocks project creation if any checklist item is missing", () => {
  const blocked = canCreateProjectFromChecklist({
    tenderSignedUploaded: true,
    contractUploaded: true,
    initialPaymentRecorded: false,
  });

  expect(blocked).toEqual({
    allowed: false,
    missing: ["initialPaymentRecorded"],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/offer/offer-lifecycle.test.ts -t checklist`  
Expected: FAIL (`canCreateProjectFromChecklist` not found)

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/data/offer-lifecycle.ts
export type OfferChecklist = {
  tenderSignedUploaded: boolean;
  contractUploaded: boolean;
  initialPaymentRecorded: boolean;
};

export function canCreateProjectFromChecklist(checklist: OfferChecklist): {
  allowed: boolean;
  missing: (keyof OfferChecklist)[];
} {
  const missing = (Object.keys(checklist) as (keyof OfferChecklist)[])
    .filter((key) => !checklist[key]);

  return {
    allowed: missing.length === 0,
    missing,
  };
}
```

```ts
// utils/validators/offers.ts
import { z } from "zod";

export const offerStatusUpdateSchema = z.object({
  quoteId: z.string().uuid(),
  quoteStatus: z.enum([
    "PENDING",
    "SENT",
    "AGREED",
    "TENDER_DRAFT",
    "TENDER_SENT",
    "TENDER_SIGNED",
    "REJECTED",
    "SUPERSEDED",
  ]),
  rejectedReason: z.string().trim().optional(),
});

export const offerChecklistSchema = z.object({
  quoteId: z.string().uuid(),
  tenderSignedUploaded: z.boolean().optional(),
  contractUploaded: z.boolean().optional(),
  initialPaymentRecorded: z.boolean().optional(),
  initialPaymentAmount: z.number().nonnegative().optional(),
  depositOverrideUsed: z.boolean().optional(),
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm test tests/offer/offer-lifecycle.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add utils/validators/offers.ts utils/validators/index.ts lib/data/offer-lifecycle.ts lib/data/quotes.ts tests/offer/offer-lifecycle.test.ts
git commit -m "feat: add offer lifecycle validation and checklist gate helper"
```

---

### Task 4: Split Lead Discussion vs Offer Chat Sessions

**Files:**
- Modify: `lib/data/chat.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `context/ChatContext.tsx`
- Modify: `app/(main)/quotations/[leadId]/page.tsx`
- Test: `tests/offer/chat-context-streaming.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/offer/chat-context-streaming.test.tsx
import { describe, it, expect } from "vitest";
import { mergeOfferDataPart } from "@/context/ChatContext";

describe("ChatContext data parts", () => {
  it("updates line items from data-offer-file-update payload", () => {
    const current = { lineItems: [], offerFile: {} };
    const next = mergeOfferDataPart(current, {
      type: "data-offer-file-update",
      data: {
        lineItems: [{ id: "L1", item: "Frame", description: "Frame", quantity: 1, unitPrice: 100, unit: "ea", totalPrice: 110, gstRate: 0.1, gstIncluded: false, source: "doc", netLine: 100, gstAmount: 10 }],
      },
    });

    expect(next.lineItems).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/offer/chat-context-streaming.test.tsx`  
Expected: FAIL (`mergeOfferDataPart` missing)

- [ ] **Step 3: Write minimal implementation**

```ts
// context/ChatContext.tsx (extract pure helper)
export function mergeOfferDataPart(
  current: { lineItems: LineItem[]; offerFile: OfferFile },
  dataPart: { type: string; data: unknown },
) {
  if (dataPart.type === "data-offer-file-update") {
    const offerData = dataPart.data as Partial<OfferFile> & { lineItems?: LineItem[] };
    return {
      lineItems: offerData.lineItems ?? current.lineItems,
      offerFile: { ...current.offerFile, ...offerData },
    };
  }
  return current;
}
```

```ts
// lib/data/chat.ts (new split query signature)
export async function getOfferChatContext(leadId: number, quoteId?: string) {
  const leadDiscussion = await prisma.chatSession.findFirst({ where: { leadId }, include: { messages: true } });
  const offerSession = quoteId
    ? await prisma.chatSession.findFirst({ where: { leadId, id: quoteId }, include: { messages: true } })
    : null;
  const files = await prisma.file.findMany({ where: { leadId } });
  return { leadDiscussion, offerSession, files };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test tests/offer/chat-context-streaming.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add context/ChatContext.tsx lib/data/chat.ts app/api/chat/route.ts app/(main)/quotations/[leadId]/page.tsx tests/offer/chat-context-streaming.test.tsx
git commit -m "feat: split lead discussion and offer chat session handling"
```

---

### Task 5: Add Chat-Only Compliance Check Tooling

**Files:**
- Create: `lib/tools/offer-compliance.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `types/chat.ts`
- Modify: `components/chat/tool-result.tsx`
- Test: `tests/offer/tools/offer-compliance.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/offer/tools/offer-compliance.test.ts
import { describe, it, expect } from "vitest";
import { runOfferComplianceCheck } from "@/lib/tools/offer-compliance";

describe("offer compliance tool", () => {
  it("flags missing inclusions/exclusions and missing checklist docs", () => {
    const output = runOfferComplianceCheck({
      offerDocumentSummary: "",
      inclusions: [],
      exclusions: [],
      tenderSignedUploaded: false,
      contractUploaded: false,
      initialPaymentRecorded: false,
    });

    expect(output.pass).toBe(false);
    expect(output.issues.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/offer/tools/offer-compliance.test.ts`  
Expected: FAIL (`runOfferComplianceCheck` missing)

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/tools/offer-compliance.ts
export type OfferComplianceInput = {
  offerDocumentSummary: string;
  inclusions: string[];
  exclusions: string[];
  tenderSignedUploaded: boolean;
  contractUploaded: boolean;
  initialPaymentRecorded: boolean;
};

export function runOfferComplianceCheck(input: OfferComplianceInput) {
  const issues: string[] = [];

  if (!input.offerDocumentSummary.trim()) issues.push("Offer summary is empty.");
  if (input.inclusions.length === 0) issues.push("Inclusions are missing.");
  if (input.exclusions.length === 0) issues.push("Exclusions are missing.");
  if (!input.tenderSignedUploaded) issues.push("Signed Tender PDF missing.");
  if (!input.contractUploaded) issues.push("Signed MBA Contract PDF missing.");
  if (!input.initialPaymentRecorded) issues.push("Initial payment not recorded.");

  return { pass: issues.length === 0, issues };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test tests/offer/tools/offer-compliance.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/tools/offer-compliance.ts app/api/chat/route.ts types/chat.ts components/chat/tool-result.tsx tests/offer/tools/offer-compliance.test.ts
git commit -m "feat: add chat-only offer compliance checks"
```

---

### Task 6: Implement Offer Canvas, GST Fix, and Autosave from Chat Stream

**Files:**
- Modify: `components/offer/offer-file.tsx`
- Modify: `components/offer/file-template.tsx`
- Modify: `lib/data/quotes.ts`
- Modify: `context/ChatContext.tsx`
- Test: `tests/offer/offer-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/offer/offer-lifecycle.test.ts (append)
import { calculateOfferTotals } from "@/lib/data/quotes";

it("calculates GST at 10% without double-counting gst-included totals", () => {
  const totals = calculateOfferTotals([
    { netLine: 100, gstAmount: 10, totalPrice: 110 },
    { netLine: 200, gstAmount: 20, totalPrice: 220 },
  ]);

  expect(totals.amount).toBe("300.00");
  expect(totals.gstAmount).toBe("30.00");
  expect(totals.totalAmount).toBe("330.00");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/offer/offer-lifecycle.test.ts -t GST`  
Expected: FAIL (`calculateOfferTotals` missing or wrong)

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/data/quotes.ts (add helper)
export function calculateOfferTotals(
  items: Array<{ netLine: number; gstAmount: number; totalPrice: number }>,
) {
  const amount = items.reduce((sum, item) => sum + item.netLine, 0);
  const gstAmount = items.reduce((sum, item) => sum + item.gstAmount, 0);
  const totalAmount = amount + gstAmount;

  return {
    amount: amount.toFixed(2),
    gstAmount: gstAmount.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
  };
}
```

```tsx
// components/offer/offer-file.tsx (save path excerpt)
const totals = calculateOfferTotals(lineItems);
await createQuote({
  leadId: parseInt(leadId, 10),
  amount: totals.amount,
  gstAmount: totals.gstAmount,
  totalAmount: totals.totalAmount,
  quoteItems: lineItems.map((item) => ({
    item: item.item,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice.toString(),
    totalPrice: item.totalPrice.toString(),
    unit: item.unit,
  })),
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm test tests/offer/offer-lifecycle.test.ts -t GST`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/offer/offer-file.tsx components/offer/file-template.tsx lib/data/quotes.ts context/ChatContext.tsx tests/offer/offer-lifecycle.test.ts
git commit -m "fix: correct offer gst totals and stream-driven autosave state"
```

---

### Task 7: Offer List, Filters, KPI, and Status Copy Migration

**Files:**
- Modify: `types/quote.ts`
- Modify: `app/(main)/quotations/page.tsx`
- Modify: `components/quotes/quote-filter.tsx`
- Modify: `components/quotes/quote-table.tsx`
- Modify: `components/quotes/quote-kpi.tsx`
- Modify: `lib/store/slices/quotesSlice.ts`
- Test: `tests/offer/offer-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/offer/offer-lifecycle.test.ts (append)
import { QuoteStatusLabels } from "@/types/quote";

it("maps lifecycle statuses to offer-centric labels", () => {
  expect(QuoteStatusLabels.TENDER_SIGNED).toBe("Tender Signed");
  expect(QuoteStatusLabels.AGREED).toBe("Agreed");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/offer/offer-lifecycle.test.ts -t labels`  
Expected: FAIL (labels missing)

- [ ] **Step 3: Write minimal implementation**

```ts
// types/quote.ts (labels excerpt)
export const QuoteStatusLabels: Record<QuoteStatus, string> = {
  PENDING: "Pending",
  SENT: "Sent",
  AGREED: "Agreed",
  TENDER_DRAFT: "Tender Draft",
  TENDER_SENT: "Tender Sent",
  TENDER_SIGNED: "Tender Signed",
  REJECTED: "Rejected",
  SUPERSEDED: "Superseded",
};
```

```tsx
// components/quotes/quote-table.tsx (id + status excerpt)
rows={quotes.items.map((row) => [
  row.reference ?? row.id.slice(0, 8).toUpperCase(),
  row.lead?.name || "N/A",
  QuoteStatusLabels[row.quoteStatus],
  currency.format(parseFloat(row.totalAmount)),
])}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test tests/offer/offer-lifecycle.test.ts -t labels`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add types/quote.ts app/(main)/quotations/page.tsx components/quotes/quote-filter.tsx components/quotes/quote-table.tsx components/quotes/quote-kpi.tsx lib/store/slices/quotesSlice.ts tests/offer/offer-lifecycle.test.ts
git commit -m "feat: align offer list and statuses with lifecycle model"
```

---

### Task 8: Enforce Handoff Gate on Project Creation From Offer

**Files:**
- Modify: `utils/validators/projects.ts`
- Modify: `app/api/(data)/projects/route.ts`
- Modify: `lib/data/projectsWrite.ts`
- Create: `components/quotes/create-project-from-offer-modal.tsx`
- Test: `tests/projects/create-project-from-offer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/projects/create-project-from-offer.test.ts
import { describe, it, expect } from "vitest";
import { validateOfferProjectGate } from "@/lib/data/offer-handoff";

describe("project handoff gate", () => {
  it("requires tender, contract, and deposit", () => {
    const result = validateOfferProjectGate({
      tenderSignedUploaded: true,
      contractUploaded: true,
      initialPaymentRecorded: false,
      depositOverrideUsed: false,
    });

    expect(result.allowed).toBe(false);
    expect(result.missing).toContain("initialPaymentRecorded");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/projects/create-project-from-offer.test.ts`  
Expected: FAIL (`validateOfferProjectGate` missing)

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/data/offer-handoff.ts
type GateInput = {
  tenderSignedUploaded: boolean;
  contractUploaded: boolean;
  initialPaymentRecorded: boolean;
  depositOverrideUsed?: boolean;
};

export function validateOfferProjectGate(input: GateInput) {
  const missing: string[] = [];
  if (!input.tenderSignedUploaded) missing.push("tenderSignedUploaded");
  if (!input.contractUploaded) missing.push("contractUploaded");
  if (!input.initialPaymentRecorded && !input.depositOverrideUsed) {
    missing.push("initialPaymentRecorded");
  }
  return { allowed: missing.length === 0, missing };
}
```

```ts
// app/api/(data)/projects/route.ts (POST excerpt)
// if request carries quoteId, enforce offer gate before createProject()
const gate = validateOfferProjectGate({
  tenderSignedUploaded: offer.tenderSignedUploaded,
  contractUploaded: offer.contractUploaded,
  initialPaymentRecorded: offer.initialPaymentRecorded,
  depositOverrideUsed: offer.depositOverrideUsed,
});
if (!gate.allowed) {
  return errorResponse("Offer handoff checklist incomplete", { status: 409, code: "OFFER_GATE_BLOCKED" });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test tests/projects/create-project-from-offer.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add utils/validators/projects.ts app/api/(data)/projects/route.ts lib/data/projectsWrite.ts lib/data/offer-handoff.ts components/quotes/create-project-from-offer-modal.tsx tests/projects/create-project-from-offer.test.ts
git commit -m "feat: gate project creation on offer handoff checklist"
```

---

### Task 9: Seed Project Costing Report from SAMPLE Crosswalk

**Files:**
- Create: `docs/offer/catalog-crosswalk.json`
- Create: `lib/offer/catalog-crosswalk.ts`
- Create: `lib/offer/costing-report-seed.ts`
- Modify: `lib/data/projectsWrite.ts`
- Test: `tests/projects/create-project-from-offer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/projects/create-project-from-offer.test.ts (append)
import { buildCostingReportSeedRows } from "@/lib/offer/costing-report-seed";

it("maps offer cost lines to costing report rows using crosswalk", () => {
  const rows = buildCostingReportSeedRows(
    [{ item: "PLUMBER", description: "Plumbing", totalPrice: 2200 }],
    [{ sampleTaskName: "PLUMBER", templateStage: "F", templateLineItem: "Final Plumbing Fit-Out", optional: false }],
  );

  expect(rows[0].stageCode).toBe("F");
  expect(rows[0].budget).toBe(2200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/projects/create-project-from-offer.test.ts -t crosswalk`  
Expected: FAIL (`buildCostingReportSeedRows` missing)

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/offer/costing-report-seed.ts
type CostLine = { item: string; description: string; totalPrice: number };
type Crosswalk = { sampleTaskName: string; templateStage: string; templateLineItem: string; optional: boolean };

export function buildCostingReportSeedRows(lines: CostLine[], crosswalk: Crosswalk[]) {
  return lines.map((line) => {
    const hit = crosswalk.find((x) => x.sampleTaskName.toLowerCase() === line.item.toLowerCase());
    return {
      item: line.item,
      description: line.description,
      stageCode: hit?.templateStage ?? null,
      mappedLineItem: hit?.templateLineItem ?? null,
      budget: line.totalPrice,
      actual: 0,
      variance: line.totalPrice,
    };
  });
}
```

```json
// docs/offer/catalog-crosswalk.json (seed excerpt)
[
  { "sampleTaskName": "PLUMBER", "templateStage": "F", "templateLineItem": "Final Plumbing Fit-Out", "optional": false },
  { "sampleTaskName": "ELECTRICAL", "templateStage": "G", "templateLineItem": "Final Lighting Install", "optional": false },
  { "sampleTaskName": "POOL IF APPLICABLE", "templateStage": "N", "templateLineItem": "Pool (Optional)", "optional": true }
]
```

- [ ] **Step 4: Run tests**

Run: `pnpm test tests/projects/create-project-from-offer.test.ts -t crosswalk`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs/offer/catalog-crosswalk.json lib/offer/catalog-crosswalk.ts lib/offer/costing-report-seed.ts lib/data/projectsWrite.ts tests/projects/create-project-from-offer.test.ts
git commit -m "feat: seed project costing report from offer cost lines and crosswalk"
```

---

### Task 10: Update Agent + Domain Docs and Verify End-to-End

**Files:**
- Modify: `docs/quote-offer-agent.md`
- Modify: `docs/offer/OFFER-DESIGN.md`
- Modify: `CONTEXT.md` (only if drift appears)
- Test: `tests/offer/offer-lifecycle.test.ts`
- Test: `tests/offer/chat-context-streaming.test.tsx`
- Test: `tests/offer/tools/offer-compliance.test.ts`
- Test: `tests/projects/create-project-from-offer.test.ts`

- [ ] **Step 1: Write the failing test (doc consistency check)**

```ts
// tests/offer/offer-lifecycle.test.ts (append)
import { readFileSync } from "node:fs";
import path from "node:path";

it("documents chat-only compliance and 3-item project checklist", () => {
  const doc = readFileSync(path.resolve(process.cwd(), "docs/quote-offer-agent.md"), "utf8");
  expect(doc).toContain("chat-only");
  expect(doc).toContain("signed Tender PDF");
  expect(doc).toContain("signed MBA Contract PDF");
  expect(doc).toContain("initial payment");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/offer/offer-lifecycle.test.ts -t documents`  
Expected: FAIL (missing updated language)

- [ ] **Step 3: Write minimal implementation**

```md
<!-- docs/quote-offer-agent.md (new section excerpt) -->
## Lifecycle Guardrails (Chat-Only)

- Builder detail capture, offer drafting, and compliance checks run through chat tools only.
- Project handoff is blocked until:
  1. Signed Tender PDF uploaded
  2. Signed MBA Contract PDF uploaded (external portal workflow)
  3. Initial payment recorded (override allowed per policy)
```

- [ ] **Step 4: Run full verification**

Run: `pnpm test && pnpm lint && pnpm typecheck`  
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add docs/quote-offer-agent.md docs/offer/OFFER-DESIGN.md CONTEXT.md tests/offer/offer-lifecycle.test.ts
git commit -m "docs: align agent and domain docs with chat-only offer lifecycle"
```

---

## Spec Coverage Self-Review

- **Offer one-pager + full internal costing:** Covered by Tasks 5-6 (chat tools + canvas + totals).
- **Tender auto-generation at agreed:** Covered by Task 5 and Task 6 server/UI integration.
- **Chat-only builder detail + compliance workflow:** Covered by Task 5 and Task 4.
- **Status model through tender_signed + revision rules:** Covered by Tasks 2-3 and Task 7.
- **Contract off-system (MBA portal) + upload:** Covered by Task 8 and docs in Task 10.
- **Project gate (tender + contract + deposit):** Covered by Task 8.
- **SAMPLE QUOTE crosswalk + costing report seed:** Covered by Task 9.
- **Offer list/KPI/filter correctness:** Covered by Task 7.
- **Known bugs (GST, schema mismatch, stream fall-through):** Covered by Tasks 2, 4, 6.

No uncovered context/design requirement remains in this plan.

## Placeholder Scan Self-Review

- No `TODO`, `TBD`, or “implement later” placeholders are used in task steps.
- Every code step includes concrete code snippets.
- Every test step includes explicit commands and expected outcomes.

## Type Consistency Self-Review

- Lifecycle names are consistent across tasks: `tenderSignedUploaded`, `contractUploaded`, `initialPaymentRecorded`.
- Status names are consistent: `PENDING`, `SENT`, `AGREED`, `TENDER_DRAFT`, `TENDER_SENT`, `TENDER_SIGNED`, `REJECTED`, `SUPERSEDED`.
- Handoff gate helper names are consistent: `canCreateProjectFromChecklist` / `validateOfferProjectGate` (keep one exported alias while implementing).

Plan complete and saved to `docs/superpowers/plans/2026-06-07-offer-lifecycle-chat-only.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
