"use client";

import { TradiesByCategory } from "@/types/tradie";
import { TradieHeader } from "./tradie-header";
import { TradieKPI } from "./tradie-kpi";
import { DataPoint } from "../common/metric-card";
import { useAppDispatch } from "@/lib/store/hooks";
import { useEffect } from "react";
import {
  clearState,
  setKPIData,
  setTradies,
} from "@/lib/store/slices/tradieManagementSlice";
import { UnresolvedIncidentsCard } from "./tradie-warning-badge";
import { TradieTabs } from "./tradie-tabs";
import { TradieBody } from "./tradie-body";
import { usePathname } from "next/navigation";

interface TradieManagementClientProps {
  tradies: TradiesByCategory[];
  tradieKPIData: {
    registeredTradies: DataPoint;
    incidentLodged: DataPoint;
    favouriteTradies: DataPoint;
  };
}

export function TradieManagementClient({
  tradies,
  tradieKPIData,
}: TradieManagementClientProps) {
  const dispatch = useAppDispatch();
  const pathname = usePathname();

  useEffect(() => {
    dispatch(setTradies(tradies));
    dispatch(setKPIData(tradieKPIData));
    return () => {
      if (!pathname.includes("tradie-management")) {
        dispatch(clearState());
      }
    };
  }, [dispatch, tradies, tradieKPIData, pathname]);

  return (
    <div className="space-y-6">
      <TradieHeader />
      <TradieKPI />
      <UnresolvedIncidentsCard />
      <TradieTabs />
      <TradieBody />
    </div>
  );
}
