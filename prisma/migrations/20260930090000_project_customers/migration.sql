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
