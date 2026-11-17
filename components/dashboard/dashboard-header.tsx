"use client";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";
import { normalizeTypes } from "@/lib/leads/lead-helpers";
import { fetchAllLeads } from "@/lib/leads/leads-service";
import { downloadWorkbook } from "@/lib/spreadsheet/download-workbook";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { Download, Plus, RotateCw } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface DashboardHeaderProps {
  /** Today in Sydney, e.g. "Mon 16 Nov 2026". */
  today: string;
}

export function DashboardHeader({ today }: DashboardHeaderProps) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const allLeads = await fetchAllLeads();
      const leadHeader = [
        "leadId",
        "name",
        "phone",
        "email",
        "location",
        "SourceDetail",
        "Stage",
        "assigned",
        "budget",
        "notes",
        "FollowupsDate",
        "FollowupTime",
        "type",
        "lostReason",
        "urgent",
      ];
      const leadRows = allLeads.map((l) => {
        const types = normalizeTypes(l.type).filter(
          (t) => t !== "Not Specified",
        );
        return [
          l.id,
          l.name,
          l.phone,
          l.email,
          l.location,
          l.sourceDetail,
          l.stage,
          l.assignedUser?.name || "",
          l.budget,
          l.notes || "",
          l.followupDate || "",
          l.followupTime || "",
          types.join(", "),
          l.lostReason || "",
          l.urgent ? "true" : "false",
        ];
      });
      const historyHeader = [
        "leadId",
        "action",
        "detail",
        "type",
        "actionDate",
      ];
      const historyRows = allLeads.flatMap((l) =>
        (l.history ?? []).map((e) => [
          l.id,
          e.action,
          e.detail,
          e.type,
          `${e.date} ${e.time}`.trim(),
        ]),
      );
      await downloadWorkbook(
        [
          { name: "Lead Data", rows: [leadHeader, ...leadRows] },
          { name: "Lead history", rows: [historyHeader, ...historyRows] },
        ],
        `Royal_Constructions_Leads_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } catch (error) {
      console.error("Failed to export leads:", error);
      toast.error("Failed to export leads");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <PageHeader
      headingLevel="h1"
      title="Dashboard"
      description={today}
      actions={
        <>
          <Button onClick={() => dispatch(openModal({ type: "createLead" }))}>
            <Plus className="mr-2 size-4" />
            Add Lead
          </Button>

          <Button
            variant="outline"
            onClick={() => void handleExport()}
            disabled={isExporting}
          >
            {isExporting ? (
              <span className="flex items-center">
                <RotateCw className="mr-2 size-4 animate-spin" /> Exporting...
              </span>
            ) : (
              <span className="flex items-center">
                <Download className="mr-2 size-4" /> Export Leads
              </span>
            )}
          </Button>

          <Button
            variant="outline"
            size="icon"
            className="items-center justify-center"
            onClick={() => router.refresh()}
            aria-label="Refresh dashboard"
          >
            <RotateCw className="size-4" />
          </Button>
        </>
      }
    />
  );
}
