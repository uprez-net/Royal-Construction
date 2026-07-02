-- CreateTable
CREATE TABLE "TradieRating" (
    "id" TEXT NOT NULL,
    "tradieId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" DECIMAL(2,1) NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradieRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradieRating_tradieId_idx" ON "TradieRating"("tradieId");

-- CreateIndex
CREATE INDEX "TradieRating_userId_idx" ON "TradieRating"("userId");

-- AddForeignKey
ALTER TABLE "TradieRating" ADD CONSTRAINT "TradieRating_tradieId_fkey" FOREIGN KEY ("tradieId") REFERENCES "Tradie"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradieRating" ADD CONSTRAINT "TradieRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
