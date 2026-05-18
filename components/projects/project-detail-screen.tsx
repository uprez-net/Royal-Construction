"use client";

import { useEffect } from "react";

import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { resetProjectDetailUiState, setActiveProject } from "@/lib/store/slices/projectsSlice";
import type { ProjectDetail } from "@/types/project";

import { ProjectDetailTabs } from "./detail/project-detail-tabs";
import { ProjectHeader } from "./detail/project-header";
import { ProjectStatCards } from "./detail/project-stat-cards";

export function ProjectDetailScreen({ project }: { project: ProjectDetail }) {
  const dispatch = useAppDispatch();
  const activeProject = useAppSelector((state) => state.projects.activeProject);
  const displayedProject = activeProject?.id === project.id ? activeProject : project;

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
      <ProjectStatCards />
      <ProjectDetailTabs project={displayedProject} />
    </div>
  );
}
