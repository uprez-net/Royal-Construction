import type { Metadata } from "next";
import { connection } from "next/server";

import { TradeTypesAdmin } from "@/components/admin/trade-types-admin";
import { getTradeTypesForAdmin } from "@/lib/data/trade-types";

export const metadata: Metadata = {
  title: "Trade Types",
  description: "Add, rename and archive the trades tradies are listed under.",
};

export default async function TradeTypesPage() {
  // Live rows with their tradie counts; never prerendered.
  await connection();
  const tradeTypes = await getTradeTypesForAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Trade Types
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The trades a tradie can be listed under. New ones show up in every
          trade picker and filter straight away.
        </p>
      </div>
      <TradeTypesAdmin tradeTypes={tradeTypes} />
    </div>
  );
}
