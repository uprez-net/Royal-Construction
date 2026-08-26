"use client";

import { useEffect } from "react";

import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { resetProjectDetailUiState, setActiveProject } from "@/lib/store/slices/projectsSlice";
import type { ProjectDetail } from "@/types/project";

import { ProjectComplianceAlert } from "./detail/project-compliance-alert";
import { ProjectDetailTabs } from "./detail/project-detail-tabs";
import { ProjectHeader } from "./detail/project-header";
import { ProjectStatCards } from "./detail/project-stat-cards";
import type { Role } from "@prisma/client";
import { ProjectTradieAlert } from "./detail/project-tradie-alert";

export function ProjectDetailScreen({ project, role }: { project: ProjectDetail; role: Role }) {
  const dispatch = useAppDispatch();
  const activeProject = useAppSelector((state) => state.projects.activeProject);
  // Prefer the store copy once it has been hydrated for this project so
  // in-page mutations are reflected; fall back to the server payload.
  const displayedProject =
    activeProject && activeProject.id === project.id ? activeProject : project;

  useEffect(() => {
    dispatch(setActiveProject(project));

    return () => {
      dispatch(setActiveProject(null));
      dispatch(resetProjectDetailUiState(project.id));
    };
  }, [dispatch, project]);

  return (
    <div className="space-y-4 pb-4">
      <ProjectHeader project={displayedProject} />
      <ProjectStatCards role={role} />
      <ProjectComplianceAlert project={displayedProject} />
      <ProjectTradieAlert project={displayedProject} />
      <ProjectDetailTabs project={displayedProject} role={role} />
    </div>
  );
}
