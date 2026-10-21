-- An activity can need more than one trade: the single required trade becomes
-- a many-to-many on both the build sequence and each project's milestones.

CREATE TABLE "_MilestoneRequiredTrades" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_MilestoneRequiredTrades_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE TABLE "_TemplateRequiredTrades" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TemplateRequiredTrades_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE INDEX "_MilestoneRequiredTrades_B_index" ON "_MilestoneRequiredTrades"("B");
CREATE INDEX "_TemplateRequiredTrades_B_index" ON "_TemplateRequiredTrades"("B");

ALTER TABLE "_MilestoneRequiredTrades" ADD CONSTRAINT "_MilestoneRequiredTrades_A_fkey" FOREIGN KEY ("A") REFERENCES "Milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_MilestoneRequiredTrades" ADD CONSTRAINT "_MilestoneRequiredTrades_B_fkey" FOREIGN KEY ("B") REFERENCES "TradeType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_TemplateRequiredTrades" ADD CONSTRAINT "_TemplateRequiredTrades_A_fkey" FOREIGN KEY ("A") REFERENCES "MilestoneTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_TemplateRequiredTrades" ADD CONSTRAINT "_TemplateRequiredTrades_B_fkey" FOREIGN KEY ("B") REFERENCES "TradeType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry every existing dependency across before the old columns go.
INSERT INTO "_MilestoneRequiredTrades" ("A", "B")
SELECT "id", "requiredTradeTypeId" FROM "Milestone" WHERE "requiredTradeTypeId" IS NOT NULL;

INSERT INTO "_TemplateRequiredTrades" ("A", "B")
SELECT "id", "requiredTradeTypeId" FROM "MilestoneTemplate" WHERE "requiredTradeTypeId" IS NOT NULL;

ALTER TABLE "Milestone" DROP CONSTRAINT "Milestone_requiredTradeTypeId_fkey";
ALTER TABLE "MilestoneTemplate" DROP CONSTRAINT "MilestoneTemplate_requiredTradeTypeId_fkey";
DROP INDEX "MilestoneTemplate_requiredTradeTypeId_idx";
ALTER TABLE "Milestone" DROP COLUMN "requiredTradeTypeId";
ALTER TABLE "MilestoneTemplate" DROP COLUMN "requiredTradeTypeId";
