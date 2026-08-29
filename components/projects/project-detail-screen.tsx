"use client";

import { useEffect } from "react";

import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  resetProjectDetailUiState,
  setActiveProject,
} from "@/lib/store/slices/projectsSlice";
import type { ProjectDetail } from "@/types/project";
import { useWebMcpTools } from "@/hooks/use-webmcp-tool";
import { webMcpError, webMcpJson } from "@/components/webmcp/tool-result";
import {
  describeTradieAlerts,
  selectComplianceWarnings,
} from "@/lib/projects/project-warnings";
import {
  FilePickerCancelled,
  pickFiles,
  uploadFiles,
} from "@/components/webmcp/file-upload";

import { ProjectComplianceAlert } from "./detail/project-compliance-alert";
import { ProjectDetailTabs } from "./detail/project-detail-tabs";
import { ProjectHeader } from "./detail/project-header";
import { ProjectStatCards } from "./detail/project-stat-cards";
import type { Role } from "@prisma/client";
import { ProjectTradieAlert } from "./detail/project-tradie-alert";

const MAX_UPLOAD_FILES = 10;

/**
 * Only two tools live at screen level, and for the same reason: they belong to
 * the project rather than to any one tab.
 *
 * Everything else moved to the tab that owns its state. That is not tidiness —
 * a milestone tool needs to know which stage is workable and which transitions
 * are legal, and only the milestone tab knows that. Registering it here would
 * mean either duplicating the ledger or letting an agent attempt work the UI
 * would not offer.
 *
 * projectId is supplied by the screen, never by the agent: the tools exist only
 * while a project is open, and acting on a different one silently would be
 * exactly the surprise this design avoids.
 */
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
}: {
  project: ProjectDetail;
  role: Role;
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
    displayedProject.requirements?.legalAdministration ||
    ({} as ProjectRequirementsHeader);

  useEffect(() => {
    dispatch(setActiveProject(project));

    return () => {
      dispatch(setActiveProject(null));
      dispatch(resetProjectDetailUiState(project.id));
    };
  }, [dispatch, project]);

  /* ── WebMCP: tools scoped to the open project ──
     These replace MCP server tools that called lib/data directly. Going through
     the same Redux thunks the modals use means an agent write lands in the
     store, so the tabs the user is looking at update - and it means the tool
     and the form cannot disagree about what a valid payload is. */
  useWebMcpTools([
    {
      name: "get_project_warnings",
      title: "What needs attention on this project",
      description:
        "Reports what is wrong with the project currently open: compliance details missing from a live job, and tradie bookings that are confirmed or attached to a milestone due within the week. This is the same set the warning chips and alert cards on screen are showing, so you can answer \u201cwhat is blocking this?\u201d without reading the page.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async () => {
        // Two branches of the same project, reported separately because they
        // are separate problems with separate fixes: compliance is a form to
        // fill on the overview tab, a booking alert is a person to call.
        const compliance = selectComplianceWarnings(displayedProject);
        const tradies = describeTradieAlerts(displayedProject.tradieSchedules);

        return webMcpJson({
          projectId: displayedProject.id,
          projectName: displayedProject.name,
          status: displayedProject.status,
          compliance,
          tradies,
          hasWarnings: compliance.length > 0 || tradies.length > 0,
        });
      },
    },
    {
      name: "upload_project_files",
      title: "Upload files to this project",
      description:
        "Opens the file picker so the user can attach files to the project currently open, optionally against a milestone, then uploads them. Returns file ids and URLs for add_milestone_photos and create_project_update. You cannot supply file content yourself, so this is how files get in.",
      inputSchema: {
        type: "object",
        properties: {
          milestoneId: {
            type: "string",
            description: "Attach the files to this milestone instead of the project root.",
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: async (input) => {
        const milestoneId =
          typeof input.milestoneId === "string" && input.milestoneId.trim()
            ? input.milestoneId.trim()
            : null;

        let chosen: File[];
        try {
          chosen = await pickFiles({ multiple: true, maxFiles: MAX_UPLOAD_FILES });
        } catch (error) {
          if (error instanceof FilePickerCancelled) {
            return webMcpError(
              "The file picker closed without a selection. Ask the user to pick the files, then try again.",
            );
          }
          throw error;
        }

        if (chosen.length === 0) {
          return webMcpError("No files were selected.");
        }

        const uploaded = await uploadFiles(chosen, {
          kind: "project",
          projectId: project.id,
          milestoneId,
        });

        return webMcpJson({
          projectId: project.id,
          milestoneId,
          files: uploaded.map(({ id, name, url }) => ({ fileId: id, fileName: name, url })),
        });
      },
    },
  ]);

  return (
    <div className="space-y-4 pb-4">
      <ProjectHeader
        project={displayedProject}
        key={`header-${siteAddress}-${signedDate}-${pcaInspector}-${insuranceClaimStartDate}-${insuranceClaimEndDate}-${hbcfInsuranceNumber}`}
      />
      <ProjectStatCards role={role} />
      <ProjectComplianceAlert project={displayedProject} />
      <ProjectTradieAlert project={displayedProject} />
      <ProjectDetailTabs project={displayedProject} role={role} />
    </div>
  );
}
