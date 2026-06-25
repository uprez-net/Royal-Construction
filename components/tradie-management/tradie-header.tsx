"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { exportTradies } from "@/lib/data/tradie-management";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { cn } from "@/lib/utils";
import { Download, Plus } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

export function TradieHeader() {
  const dispatch = useAppDispatch();
  const [isPending, startTransition] = useTransition();

  const handleExport = async () => {
    try {
      // Implement export functionality here
      const allTradies = await exportTradies();
      const tradieHeader = [
        "name",
        "trade",
        "phone",
        "email",
        "hourlyRate",
        "rating",
        "open incidents",
        "scheduled jobs",
        "jobs completed",
      ];

      const tradieRows = allTradies.map((t) => [
        t.name,
        t.trade,
        t.phone,
        t.email,
        t.hourlyRate,
        t.rating,
        t.openIncidents,
        t.scheduledJobs,
        t.jobsCompleted,
      ]);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([tradieHeader, ...tradieRows]),
        "Tradie Data",
      );

      XLSX.writeFile(
        wb,
        `Royal_Constructions_Tradies_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      toast.success("Tradies exported successfully!");
    } catch (error) {
      toast.error("Error exporting tradies. Please try again.");
      console.error("Error exporting tradies:", error);
    }
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
