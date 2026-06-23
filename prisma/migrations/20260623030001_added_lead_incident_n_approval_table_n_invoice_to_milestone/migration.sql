/*
  Warnings:

  - You are about to drop the column `company` on the `Tradie` table. All the data in the column will be lost.
  - You are about to drop the column `tradeType` on the `Tradie` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[abn]` on the table `Tradie` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `abn` to the `Tradie` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TradieIncidentStatus" AS ENUM ('OPEN', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TradieApprovalActionType" AS ENUM ('PRICE_CHANGE', 'INCIDENT_RESOLUTION', 'TRADIE_REMOVAL');

-- CreateEnum
CREATE TYPE "TradieApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- DropIndex
DROP INDEX "Tradie_tradeType_idx";

-- AlterTable
ALTER TABLE "Milestone" ADD COLUMN     "invoiceId" TEXT;

-- AlterTable
ALTER TABLE "Tradie" DROP COLUMN "company",
DROP COLUMN "tradeType",
ADD COLUMN     "abn" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "TradieIncident" (
    "id" TEXT NOT NULL,
    "tradieId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "TradieIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradieIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradieApproval" (
    "id" TEXT NOT NULL,
    "tradieId" TEXT NOT NULL,
    "actionType" "TradieApprovalActionType" NOT NULL,
    "status" "TradieApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "updationData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradieApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradieIncident_tradieId_idx" ON "TradieIncident"("tradieId");

-- CreateIndex
CREATE INDEX "TradieIncident_severity_idx" ON "TradieIncident"("severity");

-- CreateIndex
CREATE INDEX "TradieApproval_tradieId_idx" ON "TradieApproval"("tradieId");

-- CreateIndex
CREATE UNIQUE INDEX "Tradie_abn_key" ON "Tradie"("abn");

-- AddForeignKey
ALTER TABLE "TradieIncident" ADD CONSTRAINT "TradieIncident_tradieId_fkey" FOREIGN KEY ("tradieId") REFERENCES "Tradie"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradieApproval" ADD CONSTRAINT "TradieApproval_tradieId_fkey" FOREIGN KEY ("tradieId") REFERENCES "Tradie"("id") ON DELETE CASCADE ON UPDATE CASCADE;
