"use client";

import { useEffect } from "react";

import { useAppDispatch } from "@/lib/store/hooks";
import { resetProjectDetailUiState, setActiveProject } from "@/lib/store/slices/projectsSlice";
import { openModal } from "@/lib/store/slices/uiSlice";
import type { ProjectDetail } from "@/types/project";

import { ProjectDetailTabs } from "./detail/project-detail-tabs";
import { ProjectHeader } from "./detail/project-header";
import { ProjectStatCards } from "./detail/project-stat-cards";

export function ProjectDetailScreen({ project }: { project: ProjectDetail }) {
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(setActiveProject(project));

    return () => {
      dispatch(setActiveProject(null));
      dispatch(resetProjectDetailUiState(project.id));
    };
  }, [dispatch, project]);

  return (
    <div className="space-y-4 pb-4">
      <ProjectHeader project={project} />
      <ProjectStatCards />
      <ProjectDetailTabs project={project} />
    </div>
  );
}
