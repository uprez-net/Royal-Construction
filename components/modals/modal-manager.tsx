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
import { DeleteScheduleModal } from "../tradies/delete-schedule-modal";
import {
  clearSelectedSchedules,
  fetchTradieCoordinationDashboard,
  updateTradieScheduleStatus,
} from "@/lib/store/slices/tradiesSlice";
import { toast } from "sonner";
import {
  ComplianceApprovalDecision,
  MilestoneStatus,
  ProjectStage,
  TradieApprovalActionType,
  TradieScheduleStatus,
  type ComplianceDocumentType,
  type ComplianceExternalApplicationKind,
  type CompliancePartyType,
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
import { StartCertifierEngagementModal } from "./start-certifier-engagement-modal";
import type {
  ComplianceExternalApplicationRecord,
  VaultAttachmentOption,
} from "@/types/compliance";
import type { DeveloperApprovalDocument } from "@/constants/complianceDocuments";
import { ApplicationModal } from "./compliance/application-modal";
import { ConnectPartyModal } from "./compliance/connect-party-modal";
import { PartyRevisionModal } from "./compliance/party-revision-modal";
import { DeveloperDecisionModal } from "./compliance/developer-decision-modal";
import { DeveloperResendModal } from "./compliance/developer-resend-modal";
import { ResubmitApplicationModal } from "./compliance/resubmit-application-modal";
import { WasteManagementModal } from "./compliance/waste-management-modal";
import { ResolveAlertModal } from "./compliance/resolve-alert-modal";
import { ResolveMeetingModal } from "./compliance/resolve-meeting-modal";
import { ReviewPlansModal } from "./compliance/review-plans-modal";
import { ScheduleMeetingModal } from "./compliance/schedule-meeting-modal";
import { CertifierDiscoveryModal } from "./certifier-discovery-modal";
import { CertifierExtractModal } from "./certifier-extract-modal";
import { CertifierPackReadyModal } from "./certifier-pack-ready-modal";
import { CertifierSendSignedCopiesModal } from "./certifier-send-signed-copies-modal";
import { ComplianceCompleteModal } from "./compliance-complete-modal";
import { ComplianceRejectModal } from "./compliance-reject-modal";

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
        row.status === TradieScheduleStatus.PENDING_FINAL_CONFIRMATION
          ? TradieScheduleStatus.CONFIRMED
          : TradieScheduleStatus.AWAITING_ADMIN_APPROVAL,
      );
    } catch (error) {
      toast.error("Failed to update status. Please try again.");
      console.error("Error updating tradie schedule status:", error);
    } finally {
      toast.dismiss(loading);
    }
  };

  // Removing a booking is an approval request, not a delete — the reason
  // prompt collects what the admin will read.
  const handleRequestScheduleDeletion = (row: TradieScheduleListItem) => {
    dispatch(
      openModal({ type: "deleteTradieSchedule", payload: { schedule: row } }),
    );
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
            .filter(
              (m) =>
                m.status !== MilestoneStatus.DONE &&
                m.status !== MilestoneStatus.NOT_REQUIRED,
            )
            .map((m) => ({
              id: m.id,
              name: m.name,
              projectStage: m.projectStage,
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
          onRequestDelete={handleRequestScheduleDeletion}
        />
      );
    case "deleteTradieSchedule": {
      const scheduleToRemove = modal.payload?.schedule as
        | TradieScheduleListItem
        | undefined;

      if (!scheduleToRemove) {
        return null;
      }

      return (
        <DeleteScheduleModal
          open
          schedule={{
            id: scheduleToRemove.id,
            tradieName: scheduleToRemove.tradieName,
            tradeType: scheduleToRemove.tradeType,
            projectName: scheduleToRemove.projectName,
            scheduledDate: scheduleToRemove.scheduledDate,
          }}
          onClose={handleClose}
          onSuccess={() => {
            dispatch(fetchTradieCoordinationDashboard({ force: true }));
          }}
        />
      );
    }
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
    case "addMilestone": {
      const {
        projectId: addMilestoneProjectId,
        projectStage: addMilestoneProjectStage,
      } = modal.payload as {
        projectId: string;
        projectStage?: ProjectStage;
      };
      return (
        <AddMilestoneModal
          projectId={addMilestoneProjectId}
          projectStage={addMilestoneProjectStage}
          isOpen
          onClose={handleClose}
        />
      );
    }
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
        <FollowupPromptModal
          leadId={leadId}
          taskId={taskId}
          onClose={handleClose}
        />
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
      return (
        <MeetingReviewModal
          leadId={leadId}
          taskId={taskId}
          onClose={handleClose}
        />
      );
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
        <QueryClientProvider client={queryClient}>
          <DeleteTradieModal
            open
            onClose={handleClose}
            tradie={deleteTradie.tradie}
          />
        </QueryClientProvider>
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
      const { fileUrl, fileName, fileType } = modal.payload as {
        fileUrl: string;
        fileName?: string | null;
        fileType?: string | null;
      };
      return (
        <FilePreviewCanvas
          key={fileUrl} // extra safety net — forces a clean remount
          url={fileUrl}
          fileName={fileName}
          fileType={fileType}
          onClose={handleClose} // swap in your actual close action
        />
      );
    }
    case "startCertifierEngagement": {
      const { projectId: id, defaultAddress } = modal.payload as {
        projectId: string;
        defaultAddress: string;
      };
      return (
        <StartCertifierEngagementModal
          projectId={id}
          defaultAddress={defaultAddress}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
        />
      );
    }
    case "complianceApplication": {
      const {
        projectId: id,
        kind,
        application,
        portalUrl,
      } = modal.payload as {
        projectId: string;
        kind: ComplianceExternalApplicationKind;
        application: ComplianceExternalApplicationRecord | null;
        portalUrl?: string | null;
      };
      return (
        <ApplicationModal
          projectId={id}
          kind={kind}
          application={application}
          portalUrl={portalUrl}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
        />
      );
    }

    case "requestWasteManagementPlan": {
      const {
        projectId: id,
        contactName,
        contactEmail,
        attachments,
        vaultOptions,
        checklistDocumentId,
      } = modal.payload as {
        projectId: string;
        contactName: string | null;
        contactEmail: string | null;
        attachments: { name: string; url: string }[];
        vaultOptions?: VaultAttachmentOption[];
        checklistDocumentId?: string;
      };
      return (
        <WasteManagementModal
          projectId={id}
          contactName={contactName}
          contactEmail={contactEmail}
          attachments={attachments}
          vaultOptions={vaultOptions}
          checklistDocumentId={checklistDocumentId}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
        />
      );
    }

    case "connectComplianceParty": {
      const {
        projectId: id,
        party,
        subjectAddress,
        prefilled,
        checklistDocumentId,
        deliverables,
        council,
        location,
        customer,
        vaultOptions,
      } = modal.payload as {
        projectId: string;
        party: CompliancePartyType;
        subjectAddress: string;
        prefilled: { name: string; url: string }[];
        checklistDocumentId?: string;
        deliverables?: {
          documentType: ComplianceDocumentType;
          checklistDocumentId?: string;
        }[];
        council?: string | null;
        location?: string | null;
        customer: {
          name: string;
          email: string | null;
          phone: string | null;
          address: string | null;
        };
        vaultOptions?: VaultAttachmentOption[];
      };
      return (
        <ConnectPartyModal
          projectId={id}
          party={party}
          subjectAddress={subjectAddress}
          prefilled={prefilled}
          checklistDocumentId={checklistDocumentId}
          deliverables={deliverables ?? []}
          council={council}
          location={location}
          customer={customer}
          vaultOptions={vaultOptions}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
        />
      );
    }
    case "requestCompliancePartyRevision": {
      const {
        projectId: id,
        outreachId,
        party,
        contactName,
        contactEmail,
        subjectAddress,
        documentLabel,
        rejectionReason,
        attachments,
        vaultOptions,
      } = modal.payload as {
        projectId: string;
        outreachId: string;
        party: CompliancePartyType;
        contactName?: string | null;
        contactEmail?: string | null;
        subjectAddress: string;
        documentLabel: string;
        rejectionReason: string;
        attachments: {
          fileId: string;
          name: string;
          url: string;
        }[];
        vaultOptions?: VaultAttachmentOption[];
      };
      return (
        <PartyRevisionModal
          key={`${outreachId}:${documentLabel}:${rejectionReason}`}
          projectId={id}
          outreachId={outreachId}
          party={party}
          contactName={contactName}
          contactEmail={contactEmail}
          subjectAddress={subjectAddress}
          documentLabel={documentLabel}
          rejectionReason={rejectionReason}
          attachments={attachments}
          vaultOptions={vaultOptions}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
        />
      );
    }
    case "developerDecision": {
      const {
        projectId: id,
        documentType,
        decision,
        estate,
      } = modal.payload as {
        projectId: string;
        // Which document they are answering about. Optional on the wire and
        // defaulted in the data layer to the bushfire report, which is what every
        // caller meant before the architectural design came under covenant.
        documentType?: DeveloperApprovalDocument;
        decision?: ComplianceApprovalDecision;
        estate?: string | null;
      };
      // A guard rather than a cast, for the reason the certifierExtract case
      // below keeps one. `DeveloperDecisionModal` reads `isRejecting` as
      // `decision === REJECTED`, so a payload arriving without one renders the
      // approval copy and dispatches `recordDeveloperDecision` with
      // `decision: undefined`. That click opens a covenant gate the dialog
      // itself says cannot be undone from the screen, and defaulting it to the
      // approval branch is the worst of the two ways to be wrong.
      if (
        decision !== ComplianceApprovalDecision.APPROVED &&
        decision !== ComplianceApprovalDecision.REJECTED
      ) {
        return null;
      }
      return (
        <DeveloperDecisionModal
          projectId={id}
          documentType={documentType}
          decision={decision}
          estate={estate}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
        />
      );
    }
    case "resubmitApplication": {
      const {
        projectId: id,
        kind,
        nextRound,
        applicationRef,
      } = modal.payload as {
        projectId: string;
        kind: ComplianceExternalApplicationKind;
        nextRound: number;
        applicationRef?: string | null;
      };
      return (
        <ResubmitApplicationModal
          projectId={id}
          kind={kind}
          nextRound={nextRound}
          applicationRef={applicationRef}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
        />
      );
    }
    case "developerResend": {
      const {
        projectId: id,
        documentType,
        previousReason,
        vaultOptions,
      } = modal.payload as {
        projectId: string;
        documentType?: DeveloperApprovalDocument;
        previousReason?: string | null;
        vaultOptions?: VaultAttachmentOption[];
      };
      return (
        <DeveloperResendModal
          projectId={id}
          documentType={documentType}
          previousReason={previousReason}
          vaultOptions={vaultOptions}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
        />
      );
    }
    case "scheduleComplianceMeeting": {
      const { projectId: id, vaultOptions } = modal.payload as {
        projectId: string;
        vaultOptions?: VaultAttachmentOption[];
      };
      return (
        <ScheduleMeetingModal
          projectId={id}
          vaultOptions={vaultOptions}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
        />
      );
    }
    case "resolveComplianceMeeting": {
      const {
        projectId: id,
        scheduledFor,
        vaultOptions,
      } = modal.payload as {
        projectId: string;
        scheduledFor: string;
        vaultOptions?: VaultAttachmentOption[];
      };
      return (
        <ResolveMeetingModal
          projectId={id}
          vaultOptions={vaultOptions}
          scheduledFor={scheduledFor}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
        />
      );
    }
    case "reviewArchitectPlans": {
      const { projectId: id, vaultOptions } = modal.payload as {
        projectId: string;
        vaultOptions?: VaultAttachmentOption[];
      };
      return (
        <ReviewPlansModal
          projectId={id}
          vaultOptions={vaultOptions}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
        />
      );
    }
    case "resolveComplianceAlert": {
      const {
        projectId: id,
        alertId,
        alertTitle,
        guidance,
      } = modal.payload as {
        projectId: string;
        alertId: string;
        alertTitle: string;
        guidance: string;
      };
      return (
        <ResolveAlertModal
          projectId={id}
          alertId={alertId}
          alertTitle={alertTitle}
          guidance={guidance}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
        />
      );
    }
    case "certifierDiscovery": {
      const { projectId: id } = modal.payload as { projectId: string };
      return (
        <CertifierDiscoveryModal
          projectId={id}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
        />
      );
    }
    case "certifierPackReady": {
      const {
        projectId: id,
        documentCount,
        updatedCount,
        isResend,
      } = modal.payload as {
        projectId: string;
        documentCount: number;
        updatedCount: number;
        isResend?: boolean;
      };
      return (
        <CertifierPackReadyModal
          projectId={id}
          documentCount={documentCount}
          updatedCount={updatedCount}
          isResend={isResend ?? false}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
        />
      );
    }
    case "certifierExtract": {
      const {
        projectId: id,
        engagementId,
        documentId,
      } = modal.payload as {
        projectId: string;
        engagementId: string;
        documentId?: string;
      };
      // Both entry points guarantee this — the tab's button is disabled until a
      // checklist exists, and the notification url is only parsed into a
      // payload when it carries one. Kept as a guard rather than a cast so a
      // third caller cannot quietly open a modal with nothing to run.
      if (!documentId) {
        return null;
      }
      return (
        // Scoped to the modal, as the createProject case is: the provider holds
        // one run, and a second stream opened elsewhere would overwrite it.
        <WorkflowStreamProvider initialRunId={""}>
          <CertifierExtractModal
            projectId={id}
            engagementId={engagementId}
            documentId={documentId}
            open
            onOpenChange={(open) => {
              if (!open) handleClose();
            }}
          />
        </WorkflowStreamProvider>
      );
    }
    case "certifierSendSignedCopies": {
      const { projectId: id } = modal.payload as { projectId: string };
      return (
        <CertifierSendSignedCopiesModal
          projectId={id}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
        />
      );
    }
    case "complianceComplete": {
      const { projectId: id, documentCount } = modal.payload as {
        projectId: string;
        documentCount: number;
      };
      return (
        <ComplianceCompleteModal
          projectId={id}
          documentCount={documentCount}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
        />
      );
    }
    case "complianceReject": {
      const {
        projectId: id,
        documentId,
        documentLabel,
      } = modal.payload as {
        projectId: string;
        documentId: string;
        documentLabel: string;
      };
      return (
        <ComplianceRejectModal
          projectId={id}
          documentId={documentId}
          documentLabel={documentLabel}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
        />
      );
    }
    default:
      return null;
  }
}
