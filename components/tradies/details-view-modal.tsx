"use client";

import {
  CalendarDays,
  Check,
  Clock3,
  Mail,
  Pencil,
  Phone,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";

import { Badge } from "../ui/badge";
import { Separator } from "../ui/separator";
import { Card, CardContent } from "../ui/card";

import type {
  TradieScheduleListItem,
  TradieUrgentReminderItem,
} from "@/types/project";
import { currency, dataTimeFormat, dateFormat } from "@/utils/formatters";
import { daysUntil } from "@/utils/parser";
import { RatingStars } from "../common/rating-star";

interface ViewDetailsModalProps {
  schedule: TradieUrgentReminderItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMarkAsDone: (item: TradieScheduleListItem) => void;
  onSendReminder: (item: TradieScheduleListItem) => void;
  onCall: (item: TradieScheduleListItem) => void;
  onUpdateStatus?: (item: TradieScheduleListItem) => void;
}

function getStatusStyles(status: string) {
  switch (status) {
    case "CONFIRMED":
      return "border-transparent bg-[rgba(22,163,74,0.08)] text-[#16A34A]";

    case "PENDING":
    case "PENDING_RESPONSE":
      return "border-transparent bg-[rgba(245,158,11,0.08)] text-[#D97706]";

    case "NO_RESPONSE":
      return "border-transparent bg-[rgba(220,38,38,0.08)] text-[#DC2626]";

    case "AWAITING_MATERIALS":
      return "border-transparent bg-[rgba(37,99,235,0.08)] text-[#2563EB]";

    case "DECLINED":
      return "border-transparent bg-[rgba(220,38,38,0.08)] text-[#DC2626]";

    case "COMPLETED":
      return "border-transparent bg-[rgba(148,163,184,0.1)] text-[#475569]";

    default:
      return "border-transparent bg-[rgba(148,163,184,0.1)] text-[#475569]";
  }
}

function getDaysBadge(daysLeft: number) {
  if (daysLeft <= 1) {
    return {
      className: "border-transparent bg-[#FEE2E2] text-[#DC2626]",
      label: `${daysLeft}d`,
    };
  }

  if (daysLeft <= 3) {
    return {
      className: "border-transparent bg-[#FEF9C3] text-[#D97706]",
      label: `${daysLeft}d`,
    };
  }

  if (daysLeft <= 7) {
    return {
      className: "border-transparent bg-[rgba(13,148,136,0.15)] text-[#0D9488]",
      label: `${daysLeft}d`,
    };
  }

  return {
    className: "border-transparent bg-[rgba(148,163,184,0.1)] text-[#64748B]",
    label: `${daysLeft}d`,
  };
}

function DetailItem({
  label,
  value,
  icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <div className="text-[10px] font-[600] uppercase tracking-[0.06em] text-[#94A3B8]">
        {label}
      </div>

      <div className="flex items-center gap-1.5 text-[13px] font-[600] text-[#0F172A]">
        {icon}
        {value}
      </div>
    </div>
  );
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

  const daysLeft = daysUntil(new Date(schedule.scheduledDate));
  const daysBadge = getDaysBadge(daysLeft);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "border-[#E2E8F0] p-0",
          "max-h-[85vh] overflow-y-auto max-w-[calc(100%-2rem)] gap-0 sm:max-h-[60vh] sm:max-w-[720px]",
          "rounded-[18px] bg-white shadow-[0_20px_60px_rgba(15,23,42,0.18)]",
        )}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Tradie Schedule Details</DialogTitle>
        </DialogHeader>

        <div className="max-h-[90vh] overflow-y-auto no-scrollbar">
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
            </div>
          </div>

          {/* Body */}
          <div className="px-6 py-5">
            {/* Detail Grid */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <DetailItem
                label="Phone"
                value={schedule.contact.phone || "N/A"}
              />

              <DetailItem
                label="Email"
                value={
                  <span className="truncate">
                    {schedule.contact.email || "N/A"}
                  </span>
                }
              />

              {schedule.hourtlyRate && (
                <DetailItem
                  label="Hourly Rate"
                  value={
                    <span className="truncate">
                      {currency.format(Number(schedule.hourtlyRate))}/hr
                    </span>
                  }
                />
              )}

              {schedule.rating && (
                <DetailItem
                  label="Rating"
                  value={<RatingStars rating={Number(schedule.rating)} />}
                />
              )}

              <DetailItem
                label="Project"
                value={
                  <span className="text-[#0D9488]">{schedule.projectName}</span>
                }
              />

              <DetailItem
                label="Site Manager"
                value={schedule.siteManager.name}
              />

              <DetailItem
                label="Scheduled"
                icon={<CalendarDays className="h-3.5 w-3.5 text-[#94A3B8]" />}
                value={dateFormat.format(new Date(schedule.scheduledDate))}
              />

              <div className="space-y-1">
                <div className="text-[10px] font-[600] uppercase tracking-[0.06em] text-[#94A3B8]">
                  Days Until
                </div>

                <Badge
                  className={cn(
                    "inline-flex rounded-[6px] px-[9px] py-[3px]",
                    "text-[10.5px] font-[700]",
                    daysBadge.className,
                  )}
                >
                  <Clock3 className="mr-1 h-3 w-3" />
                  {daysBadge.label}
                </Badge>
              </div>
            </div>

            <Separator className="my-5 bg-[#E2E8F0]" />

            {/* Milestone */}
            <div className="space-y-4">
              <DetailItem
                label="Milestone"
                value={schedule.milestoneName ?? "Unscheduled milestone"}
              />

              <div className="space-y-1">
                <div className="text-[10px] font-[600] uppercase tracking-[0.06em] text-[#94A3B8]">
                  Task
                </div>

                <p className="text-[13px] text-[#0F172A]">
                  {schedule.taskLabel}
                </p>
              </div>

              <div className="space-y-1">
                <div className="text-[10px] font-[600] uppercase tracking-[0.06em] text-[#94A3B8]">
                  Status
                </div>

                <Badge
                  className={cn(
                    "rounded-full px-[10px] py-[3px]",
                    "text-[10.5px] font-[600]",
                    getStatusStyles(schedule.status),
                  )}
                >
                  {schedule.status.replaceAll("_", " ")}
                </Badge>
              </div>

              <div className="space-y-1">
                <div className="text-[10px] font-[600] uppercase tracking-[0.06em] text-[#94A3B8]">
                  Reminder
                </div>

                <div className="text-[13px] text-[#0F172A]">
                  {schedule.reminderSentAt ? (
                    <>
                      Sent on{" "}
                      {dataTimeFormat.format(new Date(schedule.reminderSentAt))}
                    </>
                  ) : (
                    <span className="text-[#94A3B8]">Not sent yet</span>
                  )}
                </div>
              </div>
            </div>

            {/* Contact Card */}
            <Card className="mt-5 rounded-[12px] border-[#E2E8F0] bg-[#F8FAFC] shadow-none">
              <CardContent className="p-4">
                <div className="mb-3 flex items-center gap-2">
                  <div
                    className={cn(
                      "flex h-9 w-9 items-center justify-center",
                      "rounded-[10px]",
                      "bg-[rgba(13,148,136,0.15)] text-[#0D9488]",
                    )}
                  >
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
                  <div
                    className={cn(
                      "flex items-center justify-between",
                      "rounded-[8px] border border-[#EEF2F7]",
                      "bg-white px-3 py-2 text-[12px]",
                    )}
                  >
                    <span className="text-[#64748B]">Phone</span>

                    <span className="font-[600] text-[#0F172A]">
                      {schedule.contact.phone}
                    </span>
                  </div>

                  <div
                    className={cn(
                      "flex items-center justify-between gap-4",
                      "rounded-[8px] border border-[#EEF2F7]",
                      "bg-white px-3 py-2 text-[12px]",
                    )}
                  >
                    <span className="text-[#64748B]">Email</span>

                    <span className="truncate font-[600] text-[#0F172A]">
                      {schedule.contact.email}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Actions */}
            <div className="mt-5 flex flex-wrap gap-2">
              {schedule.status !== "CONFIRMED" &&
                schedule.status !== "COMPLETED" &&
                schedule.status !== "DECLINED" && (
                  <Button
                    onClick={() => onMarkAsDone(item)}
                    className={cn(
                      "h-auto rounded-[7px]",
                      "bg-[#0D9488] px-[14px] py-[7px]",
                      "text-[12.5px] font-[600] text-white",
                      "transition-all duration-200",
                      "hover:-translate-y-[1px]",
                      "hover:bg-[#0F766E]",
                      "hover:shadow-[0_4px_12px_rgba(13,148,136,0.3)]",
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
                    "h-auto rounded-[7px]",
                    "bg-[#F59E0B] px-[14px] py-[7px]",
                    "text-[12.5px] font-[600] text-white",
                    "transition-all duration-200",
                    "hover:-translate-y-[1px]",
                    "hover:bg-[#D97706]",
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
                  "h-auto rounded-[7px]",
                  "border-[#E2E8F0] bg-white",
                  "px-[14px] py-[7px]",
                  "text-[12.5px] font-[500] text-[#0F172A]",
                  "hover:border-[#0D9488]",
                  "hover:bg-[#F8FAFC]",
                  "hover:text-[#0D9488]",
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
                    "h-auto rounded-[7px]",
                    "border-[#E2E8F0] bg-white",
                    "px-[14px] py-[7px]",
                    "text-[12.5px] font-[500] text-[#0F172A]",
                    "hover:border-[#0D9488]",
                    "hover:bg-[#F8FAFC]",
                    "hover:text-[#0D9488]",
                  )}
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  Update Status
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
