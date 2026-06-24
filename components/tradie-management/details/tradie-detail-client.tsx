"use client";
import { Button } from "@/components/ui/button";
import { useAppDispatch } from "@/lib/store/hooks";
import { setSelectedTradie } from "@/lib/store/slices/tradieManagementSlice";
import { TradieDetails } from "@/types/tradie";
import { ArrowLeft } from "lucide-react";
import { useEffect } from "react";
import { TradieCard } from "./tradie-detail-header";
import {
  TradieBusinessDetailsCard,
  TradiePriorityCard,
} from "./tradie-details-body";
import { TradieIncidentsCard } from "./tradie-incident-card";
import Link from "next/link";

export function TradieDetailClient({ tradie }: { tradie: TradieDetails }) {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch(setSelectedTradie(tradie));

    return () => {
      dispatch(setSelectedTradie(null));
    };
  }, [tradie, dispatch]);

  return (
    <div className="space-y-4">
      <Link href="/tradie-management">
        <Button
          variant="ghost"
          className="flex items-center gap-2 text-muted-foreground"
        >
          <ArrowLeft className="size-5" />
          Back to Tradies
        </Button>
      </Link>
      <TradieCard />
      <div className="grid gap-4 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-8">
          <TradieBusinessDetailsCard />
        </div>

        <div className="lg:col-span-4">
          <TradiePriorityCard />
        </div>
      </div>
      <TradieIncidentsCard />
    </div>
  );
}
