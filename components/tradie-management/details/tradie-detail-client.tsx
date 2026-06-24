"use client";
import { useAppDispatch } from "@/lib/store/hooks";
import { setSelectedTradie } from "@/lib/store/slices/tradieManagementSlice";
import { TradieDetails } from "@/types/tradie";
import { useEffect } from "react";

export function TradieDetailClient({ tradie }: { tradie: TradieDetails }) {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch(setSelectedTradie(tradie));

    return () => {
      dispatch(setSelectedTradie(null));
    };
  }, [tradie]);

  return (
    <div className="flex flex-col gap-4 p-4">
      {JSON.stringify(tradie, null, 2)}
    </div>
  );
}
