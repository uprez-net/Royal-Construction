-- The context index as sections, with keywords and tags (#621).
--
-- Each live lead, offer and project becomes one row per section, so a long
-- project no longer has one vector for everything. Existing rows become the
-- `record` section; the next refresh writes the sections and removes those
-- `record` rows for leads and projects. Tradies and the digest stay `record`.

ALTER TABLE "AgentContextChunk" ADD COLUMN "section" TEXT NOT NULL DEFAULT 'record';
ALTER TABLE "AgentContextChunk" ADD COLUMN "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AgentContextChunk" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AgentContextChunk" ADD COLUMN "dueAt" TIMESTAMP(3);

DROP INDEX "AgentContextChunk_kind_entityId_key";
CREATE UNIQUE INDEX "AgentContextChunk_kind_entityId_section_key" ON "AgentContextChunk"("kind", "entityId", "section");

-- Exact matching of a question's forms against a record's keywords
-- (`keywords && ARRAY[...]`).
CREATE INDEX "AgentContextChunk_keywords_idx" ON "AgentContextChunk" USING GIN ("keywords");
