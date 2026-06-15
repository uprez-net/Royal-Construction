"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

const buildEmailAndSmsBodies = (
  schedule: TradieScheduleListItem,
  tradie: { email: string; phone: string; name?: string },
  siteManager: { email: string; phone: string; name: string },
  senderName: string,
) => {
  const formattedDate = dateFormat.format(new Date(schedule.scheduledDate));

  const tradieName = tradie.name || "there";

  const emailSubject = `Work Reminder • ${schedule.tradeType} at ${schedule.projectName} • ${formattedDate}`;

  const emailBody = `
Hi ${tradieName},

Just a reminder that your ${schedule.tradeType.toLowerCase()} work is scheduled for:

Project: ${schedule.projectName}
Date: ${formattedDate}

Site Manager Contact
----------------------------
Name: ${siteManager.name}
Email: ${siteManager.email}
Phone: ${siteManager.phone}

If you need to reschedule, require site access details, materials, or additional support, please get in touch as soon as possible.

Please reply to confirm attendance.

Kind regards,
${senderName}
Royal Constructions
NSW, Australia
`.trim();

  const smsBody = [
    `Reminder: ${schedule.tradeType} work at ${schedule.projectName}`,
    `Date: ${formattedDate}.`,
    `Site Manager: ${siteManager.name} (${siteManager.phone}).`,
    `Reply to confirm or reschedule.`,
  ].join(" ");

  return {
    emailSubject,
    emailBody,
    smsBody,
  };
};

export function ReminderModal({
  open,
  onOpenChange,
  onSend,
  schedule,
  tradie,
  siteManager,
}: ReminderModalProps) {
  const { user } = useUser();
  const senderName =
    user?.fullName?.trim() ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
    "Royal Constructions";

  const {
    emailBody: emailBodyInt,
    smsBody: smsBodyInt,
    emailSubject: emailSubjectInt,
  } = buildEmailAndSmsBodies(schedule, tradie, siteManager, senderName);
  const [tab, setTab] = useState<"email" | "sms">("email");
  const [emailBody, setEmailBody] = useState(emailBodyInt);
  const [smsBody, setSmsBody] = useState(smsBodyInt);
  const [emailSubject, setEmailSubject] = useState(emailSubjectInt);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-w-[calc(100%-2rem)] gap-0 sm:max-w-[680px] overflow-hidden rounded-[14px] border border-border/70 bg-card p-0 shadow-2xl",
          "sm:rounded-[14px]",
          "max-h-[60vh] overflow-y-auto",
        )}
      >
        {/* Header */}
        <DialogHeader className="flex-row items-center justify-between border-b border-border/70 px-6 py-5">
          <div>
            <DialogTitle className="text-[18px] font-[700] tracking-[-0.02em] text-foreground">
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
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border/70 bg-card text-foreground hover:border-primary hover:bg-muted/40 hover:text-primary",
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
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border/70 bg-card text-foreground hover:border-primary hover:bg-muted/40 hover:text-primary",
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
                <Label className="mb-[5px] block text-[11.5px] font-[600] text-muted-foreground">
                  To
                </Label>

                <div className="text-[13px] font-[600] text-foreground">
                  {tradie?.email || "N/A"}
                </div>
              </div>

              <div className="mb-3">
                <Label className="mb-[5px] block text-[11.5px] font-[600] text-muted-foreground">
                  Subject
                </Label>

                <Input
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="text-[13px] font-semibold text-foreground"
                />
              </div>

              <div className="mb-3">
                <Label className="mb-[5px] block text-[11.5px] font-[600] text-muted-foreground">
                  CC
                </Label>

                <div className="text-[13px] text-muted-foreground">
                  {siteManager.name} (Site Manager)
                </div>
              </div>

              <div>
                <Label className="mb-[5px] block text-[11.5px] font-[600] text-muted-foreground">
                  Body
                </Label>

                <Textarea
                  onChange={(e) => setEmailBody(e.target.value)}
                  className={cn(
                    "min-h-[180px] resize-none rounded-[8px] border border-border/70 bg-muted/30 p-3.5",
                    "font-sans text-[12.5px] leading-[1.6] text-foreground",
                  )}
                  value={emailBody}
                />
              </div>
            </div>
          )}

          {/* SMS */}
          {tab === "sms" && (
            <div>
              <div className="mb-3">
                <Label className="mb-[5px] block text-[11.5px] font-[600] text-muted-foreground">
                  To
                </Label>

                <div className="text-[13px] font-[600] text-foreground">
                  {tradie.phone || "N/A"}
                </div>
              </div>

              <div>
                <Label className="mb-[5px] block text-[11.5px] font-[600] text-muted-foreground">
                  Message
                </Label>

                <Textarea
                  onChange={(e) => setSmsBody(e.target.value)}
                  className={cn(
                    "min-h-[180px] resize-none rounded-[8px] border border-border/70 bg-muted/30 p-3.5",
                    "font-sans text-[12.5px] leading-[1.6] text-foreground",
                  )}
                  value={smsBody}
                />

                <div className="mt-1 text-[11px] text-muted-foreground">
                  {smsBody.length}/160 characters
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="flex-row justify-end gap-2 border-t border-border/70 px-6 py-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-auto rounded-[7px] border-border/70 px-[14px] py-[7px] text-[12.5px] font-[500] text-foreground hover:border-primary hover:bg-muted/40 hover:text-primary"
          >
            Cancel
          </Button>

          <Button
            onClick={onSend}
            className="h-auto rounded-[7px] bg-primary px-[14px] py-[7px] text-[12.5px] font-[600] text-primary-foreground shadow-none transition-all hover:bg-primary/90"
          >
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Send Reminder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
