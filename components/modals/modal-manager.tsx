"use client";
import { useAppSelector } from "@/lib/store/hooks";
import { useAppDispatch } from "@/lib/store/hooks";
import { closeModal, openModal } from "@/lib/store/slices/uiSlice";

import { AddUpdateModal } from "@/components/projects/add-update-modal";
import { CreateVariationModal } from "@/components/projects/create-variation-modal";

import { ConfirmStatusModal } from "@/components/tradies/confirm-status-modal";
import { LogCallModal } from "@/components/tradies/log-call-modal";
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
import {
  MilestoneStatus,
  TradieApprovalActionType,
  TradieScheduleStatus,
} from "@prisma/client";
import { ProjectDetailModal } from "../projects/project-detail-modal";
import { AddMaterialModal } from "../projects/add-material-modal";
import { PreviewPictureModal } from "../common/preview-picture-modal";
import UpdateMilestoneModal from "../projects/detail/update-milestone-modal";
import AddMilestoneModal from "../projects/detail/add-milestone-modal";
import AddMilestonePictureModal from "../projects/detail/add-milestone-picture";
import { CreateOfferFileModal } from "../offers/create-offer-modal";
import { AddLeadModal } from "../leads/modal-ui/add-lead-modal";
import { FollowupPromptModal } from "../leads/modal-ui/followup-prompt-modal";
import { MeetingReviewModal } from "../leads/modal-ui/meeting-review-modal";
import { LeadStatsDrilldownModal } from "../leads/modal-ui/lead-stats-drilldown-modal";
import AddTradieModal from "../tradie-management/modal/add-tradie-modal";
import { SafeTradieApproval, TradieDetails, TradieRow } from "@/types/tradie";
import DeleteTradieModal from "../tradie-management/modal/delete-tradie-modal";
import ReportTradieModal from "../tradie-management/modal/report-tradie-modal";
import PriceChangeTradieModal from "../tradie-management/modal/price-change-tradie-modal";
import RateTradieModal from "../tradie-management/modal/rate-tradie-modal";
import { AdminApprovalActionModal } from "../tradie-management/modal/admin-approval-action-modal";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApprovalDetailModal } from "../tradie-approvals/modal/approval-detail-modal";
import ScheduleTradieModal from "../projects/detail/modal/schedule-tradie-modal";
import InsuranceClaimDatesModal from "../projects/detail/modal/insurance-claim-dates-modal";
import { TradieApprovalRejectionModal } from "../tradie-approvals/modal/rejection-input-modal";
import { WorkflowStreamProvider } from "@/context/WorkFlowStatusContext";
import EditTradieModal from "../tradie-management/modal/edit-tradie-modal";
import { LeadStage } from "../leads";
import FilePreviewCanvas from "../shared/file-preview-canvas";

