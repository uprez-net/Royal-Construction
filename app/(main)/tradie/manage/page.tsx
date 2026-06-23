import { getTradieGroupedByCategoryCached } from "@/lib/data/tradie-management";

export default async function TradieManagementPage() {
  const tradies = await getTradieGroupedByCategoryCached();

  return (
    <div className="flex flex-col gap-4 p-4">
      {JSON.stringify(tradies, null, 2)}
    </div>
  );
}
