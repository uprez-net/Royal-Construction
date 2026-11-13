-- Uploaded documents in the operations agent's context index: the text read
-- out of each document once (AgentFileText) and its searchable passages,
-- tagged with lead, project and offer (AgentFileChunk).
--
-- The vector extension is enabled by 20261112150000_agent_context_chunks.

CREATE TABLE "AgentFileText" (
    "id" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "pages" JSONB NOT NULL DEFAULT '[]',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentFileText_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentFileText_urlHash_key" ON "AgentFileText"("urlHash");

CREATE TABLE "AgentFileChunk" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "fileId" TEXT,
    "offerReplyId" TEXT,
    "leadId" INTEGER,
    "projectId" TEXT,
    "offerId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "pageFrom" INTEGER NOT NULL,
    "pageTo" INTEGER NOT NULL,
    "embedding" vector(1536),
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentFileChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentFileChunk_sourceKey_chunkIndex_key" ON "AgentFileChunk"("sourceKey", "chunkIndex");
CREATE INDEX "AgentFileChunk_sourceKey_idx" ON "AgentFileChunk"("sourceKey");
CREATE INDEX "AgentFileChunk_leadId_idx" ON "AgentFileChunk"("leadId");
CREATE INDEX "AgentFileChunk_projectId_idx" ON "AgentFileChunk"("projectId");
CREATE INDEX "AgentFileChunk_offerId_idx" ON "AgentFileChunk"("offerId");
CREATE INDEX "AgentFileChunk_fileId_idx" ON "AgentFileChunk"("fileId");
CREATE INDEX "AgentFileChunk_offerReplyId_idx" ON "AgentFileChunk"("offerReplyId");

ALTER TABLE "AgentFileChunk" ADD CONSTRAINT "AgentFileChunk_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentFileChunk" ADD CONSTRAINT "AgentFileChunk_offerReplyId_fkey" FOREIGN KEY ("offerReplyId") REFERENCES "OfferDocumentReply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- No ANN index, as for AgentContextChunk: thousands of passages, not millions.
