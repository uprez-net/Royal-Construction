"use client";

import { useRouter } from "next/navigation";

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
  TradieScheduleListItem,
  TradieUrgentReminderItem,
} from "@/types/project";
import { CreateProjectModal } from "../projects/create-project-modal";
import { ReminderModal } from "../tradies/reminder-send-modal";
import { TradieScheduleDetailsModal } from "../tradies/details-view-modal";
import {
  clearSelectedSchedules,
  fetchTradieCoordinationDashboard,
} from "@/lib/store/slices/tradiesSlice";
import { toast } from "sonner";
import { TradieScheduleStatus } from "@prisma/client";

export function ModalManager() {
  const modal = useAppSelector((state) => state.ui.modal);
  const dispatch = useAppDispatch();
  const router = useRouter();

  const handleClose = () => dispatch(closeModal());
  const handleProjectSuccess = () => {
    handleClose();
  };
  const handleSuccess = () => {
    handleClose();
    router.refresh();
  };

  const projectPayload = modal.payload?.project as ProjectDetail | undefined;
  const projectId = projectPayload?.id ?? String(modal.payload?.projectId ?? "");
  const projectMilestones =
    projectPayload?.milestones.map((milestone) => ({
      id: milestone.id,
      name: milestone.name,
    })) ??
    ((modal.payload?.milestones as { id: string; name: string }[]) ?? []);

  if (!modal.type) {
    return null;
  }

  const updateScheduleStatuses = async (
    ids: string[],
    status: TradieScheduleStatus,
  ) => {
    if (ids.length === 0) {
      return;
    }

    await Promise.all(
      ids.map(async (id) => {
        await fetch(`/api/tradie-schedules/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
      }),
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
      return (
        <AddUpdateModal
          projectId={projectId}
          milestones={projectMilestones}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
          onSuccess={handleProjectSuccess}
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
          onSuccess={handleProjectSuccess}
        />
      );
    case "createProject":
      return (
        <CreateProjectModal
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
          onSuccess={handleProjectSuccess}
        />
      );
    case "scheduleTradie":
      return (
        <ScheduleTradieModal
          open
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
          onSuccess={handleSuccess}
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
          onSend={handleSuccess}
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
    default:
      return null;
  }
}
