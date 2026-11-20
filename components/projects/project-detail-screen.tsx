"use client";

import { useEffect } from "react";

import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  resetProjectDetailUiState,
  setActiveProject,
} from "@/lib/store/slices/projectsSlice";
import type { ProjectDetail } from "@/types/project";

import { ProjectAlerts } from "./detail/project-alerts";
import { ProjectComplianceAlert } from "./detail/project-compliance-alert";
import { UploadHintScope } from "@/components/common/upload-hints";
import { ProjectDetailTabs } from "./detail/project-detail-tabs";
import { ProjectHeader } from "./detail/project-header";
import { ProjectNotAssignedNotice } from "./detail/project-not-assigned-notice";
import { ProjectStatCards } from "./detail/project-stat-cards";
import { Role } from "@prisma/client";

type ProjectRequirementsHeader = {
  siteAddress?: string | null;
  signedDate?: string | null;
  pcaInspector?: string | null;
  insuranceClaimStartDate?: string | null;
  insuranceClaimEndDate?: string | null;
  hbcfInsuranceNumber?: string | null;
};

export function ProjectDetailScreen({
  project,
  role,
  viewerId,
}: {
  project: ProjectDetail;
  role: Role;
  /** The signed-in user's id: whose notes they may delete. */
  viewerId: string;
}) {
  const dispatch = useAppDispatch();
  const activeProject = useAppSelector((state) => state.projects.activeProject);
  // Prefer the store copy once it has been hydrated for this project so
  // in-page mutations are reflected; fall back to the server payload.
  const displayedProject =
    activeProject && activeProject.id === project.id ? activeProject : project;
  const {
    siteAddress,
    signedDate,
    pcaInspector,
    insuranceClaimStartDate,
    insuranceClaimEndDate,
    hbcfInsuranceNumber,
  } =
    displayedProject.requirements?.legalAdministration
    || ({} as ProjectRequirementsHeader);

  // Hydrating follows `project`: router.refresh() (a status change, a send)
  // hands down a fresh object and the store copy must follow it.
  useEffect(() => {
    dispatch(setActiveProject(project));
  }, [dispatch, project]);

  // Resetting follows the project's id only. It used to share the effect
  // above, so every router.refresh() ran this cleanup too: the stored tab was
  // deleted (the page jumped to Overview while the URL still said
  // `activeTab=tradies`) and in-flight upload state was dropped. The screen
  // leaving, or moving to another project, is what ends the UI state.
  useEffect(() => {
    return () => {
      dispatch(setActiveProject(null));
      dispatch(resetProjectDetailUiState(project.id));
    };
  }, [dispatch, project.id]);

  return (
    <UploadHintScope trail="Project">
      <div className="space-y-4 pb-4">
        <ProjectHeader
          project={displayedProject}
          canAssignSiteManager={role === Role.ADMIN}
          key={`header-${siteAddress}-${signedDate}-${pcaInspector}-${insuranceClaimStartDate}-${insuranceClaimEndDate}-${hbcfInsuranceNumber}`}
        />
        <ProjectStatCards role={role} />
        {displayedProject.viewerAccess.manage ? null : (
          <ProjectNotAssignedNotice />
        )}
        <ProjectComplianceAlert project={displayedProject} />
        <ProjectAlerts project={displayedProject} />
        <ProjectDetailTabs
          project={displayedProject}
          role={role}
          viewerId={viewerId}
        />
      </div>
    </UploadHintScope>
  );
}
