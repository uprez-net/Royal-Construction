-- At most one live selection per trade on a project: partial unique index
-- (Prisma cannot express a filtered unique in the schema, so it is created
-- here by hand).
CREATE UNIQUE INDEX "TradeSelection_one_live_per_trade" ON "TradeSelection"("projectId", "tradeKey") WHERE "status" IN ('ACTIVE', 'CANCELLATION_PENDING');
