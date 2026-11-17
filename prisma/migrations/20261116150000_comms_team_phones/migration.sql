-- Team phones: staff numbers an admin adds under Admin -> Phone & SMS, so
-- anyone on the team can take a lead call on their own phone. A call keeps a
-- copy of the number and nickname it rang.

-- CreateTable
CREATE TABLE "CommsTeamPhone" (
    "id" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "e164" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommsTeamPhone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommsTeamPhone_e164_key" ON "CommsTeamPhone"("e164");

-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "staffPhoneLabel" TEXT,
ADD COLUMN     "staffPhoneNumber" TEXT;
