-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "runStatus" "RunStatus";
