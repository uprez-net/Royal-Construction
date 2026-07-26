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

  // Seeding is keyed on the server props, so it re-runs when they change.
  useEffect(() => {
    dispatch(setTradies(tradies));
    dispatch(setKPIData(tradieKPIData));
  }, [dispatch, tradies, tradieKPIData]);

  // Teardown is a separate effect keyed on [dispatch] alone, so it runs only on
  // unmount. Combining the two meant every `tradies` prop change ran the
  // cleanup first — clearing the slice and re-seeding it on each update.
  //
  // The original guard here (`if (!pathname.includes("tradie-management"))`)
  // could never fire at all: the cleanup closes over the pathname from the
  // render that scheduled it, which on this page always matches. So the slice
  // was never cleared and leaked across navigations.
  useEffect(() => {
    return () => {
      dispatch(clearState());
    };
  }, [dispatch]);

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
