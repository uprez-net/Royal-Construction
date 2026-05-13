"use client";

import { useRouter } from "next/navigation";

import { useAppSelector } from "@/lib/store/hooks";
import { useAppDispatch } from "@/lib/store/hooks";
import { closeModal } from "@/lib/store/slices/uiSlice";

import { AddUpdateModal } from "@/components/projects/add-update-modal";
import { CreateVariationModal } from "@/components/projects/create-variation-modal";
import { ConfirmStatusModal } from "@/components/tradies/confirm-status-modal";
import { LogCallModal } from "@/components/tradies/log-call-modal";
import { ScheduleTradieModal } from "@/components/tradies/schedule-tradie-modal";
import { TradieDirectoryModal } from "@/components/tradies/tradie-directory-modal";

import type { TradieScheduleWithTradieMilestoneAndProject } from "@/types/project";

export function ModalManager() {
  const modal = useAppSelector((state) => state.ui.modal);
  const dispatch = useAppDispatch();
  const router = useRouter();

  const handleClose = () => dispatch(closeModal());
  const handleSuccess = () => {
    handleClose();
    router.refresh();
  };

  if (!modal.type) {
    return null;
  }

  switch (modal.type) {
    case "addUpdate":
      return (
        <AddUpdateModal
          projectId={String(modal.payload?.projectId ?? "")}
          milestones={(modal.payload?.milestones as { id: string; name: string }[]) ?? []}
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
          projectId={String(modal.payload?.projectId ?? "")}
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
          onSuccess={handleSuccess}
        />
      );
    case "scheduleTradie":
      return <ScheduleTradieModal open onOpenChange={(open) => !open && handleClose()} onSuccess={handleSuccess} />;
    case "logCall":
      {
        const schedule = modal.payload?.schedule as TradieScheduleWithTradieMilestoneAndProject | undefined;

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
    case "confirmStatus":
      {
        const schedule = modal.payload?.schedule as TradieScheduleWithTradieMilestoneAndProject | undefined;

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
      return <TradieDirectoryModal open onOpenChange={(open) => !open && handleClose()} />;
    default:
      return null;
  }
}