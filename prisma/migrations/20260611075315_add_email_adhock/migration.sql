-- CreateTable
CREATE TABLE "email_adhoc" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emailSubject" TEXT NOT NULL,
    "htmlUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_adhoc_pkey" PRIMARY KEY ("id")
);
