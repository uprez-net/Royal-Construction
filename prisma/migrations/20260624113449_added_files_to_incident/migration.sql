-- AlterTable
ALTER TABLE "File" ADD COLUMN     "incidentId" TEXT;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "TradieIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
