"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { cn } from "@/lib/utils";
import { Download, Plus } from "lucide-react";
import { useTransition } from "react";

export function TradieHeader() {
  const dispatch = useAppDispatch();
  const [isPending, startTransition] = useTransition();

  const handleExport = async () => {
    // Implement export functionality here
    console.log("Export button clicked");
  };

  return (
    <Card className="overflow-hidden border-teal-100 bg-linear-to-br from-teal-50 via-emerald-50 to-green-100 shadow-sm">
      <CardContent className="relative p-6">
        <div className="absolute -right-12 -top-10 h-40 w-40 rounded-full bg-teal-500/10" />
        <div className="absolute -bottom-14 right-20 h-32 w-32 rounded-full bg-teal-700/10" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900">
              Tradie Management
            </h2>
            <p className="text-sm text-slate-600">
              Browse by trade category or switch views. Add, track incidents,
              update priority levels, and update pricing.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => dispatch(openModal({ type: "addTradie" }))}>
              <Plus className="mr-2 size-4" />
              Add Tradie
            </Button>
            <Button
              variant="outline"
              onClick={() => startTransition(handleExport)}
              disabled={isPending}
            >
              <Download
                className={cn("mr-2 size-4", isPending && "animate-pulse")}
              />
              Export
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
