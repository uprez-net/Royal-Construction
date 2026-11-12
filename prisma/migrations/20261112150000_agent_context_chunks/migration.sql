-- The operations agent's daily context index (AgentContextChunk).
--
-- pgvector ships with Neon; IF NOT EXISTS keeps this a no-op where an earlier
-- change or the provider already enabled it.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "AgentContextChunk" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "embedding" vector(1536),
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentContextChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentContextChunk_kind_entityId_key" ON "AgentContextChunk"("kind", "entityId");
CREATE INDEX "AgentContextChunk_kind_idx" ON "AgentContextChunk"("kind");

-- No ANN index: a residential builder has hundreds of live records, not
-- millions, and an exact inner-product scan over them is faster than keeping
-- an approximate index warm.
