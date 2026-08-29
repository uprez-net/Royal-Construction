"use client";

import { useEffect } from "react";

import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  addMilestonePhotos,
  addProjectMilestone,
  createTradieScheduleForProject,
  resetProjectDetailUiState,
  setActiveProject,
  updateProjectMilestoneStatus,
} from "@/lib/store/slices/projectsSlice";
import type { ProjectDetail } from "@/types/project";
import { useWebMcpTools } from "@/hooks/use-webmcp-tool";
import {
  toToolInputJsonSchema,
  toToolInputJsonSchemaWithParams,
} from "@/lib/tools/zod-to-json-schema";
import {
  summariseZodIssues,
  webMcpError,
  webMcpJson,
} from "@/components/webmcp/tool-result";
import {
  FilePickerCancelled,
  pickFiles,
  uploadFiles,
} from "@/components/webmcp/file-upload";
import {
  milestoneCreationSchema,
  milestonePictureUploadSchema,
  milestoneUpdateSchema,
} from "@/utils/validators/milestone";
import { createTradieScheduleSchema } from "@/utils/validators/tradies";

import { ProjectComplianceAlert } from "./detail/project-compliance-alert";
import { ProjectDetailTabs } from "./detail/project-detail-tabs";
import { ProjectHeader } from "./detail/project-header";
import { ProjectStatCards } from "./detail/project-stat-cards";
import type { Role } from "@prisma/client";
import { ProjectTradieAlert } from "./detail/project-tradie-alert";

const MAX_UPLOAD_FILES = 10;

/**
 * These are the schemas the browser's own routes validate against, so the tools
 * and the modals cannot drift:
 *   create_milestone         POST  /api/projects/[projectId]/milestones
 *   update_milestone         PATCH /api/projects/[projectId]/milestones/[id]/updates
 *   add_milestone_photos     POST  /api/projects/[projectId]/milestones/[id]/add-photos
 *   create_tradie_schedule   POST  /api/tradie-schedules
 *
 * projectId is supplied by the screen, never by the agent - the tools only
 * exist while a project is open, and acting on a different one silently would
 * be exactly the surprise this design is meant to avoid.
 */
const milestoneCreateJsonSchema = toToolInputJsonSchema(milestoneCreationSchema);
const milestoneUpdateJsonSchema = toToolInputJsonSchemaWithParams(milestoneUpdateSchema, {
  milestoneId: { type: "string", description: "The milestone to update." },
});
const milestonePhotosJsonSchema = toToolInputJsonSchemaWithParams(milestonePictureUploadSchema, {
  milestoneId: { type: "string", description: "The milestone to attach the files to." },
});
const tradieScheduleJsonSchema = toToolInputJsonSchema(
  createTradieScheduleSchema.omit({ projectId: true }),
);

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
      name: "create_milestone",
      title: "Add a milestone",
      description:
        "Adds a milestone to the project currently open. projectStage is required and must be one of the build stages. Pass parentId to nest this under an existing milestone.",
      inputSchema: milestoneCreateJsonSchema,
      annotations: { readOnlyHint: false },
      execute: async (input) => {
        const parsed = milestoneCreationSchema.safeParse(input);
        if (!parsed.success) {
          return webMcpError(summariseZodIssues(parsed.error));
        }

        const created = await dispatch(
          addProjectMilestone({ projectId: project.id, ...parsed.data }),
        ).unwrap();

        return webMcpJson({ id: created.id, name: created.name, status: created.status });
      },
    },
    {
      name: "update_milestone",
      title: "Update a milestone",
      description:
        "Moves a milestone on the open project to a new status. ACTIVE requires startDate. DONE requires startDate, actualDate and spend, and actualDate cannot precede startDate - send them in the same call or the update is rejected. Resolve milestoneId with get_milestones.",
      inputSchema: milestoneUpdateJsonSchema,
      annotations: { readOnlyHint: false },
      execute: async (input) => {
        const { milestoneId, ...rest } = input as { milestoneId?: unknown };
        const id = typeof milestoneId === "string" ? milestoneId.trim() : "";
        if (!id) {
          return webMcpError("milestoneId is required. Call get_milestones to resolve it.");
        }

        // The refined schema, not its shape: the conditional rules above are
        // the whole reason a half-filled DONE update has to fail here rather
        // than land as a milestone marked complete with no spend against it.
        const parsed = milestoneUpdateSchema.safeParse(rest);
        if (!parsed.success) {
          return webMcpError(summariseZodIssues(parsed.error));
        }

        const updated = await dispatch(
          updateProjectMilestoneStatus({
            projectId: project.id,
            milestoneId: id,
            ...parsed.data,
          }),
        ).unwrap();

        return webMcpJson({ id: updated.id, name: updated.name, status: updated.status });
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
    {
      name: "add_milestone_photos",
      title: "Attach uploaded files to a milestone",
      description:
        "Attaches already-uploaded files to a milestone on the open project. Get the ids from upload_project_files first; this does not upload anything itself.",
      inputSchema: milestonePhotosJsonSchema,
      annotations: { readOnlyHint: false },
      execute: async (input) => {
        const { milestoneId, ...rest } = input as { milestoneId?: unknown };
        const id = typeof milestoneId === "string" ? milestoneId.trim() : "";
        if (!id) {
          return webMcpError("milestoneId is required. Call get_milestones to resolve it.");
        }

        const parsed = milestonePictureUploadSchema.safeParse(rest);
        if (!parsed.success) {
          return webMcpError(summariseZodIssues(parsed.error));
        }

        const result = await dispatch(
          addMilestonePhotos({
            projectId: project.id,
            milestoneId: id,
            fileIds: parsed.data.fileIds,
          }),
        ).unwrap();

        return webMcpJson({ milestoneId: result.id, fileCount: result.files.length });
      },
    },
    {
      name: "create_tradie_schedule",
      title: "Schedule a tradie on this project",
      description:
        "Books a tradie onto the project currently open. Resolve tradieId with get_tradies, and milestoneId with get_milestones. scheduledDate is an ISO date.",
      inputSchema: tradieScheduleJsonSchema,
      annotations: { readOnlyHint: false },
      execute: async (input) => {
        const parsed = createTradieScheduleSchema.safeParse({
          ...input,
          projectId: project.id,
        });
        if (!parsed.success) {
          return webMcpError(summariseZodIssues(parsed.error));
        }

        const schedule = await dispatch(
          createTradieScheduleForProject(parsed.data),
        ).unwrap();

        return webMcpJson({
          id: schedule.id,
          tradieId: parsed.data.tradieId,
          scheduledDate: parsed.data.scheduledDate,
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
