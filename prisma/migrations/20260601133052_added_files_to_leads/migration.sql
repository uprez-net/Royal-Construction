/*
  Warnings:

  - You are about to drop the column `chatSessionId` on the `File` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "File" DROP CONSTRAINT "File_chatSessionId_fkey";

-- AlterTable
ALTER TABLE "File" DROP COLUMN "chatSessionId",
ADD COLUMN     "leadId" INTEGER;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
