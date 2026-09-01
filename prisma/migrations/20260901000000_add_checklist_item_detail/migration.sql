-- AlterEnum
ALTER TYPE "ComplianceDocumentStatus" ADD VALUE 'NOT_REQUIRED';

-- AlterTable
ALTER TABLE "ComplianceDocument" ADD COLUMN     "detail" JSONB;
