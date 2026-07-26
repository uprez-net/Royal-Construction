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

  // Cleanup always runs, unconditionally. The previous guard —
  // `if (!pathname.includes("tradie-management")) clearState()` — could never
  // fire: the cleanup closes over the pathname from the render that scheduled
  // it, which on this page always contains "tradie-management". So the tradie
  // slice was never cleared and leaked across navigations. This component
  // remounts and re-seeds from server props on every visit.
  useEffect(() => {
    dispatch(setTradies(tradies));
    dispatch(setKPIData(tradieKPIData));
    return () => {
      dispatch(clearState());
    };
  }, [dispatch, tradies, tradieKPIData]);

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
