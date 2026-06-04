"use client";
import { useAppSelector } from "@/lib/store/hooks";
import { useAppDispatch } from "@/lib/store/hooks";
import { closeModal, openModal } from "@/lib/store/slices/uiSlice";

import { AddUpdateModal } from "@/components/projects/add-update-modal";
import { CreateVariationModal } from "@/components/projects/create-variation-modal";

import { ConfirmStatusModal } from "@/components/tradies/confirm-status-modal";
import { LogCallModal } from "@/components/tradies/log-call-modal";
import { ScheduleTradieModal } from "@/components/tradies/schedule-tradie-modal";
import { TradieDirectoryModal } from "@/components/tradies/tradie-directory-modal";

import type {
  ProjectDetail,
  ProjectWithStats,
  TradieScheduleListItem,
  TradieUrgentReminderItem,
} from "@/types/project";
import { CreateProjectModal } from "../projects/create-project-modal";
import { ReminderModal } from "../tradies/reminder-send-modal";
import { TradieScheduleDetailsModal } from "../tradies/details-view-modal";
import {
  clearSelectedSchedules,
  fetchTradieCoordinationDashboard,
  updateTradieScheduleStatus,
} from "@/lib/store/slices/tradiesSlice";
import { toast } from "sonner";
import { MilestoneStatus, TradieScheduleStatus } from "@prisma/client";
import { ProjectDetailModal } from "../projects/project-detail-modal";
import { AddMaterialModal } from "../projects/add-material-modal";
import { PreviewPictureModal } from "../common/preview-picture-modal";
import UpdateMilestoneModal from "../projects/detail/update-milestone-modal";
import AddMilestoneModal from "../projects/detail/add-milestone-modal";
import AddMilestonePictureModal from "../projects/detail/add-milestone-picture";
import { CreateOfferFileModal } from "../quotes/create-offer-modal";

