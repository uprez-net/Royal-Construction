-- One build can have several owners, and every one of them is a customer.
-- CreateTable
CREATE TABLE "ProjectCustomer" (
    "projectId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectCustomer_pkey" PRIMARY KEY ("projectId","customerId")
);

-- CreateIndex
CREATE INDEX "ProjectCustomer_customerId_idx" ON "ProjectCustomer"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCustomer_projectId_position_key" ON "ProjectCustomer"("projectId", "position");

-- AddForeignKey
ALTER TABLE "ProjectCustomer" ADD CONSTRAINT "ProjectCustomer_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCustomer" ADD CONSTRAINT "ProjectCustomer_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every existing project's one customer becomes its primary owner. Co-owners
-- of existing projects are NOT inferred from requirements.ownerContacts: those
-- are three independent lists, and pairing them by index is the guess this
-- change exists to stop making.
INSERT INTO "ProjectCustomer" ("projectId", "customerId", "position")
SELECT "id", "customerId", 0 FROM "Project";

-- The Xero contact moves from the customer to the project: one contact per
-- build, named as the contract names its owners. Every project first keeps the
-- contact its primary customer was already billed under, so no claim already
-- raised in Xero ends up under a second contact.
-- AlterTable
ALTER TABLE "Project" ADD COLUMN "xeroContactId" TEXT;

UPDATE "Project" AS p
SET "xeroContactId" = c."xeroContactId"
FROM "Customer" AS c
WHERE c."id" = p."customerId" AND c."xeroContactId" IS NOT NULL;

-- DropIndex
DROP INDEX "Customer_xeroContactId_key";

-- AlterTable
ALTER TABLE "Customer" DROP COLUMN "xeroContactId";

-- Customer.phone is an identity (unique), so every row is put in the one form
-- the app now compares and stores it in: digits only, a leading "+" kept
-- (lib/domain/projects/owners.ts#canonicalPhone). Without this an existing
-- "0400 111 222" is missed by a lookup for "0400111222" and the same person
-- becomes a second customer.
--
-- A group of rows that would all become the same number is the same person
-- stored twice already. Those rows are left exactly as they are for someone to
-- merge by hand, rather than failing the deploy on the unique index or
-- guessing which record survives. Leaving them also means no row is ever
-- rewritten onto a value another row still holds.
WITH canon AS (
    SELECT
        "id",
        CASE WHEN btrim("phone") LIKE '+%' THEN '+' ELSE '' END
            || regexp_replace("phone", '[^0-9]', '', 'g') AS "phone"
    FROM "Customer"
),
unshared AS (
    SELECT "phone" FROM canon GROUP BY "phone" HAVING count(*) = 1
)
UPDATE "Customer" AS c
SET "phone" = canon."phone"
FROM canon
JOIN unshared ON unshared."phone" = canon."phone"
WHERE c."id" = canon."id"
  AND c."phone" <> canon."phone"
  AND regexp_replace(canon."phone", '[^0-9]', '', 'g') <> '';
