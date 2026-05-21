"use client";

import { useMemo, useState } from "react";
import {
  Boxes,
  CheckCircle,
  Clock,
  MinusCircle,
  PenSquare,
  Plus,
  Search,
} from "lucide-react";

import { StatusPill } from "@/components/common/status-pill";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { ProjectDetail } from "@/types/project";
import { DataTable } from "@/components/common/data-table";
import { currency } from "@/utils/formatters";
import { toast } from "sonner";

interface ProjectMaterialsTabProps {
  project: ProjectDetail;
}

export function ProjectMaterialsTab({ project }: ProjectMaterialsTabProps) {
  const dispatch = useAppDispatch();
  const [query, setQuery] = useState("");
  const {
    pendingMaterials,
    deliveredMaterials,
    installedMaterials,
    totalMaterialCost,
  } = useMemo(() => {
    const pendingMaterials = project.materials.filter(
      (item) => item.status === "PENDING",
    ).length;
    const deliveredMaterials = project.materials.filter((item) =>
      ["DELIVERED", "INSTALLED"].includes(item.status),
    ).length;
    const installedMaterials = project.materials.filter(
      (item) => item.status === "INSTALLED",
    ).length;
    const totalMaterialCost = project.materials.reduce(
      (sum, item) => sum + Number(item.totalCost),
      0,
    );

    return {
      pendingMaterials,
      deliveredMaterials,
      installedMaterials,
      totalMaterialCost,
    };
  }, [project.materials]);

  const materialRows = project.materials.map((item) => [
    <span key={`${item.id}-category`} className="font-medium text-foreground">
      {item.category}
    </span>,

    <span key={`${item.id}-product`}>{item.name}</span>,

    <span key={`${item.id}-spec`} className="text-muted-foreground">
      {item.specifications}
    </span>,

    <span key={`${item.id}-qty`}>{item.quantity}</span>,

    <span key={`${item.id}-unit`}>
      {currency.format(Number(item.unitCost))}
    </span>,

    <span key={`${item.id}-total`} className="font-semibold text-foreground">
      {currency.format(Number(item.totalCost))}
    </span>,

    <StatusPill
      key={`${item.id}-ordered`}
      tone={item.status !== "PENDING" ? "success" : "neutral"}
    >
      {item.status === "PENDING" ? "No" : "Yes"}
    </StatusPill>,

    <StatusPill
      key={`${item.id}-delivered`}
      tone={
        ["DELIVERED", "INSTALLED"].includes(item.status) ? "success" : "neutral"
      }
    >
      {["DELIVERED", "INSTALLED"].includes(item.status) ? "Yes" : "No"}
    </StatusPill>,

    <div key={`${item.id}-actions`} className="flex justify-end">
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        onClick={() => {
          // edit action
          toast.info("Edit material feature coming soon!");
        }}
      >
        <PenSquare className="size-3.5" />
      </Button>
    </div>,
  ]);

  return (
    <Card className="border-border/80 bg-white shadow-sm transition-all hover:shadow-md rounded-xl">
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            Selected Materials from Catalogue
          </CardTitle>
          <div className="flex gap-2">
            <div className="relative w-full sm:w-[220px] transition-all focus-within:w-[280px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-[13px] -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search materials..."
                className="pl-[32px] h-9 text-[12.5px] rounded-lg bg-white"
                aria-label="Search materials"
              />
            </div>
            <Button
              size="sm"
              className="h-9 rounded-lg bg-teal-600 px-[14px] text-[12.5px] font-semibold text-white hover:bg-teal-700"
              onClick={() =>
                dispatch(
                  openModal({
                    type: "addMaterial",
                    payload: { project },
                  }),
                )
              }
            >
              <Plus className="mr-1 size-4" />
              Add Material
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0 px-0 pb-5">
        <div className="mx-4 mt-2 rounded-lg border border-border/60">
          <DataTable
            headers={[
              "Category",
              "Product",
              "Specification",
              "Qty",
              "Unit Cost",
              "Total",
              "Ordered",
              "Delivered",
              <div key="action-header" className="text-right">
                Action
              </div>,
            ]}
            rows={materialRows}
            emptyState={
              <div className="flex flex-col items-center justify-center gap-3">
                <div className="flex size-12 items-center justify-center">
                  <Boxes className="size-5 text-muted-foreground" />
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    No materials added
                  </p>

                  <p className="text-xs text-muted-foreground">
                    Materials for this project will appear here.
                  </p>
                </div>
              </div>
            }
          />
        </div>

        <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-4 py-3">
          <div className="text-[13px]">
            <b>Total Materials Cost:</b>{" "}
            <span className="ml-1 text-base font-extrabold text-teal-600">
              {currency.format(totalMaterialCost)}
            </span>
          </div>
          <div className="flex gap-1.5">
            <StatusPill tone="success">
              <CheckCircle className="mr-1 size-3" />
              {deliveredMaterials} Delivered
            </StatusPill>
            <StatusPill tone="primary">
              <Clock className="mr-1 size-3" />
              {installedMaterials} Installed
            </StatusPill>
            <StatusPill tone="neutral">
              <MinusCircle className="mr-1 size-3" />
              {pendingMaterials} Pending
            </StatusPill>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
