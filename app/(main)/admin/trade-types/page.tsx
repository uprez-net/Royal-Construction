import type { Metadata } from "next";
import { connection } from "next/server";

import { TradeTypesAdmin } from "@/components/admin/trade-types-admin";
import { PageHeader } from "@/components/common/page-header";
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
      <PageHeader
        title="Trade types"
        headingLevel="h1"
        description="The trades a tradie can be listed under. New ones show up in every trade picker and filter straight away. Archiving takes a trade off the pickers; tradies already under it keep it. Only a trade with no tradies can be deleted."
      />
      <TradeTypesAdmin tradeTypes={tradeTypes} />
    </div>
  );
}
