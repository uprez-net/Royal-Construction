-- AlterTable
ALTER TABLE "email_adhoc" ADD COLUMN     "attachmentsUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
