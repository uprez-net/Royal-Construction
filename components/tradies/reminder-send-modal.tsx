"use client";

import { useState } from "react";
import { Mail, MessageSquare, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { TradieScheduleListItem } from "@/types/project";
import { dateFormat } from "@/utils/formatters";

interface ReminderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: () => void;
  schedule: TradieScheduleListItem;
  tradie: {
    email: string;
    phone: string;
  };
  siteManager: {
    email: string;
    phone: string;
    name: string;
  };
}

export function ReminderModal({
  open,
  onOpenChange,
  onSend,
  schedule,
  tradie,
  siteManager,
}: ReminderModalProps) {
  const [tab, setTab] = useState<"email" | "sms">("email");

  const emailBody = `
    Hi ${tradie.email},

    This is a reminder that you have ${schedule.tradeType} work scheduled at ${schedule.projectName} on ${dateFormat.format(new Date(schedule.scheduledDate))}.
    
    Site Manager: ${siteManager.name}
    Email: ${siteManager.email}
    Phone: ${siteManager.phone}

    Please let us know if you have any questions or need to reschedule.
    Let us know if you need any materials or support to complete the job.
    
    Best regards,
    Guri Singh
    BuildPro Construction
    NSW, Australia
    `;

  const smsBody = `Reminder: You have ${schedule.tradeType} work at ${schedule.projectName} on ${dateFormat.format(new Date(schedule.scheduledDate))}. Reply to confirm or reschedule.`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-w-[680px] gap-0 overflow-hidden rounded-[14px] border border-[#E2E8F0] bg-white p-0 shadow-2xl",
          "sm:rounded-[14px]",
        )}
      >
        {/* Header */}
        <DialogHeader className="flex-row items-center justify-between border-b border-[#E2E8F0] px-6 py-5">
          <div>
            <DialogTitle className="text-[18px] font-[700] tracking-[-0.02em] text-[#0F172A]">
              Send Reminder
            </DialogTitle>
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="px-6 py-5">
          {/* Tabs */}
          <div className="mb-4 flex gap-1.5">
            <button
              onClick={() => setTab("email")}
              className={cn(
                "inline-flex items-center rounded-[7px] border px-3 py-[7px] text-[12.5px] font-[600] transition-all",
                tab === "email"
                  ? "border-[#0D9488] bg-[#0D9488] text-white shadow-[0_4px_12px_rgba(13,148,136,0.3)]"
                  : "border-[#E2E8F0] bg-white text-[#0F172A] hover:border-[#0D9488] hover:bg-[#F8FAFC] hover:text-[#0D9488]",
              )}
            >
              <Mail className="mr-1.5 h-3.5 w-3.5" />
              Email
            </button>

            <button
              onClick={() => setTab("sms")}
              className={cn(
                "inline-flex items-center rounded-[7px] border px-3 py-[7px] text-[12.5px] font-[600] transition-all",
                tab === "sms"
                  ? "border-[#0D9488] bg-[#0D9488] text-white shadow-[0_4px_12px_rgba(13,148,136,0.3)]"
                  : "border-[#E2E8F0] bg-white text-[#0F172A] hover:border-[#0D9488] hover:bg-[#F8FAFC] hover:text-[#0D9488]",
              )}
            >
              <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
              SMS
            </button>
          </div>

          {/* EMAIL */}
          {tab === "email" && (
            <div>
              <div className="mb-3">
                <Label className="mb-[5px] block text-[11.5px] font-[600] text-[#475569]">
                  To
                </Label>

                <div className="text-[13px] font-[600] text-[#0F172A]">
                  {tradie?.email || "N/A"}
                </div>
              </div>

              <div className="mb-3">
                <Label className="mb-[5px] block text-[11.5px] font-[600] text-[#475569]">
                  Subject
                </Label>

                <div className="text-[13px] font-[600] text-[#0F172A]">
                  Reminder: {schedule.tradeType} work at {schedule.projectName}{" "}
                  — {dateFormat.format(new Date(schedule.scheduledDate))}
                </div>
              </div>

              <div className="mb-3">
                <Label className="mb-[5px] block text-[11.5px] font-[600] text-[#475569]">
                  CC
                </Label>

                <div className="text-[13px] text-[#475569]">
                  {siteManager.name} (Site Manager)
                </div>
              </div>

              <div>
                <Label className="mb-[5px] block text-[11.5px] font-[600] text-[#475569]">
                  Body
                </Label>

                <pre
                  className={cn(
                    "whitespace-pre-wrap rounded-[8px] border border-[#E2E8F0] bg-[#F1F5F9] p-[14px]",
                    "font-sans text-[12.5px] leading-[1.6] text-[#0F172A]",
                  )}
                >
                  {emailBody}
                </pre>
              </div>
            </div>
          )}

          {/* SMS */}
          {tab === "sms" && (
            <div>
              <div className="mb-3">
                <Label className="mb-[5px] block text-[11.5px] font-[600] text-[#475569]">
                  To
                </Label>

                <div className="text-[13px] font-[600] text-[#0F172A]">
                  {tradie.phone || "N/A"}
                </div>
              </div>

              <div>
                <Label className="mb-[5px] block text-[11.5px] font-[600] text-[#475569]">
                  Message
                </Label>

                <div className="rounded-[8px] border border-[#E2E8F0] bg-[#F1F5F9] p-[14px] text-[13px] text-[#0F172A]">
                  {smsBody}
                </div>

                <div className="mt-1 text-[11px] text-[#94A3B8]">
                  {smsBody.length}/160 characters
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="flex-row justify-end gap-2 border-t border-[#E2E8F0] px-6 py-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-auto rounded-[7px] border-[#E2E8F0] px-[14px] py-[7px] text-[12.5px] font-[500] text-[#0F172A] hover:border-[#0D9488] hover:bg-[#F8FAFC] hover:text-[#0D9488]"
          >
            Cancel
          </Button>

          <Button
            onClick={onSend}
            className="h-auto rounded-[7px] bg-[#0D9488] px-[14px] py-[7px] text-[12.5px] font-[600] text-white shadow-none transition-all hover:bg-[#0F766E] hover:shadow-[0_4px_12px_rgba(13,148,136,0.3)]"
          >
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Send Reminder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
