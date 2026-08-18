-- AlterTable
ALTER TABLE "AdminOfferContent" ADD COLUMN     "hbfcClaim" JSONB NOT NULL DEFAULT '{"claimAmount": 800000}';
