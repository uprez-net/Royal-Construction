"use client";

import {
  CalendarDays,
  Check,
  CheckCheck,
  Clock3,
  Mail,
  Pencil,
  Phone,
  PhoneOff,
  Star,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { Button } from "../ui/button";

import type {
  TradieScheduleListItem,
  TradieUrgentReminderItem,
} from "@/types/project";

interface ViewDetailsModalProps {
  schedule: TradieUrgentReminderItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMarkAsDone: (item: TradieScheduleListItem) => void;
  onSendReminder: (item: TradieScheduleListItem) => void;
  onCall: (item: TradieScheduleListItem) => void;
  onUpdateStatus?: (item: TradieScheduleListItem) => void;
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getStatusStyles(status: string) {
  switch (status) {
    case "CONFIRMED":
      return "bg-[rgba(22,163,74,0.08)] text-[#16A34A]";

    case "PENDING":
    case "PENDING_RESPONSE":
      return "bg-[rgba(245,158,11,0.08)] text-[#D97706]";

    case "NO_RESPONSE":
      return "bg-[rgba(220,38,38,0.08)] text-[#DC2626]";

    case "AWAITING_MATERIALS":
      return "bg-[rgba(37,99,235,0.08)] text-[#2563EB]";

    case "DECLINED":
      return "bg-[rgba(220,38,38,0.08)] text-[#DC2626]";

    case "COMPLETED":
      return "bg-[rgba(148,163,184,0.1)] text-[#475569]";

    default:
      return "bg-[rgba(148,163,184,0.1)] text-[#475569]";
  }
}

function getDaysBadge(daysLeft: number) {
  if (daysLeft <= 1) {
    return {
      className:
        "bg-[#FEE2E2] text-[#DC2626]",
      label: `${daysLeft}d`,
    };
  }

  if (daysLeft <= 3) {
    return {
      className:
        "bg-[#FEF9C3] text-[#D97706]",
      label: `${daysLeft}d`,
    };
  }

  if (daysLeft <= 7) {
    return {
      className:
        "bg-[rgba(13,148,136,0.15)] text-[#0D9488]",
      label: `${daysLeft}d`,
    };
  }

  return {
    className:
      "bg-[rgba(148,163,184,0.1)] text-[#64748B]",
    label: `${daysLeft}d`,
  };
}

export function TradieScheduleDetailsModal({
  schedule,
  open,
  onOpenChange,
  onMarkAsDone,
  onSendReminder,
  onCall,
  onUpdateStatus,
}: ViewDetailsModalProps) {
  const item = {
    id: schedule.id,
    tradieId: "tradieId",
    tradieName: schedule.tradieName,
    tradeType: schedule.tradeType,
    projectId: "projectId",
    projectName: schedule.projectName,
    milestoneId: "milestoneId",
    milestoneName: schedule.milestoneName,
    taskLabel: schedule.taskLabel,
    scheduledDate: schedule.scheduledDate,
    contact: schedule.contact,
    siteManager: schedule.siteManager,
    status: schedule.status,
    reminderSentAt: schedule.reminderSentAt,
    updatedAt: new Date().toISOString(),
    durationDays: 1,
    company: schedule.company,
  } satisfies TradieScheduleListItem;

  const daysBadge = getDaysBadge(schedule.daysLeft);

  return (
    <div className="max-h-[85vh] overflow-y-auto no-scrollbar">
      {/* Header */}
      <div className="border-b border-[#E2E8F0] px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-[20px] font-[800] tracking-[-0.02em] text-[#0F172A]">
              {schedule.tradieName}
            </h2>

            <p className="mt-1 text-[12.5px] text-[#64748B]">
              {schedule.tradeType} —{" "}
              {schedule.company ?? "Independent Tradie"}
            </p>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            className="h-8 w-8 shrink-0 rounded-[8px] border border-[#E2E8F0] text-[#94A3B8] hover:border-transparent hover:bg-[#FEE2E2] hover:text-[#DC2626]"
          >
            ✕
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="px-6 py-5">
        {/* Detail Grid */}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-0.5 text-[10px] font-[600] uppercase tracking-[0.06em] text-[#94A3B8]">
              Phone
            </div>

            <div className="text-[13px] font-[600] text-[#0F172A]">
              {schedule.contact.phone || "N/A"}
            </div>
          </div>

          <div>
            <div className="mb-0.5 text-[10px] font-[600] uppercase tracking-[0.06em] text-[#94A3B8]">
              Email
            </div>

            <div className="truncate text-[12px] font-[600] text-[#0F172A]">
              {schedule.contact.email || "N/A"}
            </div>
          </div>

          <div>
            <div className="mb-0.5 text-[10px] font-[600] uppercase tracking-[0.06em] text-[#94A3B8]">
              Project
            </div>

            <div className="text-[13px] font-[600] text-[#0D9488]">
              {schedule.projectName}
            </div>
          </div>

          <div>
            <div className="mb-0.5 text-[10px] font-[600] uppercase tracking-[0.06em] text-[#94A3B8]">
              Site Manager
            </div>

            <div className="text-[13px] font-[600] text-[#0F172A]">
              {schedule.siteManager.name}
            </div>
          </div>

          <div>
            <div className="mb-0.5 text-[10px] font-[600] uppercase tracking-[0.06em] text-[#94A3B8]">
              Scheduled
            </div>

            <div className="flex items-center gap-1 text-[13px] font-[600] text-[#0F172A]">
              <CalendarDays className="h-3.5 w-3.5 text-[#94A3B8]" />

              {formatDate(schedule.scheduledDate)}
            </div>
          </div>

          <div>
            <div className="mb-0.5 text-[10px] font-[600] uppercase tracking-[0.06em] text-[#94A3B8]">
              Days Until
            </div>

            <div
              className={cn(
                "inline-flex items-center gap-1 rounded-[6px] px-[9px] py-[3px]",
                "text-[10.5px] font-[700]",
                daysBadge.className
              )}
            >
              <Clock3 className="h-3 w-3" />
              {daysBadge.label}
            </div>
          </div>
        </div>

        {/* Milestone */}
        <div className="mb-4">
          <div className="mb-0.5 text-[10px] font-[600] uppercase tracking-[0.06em] text-[#94A3B8]">
            Milestone
          </div>

          <div className="mt-0.5 text-[13px] font-[600] text-[#0F172A]">
            {schedule.milestoneName ?? "Unscheduled milestone"}
          </div>
        </div>

        {/* Task */}
        <div className="mb-4">
          <div className="mb-0.5 text-[10px] font-[600] uppercase tracking-[0.06em] text-[#94A3B8]">
            Task
          </div>

          <div className="mt-0.5 text-[13px] text-[#0F172A]">
            {schedule.taskLabel}
          </div>
        </div>

        {/* Status */}
        <div className="mb-4">
          <div className="mb-0.5 text-[10px] font-[600] uppercase tracking-[0.06em] text-[#94A3B8]">
            Status
          </div>

          <div className="mt-1">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-[10px] py-[3px]",
                "text-[10.5px] font-[600]",
                getStatusStyles(schedule.status)
              )}
            >
              {schedule.status.replaceAll("_", " ")}
            </span>
          </div>
        </div>

        {/* Reminder */}
        <div className="mb-4">
          <div className="mb-0.5 text-[10px] font-[600] uppercase tracking-[0.06em] text-[#94A3B8]">
            Reminder
          </div>

          <div className="mt-0.5 text-[13px] text-[#0F172A]">
            {schedule.reminderSentAt ? (
              <>
                Sent on {formatDate(schedule.reminderSentAt)}
              </>
            ) : (
              <span className="text-[#94A3B8]">
                Not sent yet
              </span>
            )}
          </div>
        </div>

        {/* Contact Card */}
        <div className="mb-5 rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC] p-4">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[rgba(13,148,136,0.15)] text-[#0D9488]">
              <Star className="h-4 w-4" />
            </div>

            <div>
              <div className="text-[13px] font-[700] text-[#0F172A]">
                Contact Information
              </div>

              <div className="text-[11px] text-[#94A3B8]">
                Reach out to the assigned tradie
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-[8px] bg-white px-3 py-2 text-[12px]">
              <span className="text-[#64748B]">Phone</span>

              <span className="font-[600] text-[#0F172A]">
                {schedule.contact.phone}
              </span>
            </div>

            <div className="flex items-center justify-between rounded-[8px] bg-white px-3 py-2 text-[12px]">
              <span className="text-[#64748B]">Email</span>

              <span className="truncate pl-4 font-[600] text-[#0F172A]">
                {schedule.contact.email}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {schedule.status !== "CONFIRMED" &&
            schedule.status !== "COMPLETED" &&
            schedule.status !== "DECLINED" && (
              <Button
                onClick={() => onMarkAsDone(item)}
                className={cn(
                  "h-auto rounded-[7px] bg-[#0D9488] px-[14px] py-[7px]",
                  "text-[12.5px] font-[600] text-white",
                  "hover:-translate-y-[1px] hover:bg-[#0F766E]",
                  "hover:shadow-[0_4px_12px_rgba(13,148,136,0.3)]"
                )}
              >
                <Check className="mr-1.5 h-3.5 w-3.5" />
                Mark Confirmed
              </Button>
            )}

          {(schedule.status === "NO_RESPONSE" ||
            schedule.status === "PENDING" ||
            schedule.status === "PENDING_RESPONSE") && (
            <Button
              onClick={() => onCall(item)}
              className={cn(
                "h-auto rounded-[7px] bg-[#F59E0B] px-[14px] py-[7px]",
                "text-[12.5px] font-[600] text-white",
                "hover:-translate-y-[1px] hover:bg-[#D97706]"
              )}
            >
              <Phone className="mr-1.5 h-3.5 w-3.5" />
              Call Tradie
            </Button>
          )}

          <Button
            variant="outline"
            onClick={() => onSendReminder(item)}
            className={cn(
              "h-auto rounded-[7px] border-[#E2E8F0] bg-white px-[14px] py-[7px]",
              "text-[12.5px] font-[500] text-[#0F172A]",
              "hover:border-[#0D9488] hover:bg-[#F8FAFC] hover:text-[#0D9488]"
            )}
          >
            <Mail className="mr-1.5 h-3.5 w-3.5" />
            Send Reminder
          </Button>

          {onUpdateStatus && (
            <Button
              variant="outline"
              onClick={() => onUpdateStatus(item)}
              className={cn(
                "h-auto rounded-[7px] border-[#E2E8F0] bg-white px-[14px] py-[7px]",
                "text-[12.5px] font-[500] text-[#0F172A]",
                "hover:border-[#0D9488] hover:bg-[#F8FAFC] hover:text-[#0D9488]"
              )}
            >
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Update Status
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}