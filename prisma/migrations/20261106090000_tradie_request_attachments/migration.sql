-- Files a tradie request email carries, by project File id.
ALTER TABLE "TradieRequest" ADD COLUMN "attachmentFileIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
