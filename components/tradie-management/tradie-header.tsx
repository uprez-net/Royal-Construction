"use client";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";
import { exportTradies } from "@/lib/data/tradie-management";
import { downloadWorkbook } from "@/lib/spreadsheet/download-workbook";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { cn } from "@/lib/utils";
import { Download, Plus } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

export function TradieHeader({ isOffice }: { isOffice: boolean }) {
  const dispatch = useAppDispatch();
  const [isPending, startTransition] = useTransition();

  const handleExport = async () => {
    try {
      const allTradies = await exportTradies();
      const tradieHeader = [
        "name",
        "trade",
        "phone",
        "email",
        "lastQuotedPrice",
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
        t.lastQuotedPrice,
        t.rating,
        t.openIncidents,
        t.scheduledJobs,
        t.jobsCompleted,
      ]);

      await downloadWorkbook(
        [{ name: "Tradie Data", rows: [tradieHeader, ...tradieRows] }],
        `Royal_Constructions_Tradies_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      toast.success("Tradies exported.");
    } catch (error) {
      toast.error("Could not export tradies. Please try again.");
      console.error("Error exporting tradies:", error);
    }
  };

  return (
    <PageHeader
      headingLevel="h1"
      title="Tradie management"
      description={
        isOffice
          ? "Browse by trade category or switch views. Add tradies, track incidents, update priority levels and update pricing."
          : "Browse by trade category or switch views. Track incidents and rate tradies."
      }
      // Export writes every tradie's last quoted price into the sheet, so it is
      // the office's too; a site manager gets no actions here.
      actions={
        isOffice ? (
          <>
            <Button
              size="lg"
              onClick={() => dispatch(openModal({ type: "addTradie" }))}
            >
              <Plus className="mr-2 size-4" aria-hidden="true" />
              Add tradie
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => startTransition(handleExport)}
              disabled={isPending}
            >
              <Download
                className={cn("mr-2 size-4", isPending && "animate-pulse")}
                aria-hidden="true"
              />
              {isPending ? "Exporting…" : "Export"}
            </Button>
          </>
        ) : undefined
      }
    />
  );
}