export function ModalManager() {
  const modal = useAppSelector((state) => state.ui.modal);
  const dispatch = useAppDispatch();

  const handleClose = () => dispatch(closeModal());
  const handleSuccess = () => {
    handleClose();
  };

  const projectPayload = modal.payload?.project as ProjectDetail | undefined;
  const projectId =
    projectPayload?.id ?? String(modal.payload?.projectId ?? "");
  const projectMilestones =
    projectPayload?.milestones.map((milestone) => ({
      id: milestone.id,
      name: milestone.name,
    })) ??
    (modal.payload?.milestones as { id: string; name: string }[]) ??
    [];

  if (!modal.type) {
    return null;
  }

  const updateScheduleStatuses = async (
    ids: string[],
    status: TradieScheduleStatus,
  ) => {
    if (ids.length === 0) return;

    await Promise.all(
      ids.map(async (id) =>
        // dispatch thunk so state updates are driven by reducers
        dispatch(updateTradieScheduleStatus({ scheduleId: id, status })),
      ),
    );

    dispatch(clearSelectedSchedules());
    dispatch(fetchTradieCoordinationDashboard({ force: true }));
  };

  const handleRowQuickConfirm = async (row: TradieScheduleListItem) => {
    const loading = toast.loading("Updating status...");
    handleClose();
    try {
      await updateScheduleStatuses([row.id], TradieScheduleStatus.CONFIRMED);
    } catch (error) {
      toast.error("Failed to update status. Please try again.");
      console.error("Error updating tradie schedule status:", error);
    } finally {
      toast.dismiss(loading);
    }
  };

  const handleUpdateRowStatus = (row: TradieScheduleListItem) => {
    dispatch(openModal({ type: "confirmStatus", payload: { schedule: row } }));
  };

  const handleRowReminder = async (row: TradieScheduleListItem) => {
    dispatch(openModal({ type: "tradieReminder", payload: { schedule: row } }));
  };

  const handleRowCallLogged = async (row: TradieScheduleListItem) => {
    dispatch(openModal({ type: "logCall", payload: { schedule: row } }));
  };

  switch (modal.type) {
    case "addUpdate":
      const milestoneId = modal.payload?.milestoneId as string | undefined;
      return (
        <AddUpdateModal
          projectId={projectId}
          milestoneId={milestoneId}
          milestones={projectMilestones}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
          onSuccess={handleSuccess}
        />
      );
    case "createVariation":
      return (
        <CreateVariationModal
          projectId={projectId}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
          onSuccess={handleSuccess}
        />
      );
    case "createProject":
      return (
        <CreateProjectModal
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
          onSuccess={handleSuccess}
        />
      );
    case "scheduleTradie":
      const project = projectPayload
        ? {
            id: projectPayload.id,
            name: projectPayload.name,
          }
        : undefined;
      const milestones = projectPayload
        ? projectPayload.milestones.map((m) => ({
            id: m.id,
            name: m.name,
          }))
        : undefined;

      return (
        <ScheduleTradieModal
          open
          project={project}
          milestones={milestones}
          onOpenChange={(open) => !open && handleClose()}
          onSuccess={handleSuccess}
        />
      );
    case "logCall": {
      const schedule = modal.payload?.schedule as
        | TradieScheduleListItem
        | undefined;

      if (!schedule) {
        return null;
      }

      return (
        <LogCallModal
          schedule={schedule}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
          onSuccess={handleSuccess}
        />
      );
    }
    case "confirmStatus": {
      const schedule = modal.payload?.schedule as
        | TradieScheduleListItem
        | undefined;

      if (!schedule) {
        return null;
      }

      return (
        <ConfirmStatusModal
          schedule={schedule}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
          onSuccess={handleClose}
        />
      );
    }
    case "tradieDirectory":
      return (
        <TradieDirectoryModal
          open
          onOpenChange={(open) => !open && handleClose()}
        />
      );
    case "tradieReminder":
      const { schedule } = modal.payload as {
        schedule: TradieScheduleListItem;
      };
      const tradie = schedule.contact;
      const siteManager = schedule.siteManager;

      return (
        <ReminderModal
          schedule={schedule as TradieScheduleListItem}
          tradie={tradie as { email: string; phone: string }}
          siteManager={
            siteManager as { email: string; phone: string; name: string }
          }
          open
          onOpenChange={(open) => !open && handleClose()}
          onSend={handleClose}
        />
      );
    case "tradieScheduleDetails":
      const scheduleDetails = modal.payload
        ?.schedule as TradieUrgentReminderItem;

      return (
        <TradieScheduleDetailsModal
          schedule={scheduleDetails}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
          onMarkAsDone={handleRowQuickConfirm}
          onSendReminder={handleRowReminder}
          onCall={handleRowCallLogged}
          onUpdateStatus={handleUpdateRowStatus}
        />
      );
    case "projectDetail":
      const { project: statProject } = modal.payload as {
        project: ProjectWithStats;
      };
      return (
        <ProjectDetailModal
          project={statProject}
          isOpen
          onClose={handleClose}
        />
      );
    case "addMaterial":
      return (
        <AddMaterialModal
          projectId={projectPayload!.id}
          isOpen
          onClose={handleClose}
        />
      );
    case "viewPicture":
      const { imageUrl } = modal.payload as { imageUrl: string };
      return (
        <PreviewPictureModal open onClose={handleClose} imageUrl={imageUrl} />
      );
    case "addMilestone":
      const { projectId: addMilestoneProjectId } = modal.payload as {
        projectId: string;
      };
      return (
        <AddMilestoneModal
          projectId={addMilestoneProjectId}
          isOpen
          onClose={handleClose}
        />
      );
    case "updateMilestoneStatus":
      const {
        milestoneId: updateMilestoneStatusId,
        newStatus,
        projectId: updateMilestoneStatusProjectId,
      } = modal.payload as {
        projectId: string;
        milestoneId: string;
        newStatus: MilestoneStatus;
      };
      return (
        <UpdateMilestoneModal
          milestoneId={updateMilestoneStatusId}
          projectId={updateMilestoneStatusProjectId}
          status={newStatus}
          isOpen
          onClose={handleClose}
        />
      );
    case "addMilestonePicture":
      const {
        milestoneId: addMilestonePictureId,
        projectId: addMilestonePictureProjectId,
      } = modal.payload as {
        milestoneId: string;
        projectId: string;
      };
      return (
        <AddMilestonePictureModal
          milestoneId={addMilestonePictureId}
          projectId={addMilestonePictureProjectId}
          isOpen
          onClose={handleClose}
        />
      );
    case "createOfferFile":
      return <CreateOfferFileModal open onClose={handleClose} />;
    default:
      return null;
  }
}
