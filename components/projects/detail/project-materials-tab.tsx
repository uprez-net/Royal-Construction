"use client";

import { useMemo, useState } from "react";
import {
  Boxes,
  CheckCircle,
  Clock,
  MinusCircle,
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

interface ProjectMaterialsTabProps {
  project: ProjectDetail;
}

export function ProjectMaterialsTab({ project }: ProjectMaterialsTabProps) {
  const dispatch = useAppDispatch();
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const isFiltered = trimmedQuery.length > 0;

  const filteredMaterials = useMemo(() => {
    if (!trimmedQuery) {
      return project.materials;
    }

    const needle = trimmedQuery.toLowerCase();
    return project.materials.filter((item) =>
      [item.name, item.category, item.specifications]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(needle)),
    );
  }, [project.materials, trimmedQuery]);

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

  const materialRows = filteredMaterials.map((item) => [
    <span key={`${item.id}-category`} className="font-medium text-foreground">
      {item.category}
    </span>,

    <span key={`${item.id}-product`}>{item.name}</span>,

    <span key={`${item.id}-spec`} className="text-muted-foreground">
      {item.specifications}
    </span>,

    <span key={`${item.id}-qty`} className="font-mono tabular-nums">
      {item.quantity}
    </span>,

    <span key={`${item.id}-unit`} className="font-mono tabular-nums">
      {currency.format(Number(item.unitCost))}
    </span>,

    <span
      key={`${item.id}-total`}
      className="font-mono font-medium tabular-nums text-foreground"
    >
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
  ]);

  return (
    <Card className="rounded-xl border-border/70 bg-card shadow-sm">
      <CardHeader className="border-b border-border/70 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle
            as="h2"
            className="text-base font-semibold text-foreground"
          >
            Selected materials
          </CardTitle>
          <div className="flex gap-2">
            <div className="relative w-full sm:w-[220px]">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search materials"
                className="h-9 rounded-lg bg-card pl-8 text-sm"
                aria-label="Search materials by name, category or specification"
              />
            </div>
            <Button
              size="sm"
              className="h-9 rounded-lg px-3.5 text-sm font-medium"
              onClick={() =>
                dispatch(
                  openModal({
                    type: "addMaterial",
                    payload: { project },
                  }),
                )
              }
            >
              <Plus className="mr-1 size-4" aria-hidden="true" />
              Add material
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 px-0 pb-5 pt-0">
        <p aria-live="polite" className="sr-only">
          {isFiltered
            ? `${filteredMaterials.length} of ${project.materials.length} materials match "${trimmedQuery}".`
            : `${project.materials.length} materials.`}
        </p>

        {isFiltered && filteredMaterials.length > 0 ? (
          <div className="mx-4 mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              Showing {filteredMaterials.length} of {project.materials.length}{" "}
              materials
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setQuery("")}
            >
              Clear search
            </Button>
          </div>
        ) : null}

        <div className="mx-4 mt-2">
          <DataTable
            mobileLayout="cards"
            mobileTitleColumn={1}
            mobileWideColumns={[2]}
            caption={`Materials selected for ${project.name}, with quantity, unit cost, total cost, order status and delivery status.`}
            headers={[
              "Category",
              "Product",
              "Specification",
              "Qty",
              "Unit cost",
              "Total",
              "Ordered",
              "Delivered",
            ]}
            align={[
              "start",
              "start",
              "start",
              "end",
              "end",
              "end",
              "start",
              "start",
            ]}
            rows={materialRows}
            emptyState={
              <div className="flex flex-col items-center justify-center gap-3">
                <div className="flex size-12 items-center justify-center">
                  <Boxes
                    className="size-5 text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {isFiltered
                      ? "No matching materials"
                      : "No materials added"}
                  </p>

                  <p className="text-xs text-muted-foreground">
                    {isFiltered
                      ? `Nothing matches "${trimmedQuery}".`
                      : "Materials for this project will appear here."}
                  </p>
                </div>

                {isFiltered ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setQuery("")}
                  >
                    Clear search
                  </Button>
                ) : null}
              </div>
            }
          />
        </div>

        <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-4 py-3">
          <p className="text-sm text-foreground">
            <span className="font-medium">Total materials cost:</span>{" "}
            <span className="ml-1 font-mono text-base font-semibold tabular-nums text-foreground">
              {currency.format(totalMaterialCost)}
            </span>
          </p>
          <div className="flex gap-1.5">
            <StatusPill tone="success">
              <CheckCircle className="mr-1 size-3" aria-hidden="true" />
              {deliveredMaterials} delivered
            </StatusPill>
            <StatusPill tone="primary">
              <Clock className="mr-1 size-3" aria-hidden="true" />
              {installedMaterials} installed
            </StatusPill>
            <StatusPill tone="neutral">
              <MinusCircle className="mr-1 size-3" aria-hidden="true" />
              {pendingMaterials} pending
            </StatusPill>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
