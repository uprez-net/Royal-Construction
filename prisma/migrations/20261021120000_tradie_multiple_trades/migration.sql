-- AlterTable
ALTER TABLE "Tradie" ADD COLUMN     "trades" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "TradieSchedule" ADD COLUMN     "trade" TEXT;

-- Every tradie so far had one trade; it is their only, and primary, category.
UPDATE "Tradie"
SET "trades" = ARRAY["trade"]
WHERE cardinality("trades") = 0 AND btrim("trade") <> '';

-- Every booking so far was for its tradie's one trade.
UPDATE "TradieSchedule" ts
SET "trade" = t."trade"
FROM "Tradie" t
WHERE ts."tradieId" = t."id" AND ts."trade" IS NULL;
