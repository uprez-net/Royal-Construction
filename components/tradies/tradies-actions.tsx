"use client";

import { useRouter } from "next/navigation";

import { ScheduleTradieModal } from "@/components/tradies/schedule-tradie-modal";
import { TradieDirectoryModal } from "@/components/tradies/tradie-directory-modal";

export function TradiesActions() {
  const router = useRouter();

  return (
    <div className="flex flex-wrap gap-2">
      <ScheduleTradieModal onSuccess={() => router.refresh()} />
      <TradieDirectoryModal />
    </div>
  );
}
