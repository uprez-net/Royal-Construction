import { useAppSelector } from "@/lib/store/hooks";
import { useMemo } from "react";
import { TradieCategory } from "./tabs/tradie-category";
import { TradieTable } from "./tabs/tradie-table";
import { TradieList } from "./tabs/tradie-list";

export function TradieBody() {
  const { query, activeTab, tradies, tradiesByCategory } = useAppSelector(
    (state) => state.tradieManagement,
  );

  const filteredTradies = useMemo(() => {
    const search = query.search?.trim().toLowerCase();
    const category = query.category;
    const rating = query.rating;
    const favourite = query.favourite;
    const tab = query.tab;

    return tradies.filter((tradie) => {
      if (search && !tradie.name.toLowerCase().includes(search)) {
        return false;
      }

      if (category && tradie.trade !== category) {
        return false;
      }

      if (rating && Number(tradie.rating ?? 0) !== rating) {
        return false;
      }

      if (favourite !== undefined && tradie.isFavourite !== favourite) {
        return false;
      }

      if (tab === "flagged" && tradie.incidentCount.open === 0) {
        return false;
      }

      return true;
    });
  }, [tradies, query]);

  const filteredTradiesByCategory = useMemo(() => {
    const search = query.search?.trim().toLowerCase();

    return tradiesByCategory
      .map((category) => ({
        ...category,
        tradies: category.tradies.filter((tradie) => {
          if (search && !tradie.name.toLowerCase().includes(search)) {
            return false;
          }

          if (
            query.favourite !== undefined &&
            tradie.isFavourite !== query.favourite
          ) {
            return false;
          }

          return true;
        }),
      }))
      .filter((category) => category.tradies.length > 0);
  }, [tradiesByCategory, query.search, query.favourite]);

  switch (activeTab) {
    case "category":
      return <TradieCategory filteredTradies={filteredTradiesByCategory} />;
    case "list":
      return <TradieList filteredTradies={filteredTradiesByCategory} />;
    case "table":
      return <TradieTable filteredTradies={filteredTradies} />;
    default:
      return null;
  }
}
