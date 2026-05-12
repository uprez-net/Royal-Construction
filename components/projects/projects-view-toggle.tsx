"use client";

import Link from "next/link";
import { useState } from "react";
import { Grid2x2, List } from "lucide-react";

import { DataTable } from "@/components/common/data-table";
import { ProjectCard } from "@/components/project/project-card";
import { Button } from "@/components/ui/button";
import { ProjectWithStats } from "@/lib/data/projects";

const currency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

const dateFormat = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function formatStatus(status: string) {
  return status
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

export function ProjectsViewToggle({ projects }: { projects: ProjectWithStats[] }) {
  const [view, setView] = useState<"grid" | "list">("grid");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {projects.length} live projects loaded from Prisma.
        </p>
        <div className="inline-flex items-center gap-2">
          <Button
            type="button"
            variant={view === "grid" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("grid")}
          >
            <Grid2x2 className="size-4" />
            Grid View
          </Button>
          <Button
            type="button"
            variant={view === "list" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("list")}
          >
            <List className="size-4" />
            List View
          </Button>
        </div>
      </div>

      {view === "grid" ? (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              id={project.id}
              name={project.name}
              location={project.location}
              status={project.status}
              progressPercent={project.progressPercent}
              spent={Number(project.spent)}
              totalBudget={Number(project.totalBudget)}
              estimatedEndDate={project.estimatedEndDate}
              customerName={project.customer.name}
            />
          ))}
        </div>
      ) : (
        <DataTable
          headers={["Name", "Customer", "Location", "Status", "Progress", "Budget", "End Date"]}
          rows={projects.map((project) => [
            <Link key={project.id} href={`/project-detail/${project.id}`} className="font-medium text-teal-700 hover:underline">
              {project.name}
            </Link>,
            project.customer.name,
            project.location,
            formatStatus(project.status),
            `${project.progressPercent}%`,
            currency.format(Number(project.totalBudget)),
            dateFormat.format(project.estimatedEndDate),
          ])}
        />
      )}
    </div>
  );
}
