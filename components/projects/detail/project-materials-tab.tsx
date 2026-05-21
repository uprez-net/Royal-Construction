"use client";

import { useMemo, useState } from "react";
import {
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
import { projectMaterialsMock } from "@/lib/mock-data";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { ProjectDetail } from "@/types/project";

function toneForMaterialStatus(
  status: "Yes" | "Partial" | "Pending" | "Not Yet" | "No",
) {
  if (status === "Yes") return "success" as const;
  if (status === "Partial" || status === "Pending") return "warning" as const;
  return "neutral" as const;
}

interface ProjectMaterialsTabProps {
  project: ProjectDetail;
}

export function ProjectMaterialsTab({ project }: ProjectMaterialsTabProps) {
  const dispatch = useAppDispatch();
  const [query, setQuery] = useState("");

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
      return projectMaterialsMock;
    }

    return projectMaterialsMock.filter((item) => {
      return (
        item.category.toLowerCase().includes(normalized) ||
        item.product.toLowerCase().includes(normalized) ||
        item.specification.toLowerCase().includes(normalized)
      );
    });
  }, [query]);

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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground bg-slate-50">
                <th className="py-2.5 px-[14px] whitespace-nowrap">Category</th>
                <th className="py-2.5 px-[14px] whitespace-nowrap">Product</th>
                <th className="py-2.5 px-[14px] whitespace-nowrap">
                  Specification
                </th>
                <th className="py-2.5 px-[14px] whitespace-nowrap">Qty</th>
                <th className="py-2.5 px-[14px] whitespace-nowrap">
                  Unit Cost
                </th>
                <th className="py-2.5 px-[14px] whitespace-nowrap">Total</th>
                <th className="py-2.5 px-[14px] whitespace-nowrap">Ordered</th>
                <th className="py-2.5 px-[14px] whitespace-nowrap">
                  Delivered
                </th>
                <th className="py-2.5 px-[14px] whitespace-nowrap text-right">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-slate-100 align-middle transition-colors hover:bg-slate-50/80 cursor-pointer"
                >
                  <td className="py-3 px-[14px] text-slate-900">
                    {item.category}
                  </td>
                  <td className="py-3 px-[14px]">{item.product}</td>
                  <td className="py-3 px-[14px] text-slate-600">
                    {item.specification}
                  </td>
                  <td className="py-3 px-[14px]">{item.quantity}</td>
                  <td className="py-3 px-[14px]">{item.unitCost}</td>
                  <td className="py-3 px-[14px] font-medium text-slate-900">
                    {item.totalCost}
                  </td>
                  <td className="py-3 px-[14px]">
                    <StatusPill
                      tone={toneForMaterialStatus(item.orderedStatus)}
                    >
                      {item.orderedStatus}
                    </StatusPill>
                  </td>
                  <td className="py-3 px-[14px]">
                    <StatusPill
                      tone={toneForMaterialStatus(item.deliveredStatus)}
                    >
                      {item.deliveredStatus}
                    </StatusPill>
                  </td>
                  <td className="py-3 px-[14px] text-right">
                    <button className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-all hover:border-teal-600 hover:bg-teal-600/10 hover:text-teal-600">
                      <PenSquare className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-4 py-3">
          <div className="text-[13px]">
            <b>Total Materials Cost:</b>{" "}
            <span className="ml-1 text-base font-extrabold text-teal-600">
              $90,060
            </span>
          </div>
          <div className="flex gap-1.5">
            <StatusPill tone="success">
              <CheckCircle className="mr-1 size-3" />5 Delivered
            </StatusPill>
            <StatusPill tone="warning">
              <Clock className="mr-1 size-3" />1 Partial
            </StatusPill>
            <StatusPill tone="neutral">
              <MinusCircle className="mr-1 size-3" />2 Pending
            </StatusPill>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