export function ModalManager() {
  const modal = useAppSelector((state) => state.ui.modal);
  const dispatch = useAppDispatch();
  const [queryClient] = useState(() => new QueryClient());

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
      await updateScheduleStatuses(
        [row.id],
        TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
      );
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
        <WorkflowStreamProvider initialRunId={""}>
          <CreateProjectModal
            open
            onOpenChange={(open) => {
              if (!open) handleClose();
            }}
            onSuccess={handleSuccess}
          />
        </WorkflowStreamProvider>
      );
    case "scheduleTradie":
      const project = projectPayload
        ? {
            id: projectPayload.id,
            name: projectPayload.name,
          }
        : undefined;
      const milestones = projectPayload
        ? projectPayload.milestones
            .filter((m) => m.status !== MilestoneStatus.DONE)
            .map((m) => ({
              id: m.id,
              name: m.name,
            }))
        : undefined;

      if (!project || !milestones) {
        return null;
      }

      return (
        <ScheduleTradieModal
          open
          onClose={handleClose}
          projectId={project.id}
          milestones={milestones}
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
    case "projectDetail": {
      const { project: statProject, isAdmin } = modal.payload as {
        project: ProjectWithStats;
        isAdmin: boolean;
      };
      return (
        <ProjectDetailModal
          isAdmin={isAdmin}
          project={statProject}
          isOpen
          onClose={handleClose}
        />
      );
    }
    case "addMaterial":
      return (
        <AddMaterialModal
          projectId={projectPayload!.id}
          isOpen
          onClose={handleClose}
        />
      );
    case "viewPicture": {
      const { imageUrls, selectedIndex } = modal.payload as {
        imageUrls: string[];
        selectedIndex: number;
      };
      return (
        <PreviewPictureModal
          open
          onClose={handleClose}
          imageUrls={imageUrls}
          selectedIndex={selectedIndex}
        />
      );
    }
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
        isAdmin,
      } = modal.payload as {
        projectId: string;
        milestoneId: string;
        newStatus: MilestoneStatus;
        isAdmin: boolean;
      };
      return (
        <UpdateMilestoneModal
          milestoneId={updateMilestoneStatusId}
          projectId={updateMilestoneStatusProjectId}
          status={newStatus}
          isOpen
          onClose={handleClose}
          isAdmin={isAdmin}
        />
      );
    case "insuranceClaimDates": {
      const {
        milestoneId: insuranceMilestoneId,
        projectId: insuranceProjectId,
      } = modal.payload as {
        projectId: string;
        milestoneId: string;
      };
      return (
        <InsuranceClaimDatesModal
          milestoneId={insuranceMilestoneId}
          projectId={insuranceProjectId}
          isOpen
          onClose={handleClose}
        />
      );
    }
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
    case "createLead":
      return (
        <AddLeadModal
          onClose={handleClose}
          onSuccess={() => {
            handleClose();
          }}
          showToast={(message: string, type?: "success" | "info" | "error") => {
            if (type === "success") {
              toast.success(message);
            } else if (type === "info") {
              toast.info(message);
            } else if (type === "error") {
              toast.error(message);
            } else {
              toast.info(message);
            }
          }}
        />
      );
    case "followUpPrompt": {
      const leadId = Number(modal.payload?.leadId ?? 0);
      if (!leadId) return null;
      // taskId is optional: opened from a task row it scopes the dialog to that
      // one task, opened from a notification it still means "this lead".
      const taskId = Number(modal.payload?.taskId ?? 0) || undefined;
      return (
        <FollowupPromptModal leadId={leadId} taskId={taskId} onClose={handleClose} />
      );
    }
    case "meetingReview": {
      const leadId = Number(modal.payload?.leadId ?? 0);
      if (!leadId) return null;
      // Same contract as followUpPrompt: opened from a task row it scopes the
      // dialog to that task and closes it on save. This used to be dropped, so
      // reviewing a meeting recorded the outcome and left the task open for
      // ever — it never left the Tasks tab, not even after a reload.
      const taskId = Number(modal.payload?.taskId ?? 0) || undefined;
      return <MeetingReviewModal leadId={leadId} taskId={taskId} onClose={handleClose} />;
    }
    case "leadStatsDrilldown": {
      const title = String(modal.payload?.title ?? "Lead details");
      const stage = Array.isArray(modal.payload?.stage)
        ? (modal.payload?.stage as LeadStage[])
        : typeof modal.payload?.stage === "string"
          ? [String(modal.payload.stage) as LeadStage]
          : undefined;
      const upcomingFollowUps =
        typeof modal.payload?.upcomingFollowUps === "boolean"
          ? modal.payload.upcomingFollowUps
          : undefined;
      const pendingFollowUps =
        typeof modal.payload?.pendingFollowUps === "boolean"
          ? modal.payload.pendingFollowUps
          : undefined;
      return (
        <LeadStatsDrilldownModal
          title={title}
          stage={stage}
          upcomingFollowUps={upcomingFollowUps}
          pendingFollowUps={pendingFollowUps}
          onClose={handleClose}
        />
      );
    }
    case "addTradie":
      return <AddTradieModal open onClose={handleClose} />;
    case "rateTradie":
      const rateTradie = modal.payload as { tradie: TradieRow };
      return (
        <RateTradieModal
          open
          onClose={handleClose}
          tradie={rateTradie.tradie}
        />
      );
    case "deleteTradie":
      const deleteTradie = modal.payload as { tradie: TradieRow };
      return (
        <DeleteTradieModal
          open
          onClose={handleClose}
          tradie={deleteTradie.tradie}
        />
      );
    case "reportTradie":
      const reportTradie = modal.payload as { tradie: TradieRow };
      return (
        <ReportTradieModal
          open
          onClose={handleClose}
          tradie={reportTradie.tradie}
        />
      );
    case "priceChangeTradie":
      const priceChangeTradie = modal.payload as { tradie: TradieRow };
      return (
        <PriceChangeTradieModal
          open
          onClose={handleClose}
          tradie={priceChangeTradie.tradie}
        />
      );
    case "adminApproval":
      const { approvalId, approvalType } = modal.payload as {
        approvalId: string;
        approvalType: TradieApprovalActionType;
      };
      return (
        <QueryClientProvider client={queryClient}>
          <AdminApprovalActionModal
            open
            approvalId={approvalId}
            approvalType={approvalType}
            onClose={handleClose}
          />
        </QueryClientProvider>
      );
    case "approvalDetails":
      const { approval, onApprove, onReject } = modal.payload as {
        approval: SafeTradieApproval;
        onApprove: () => Promise<void>;
        onReject: () => void;
      };
      return (
        <ApprovalDetailModal
          open
          onClose={handleClose}
          approval={approval}
          onApprove={onApprove}
          onReject={onReject}
        />
      );
    case "rejectTradieApprovals": {
      const { approvals } = modal.payload as {
        approvals: SafeTradieApproval[];
      };
      return (
        <TradieApprovalRejectionModal
          open
          onClose={handleClose}
          approvals={approvals}
        />
      );
    }
    case "editTradie": {
      const { tradie } = modal.payload as {
        tradie: TradieDetails;
      };
      return <EditTradieModal open onClose={handleClose} tradie={tradie} />;
    }
    case "previewFile": {
      const { fileUrl } = modal.payload as { fileUrl: string };
      return (
        <FilePreviewCanvas
          key={fileUrl} // extra safety net — forces a clean remount
          url={fileUrl}
          onClose={handleClose} // swap in your actual close action
        />
      );
    }
    default:
      return null;
  }
}
