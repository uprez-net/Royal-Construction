"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Info, Loader2, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  EmailPreviewFrame,
  type EmailPreviewFrameHandle,
} from "@/components/common/email-preview-frame";
import { cn } from "@/lib/utils";
import { TradieScheduleListItem } from "@/types/project";
import { toast } from "sonner";
import { sendTradieScheduleReminder } from "@/lib/data/tradieSchedules";
import { generateTradieReminderEmail } from "@/utils/generate-email";

interface ReminderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: () => void;
  schedule: TradieScheduleListItem;
}

/**
 * Email a booked tradie a reminder, on the same branded template as the
 * outreach they were first sent, previewed and editable in place.
 *
 * The body used to be a plain-text textarea. The mailbox sends every message
 * as HTML, so its line breaks collapsed and the tradie got one run-on
 * paragraph. The SMS tab beside it reported "SMS reminder sent successfully"
 * without sending anything — nothing is wired to send a text — so it is gone
 * until something is.
 */
export function ReminderModal({
  open,
  onOpenChange,
  onSend,
  schedule,
}: ReminderModalProps) {
  const initial = useMemo(
    () => generateTradieReminderEmail(schedule),
    [schedule],
  );
  const previewRef = useRef<EmailPreviewFrameHandle | null>(null);
  const [isSending, startTransition] = useTransition();
  const [emailSubject, setEmailSubject] = useState(initial.subject);

  const recipient = schedule.contact.email.trim();

  const handleSend = async () => {
    try {
      // The action sends to the schedule's own tradie; the address above is
      // only shown. A refusal comes back as data, since Next hides a thrown
      // message in production.
      const body = previewRef.current?.readHtml() ?? initial.html;
      const result = await sendTradieScheduleReminder({
        scheduleId: schedule.id,
        subject: emailSubject,
        body,
      });
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      onSend();
    } catch (error) {
      console.error("Error sending reminder:", error);
      toast.error("Failed to send reminder. Please try again.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-w-[calc(100%-2rem)] gap-0 overflow-hidden rounded-[14px] border border-border/70 bg-card p-0 shadow-2xl sm:max-w-3xl",
          "flex max-h-[90dvh] flex-col",
        )}
      >
        <DialogHeader className="shrink-0 border-b border-border/70 px-6 py-5 text-left">
          <DialogTitle className="text-[18px] font-bold tracking-[-0.02em] text-foreground">
            Send reminder — {schedule.tradieName}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {schedule.projectName} · {schedule.tradeType}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.25 block text-[11.5px] font-semibold text-muted-foreground">
                To
              </Label>
              <div className="text-[13px] font-semibold text-foreground [overflow-wrap:anywhere]">
                {recipient || "No email on file"}
              </div>
            </div>
            <div>
              <Label className="mb-1.25 block text-[11.5px] font-semibold text-muted-foreground">
                Site manager
              </Label>
              <div className="text-[13px] text-muted-foreground">
                {schedule.siteManager.name || "Unassigned"}
              </div>
            </div>
          </div>

          <div>
            <Label
              htmlFor="reminder-subject"
              className="mb-1.25 block text-[11.5px] font-semibold text-muted-foreground"
            >
              Subject
            </Label>
            <Input
              id="reminder-subject"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              className="text-[13px] font-semibold text-foreground"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-[11.5px] font-semibold text-muted-foreground">
                Email
              </Label>
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/80">
                <Info className="size-3" aria-hidden="true" />
                Click the email to edit it before sending.
              </span>
            </div>
            <EmailPreviewFrame
              ref={previewRef}
              // Fit to width: the dialog scrolls, and fitting a long
              // email to a fixed height shrank it to a narrow strip.
              maxHeight={Infinity}
              minScale={0.4}
              html={initial.html}
              title={`Reminder email to ${schedule.tradieName}`}
            />
          </div>
        </div>

        <DialogFooter className="shrink-0 flex-row justify-end gap-2 border-t border-border/70 px-6 py-4">
          <Button
            variant="outline"
            disabled={isSending}
            onClick={() => onOpenChange(false)}
            className="h-auto rounded-[7px] border-border/70 px-3.5 py-1.75 text-[12.5px] font-medium text-foreground hover:border-primary hover:bg-muted/40 hover:text-primary"
          >
            Cancel
          </Button>

          <Button
            disabled={isSending || !recipient || !emailSubject.trim()}
            onClick={() => startTransition(() => handleSend())}
            className="h-auto rounded-[7px] bg-primary px-3.5 py-1.75 text-[12.5px] font-semibold text-primary-foreground shadow-none transition-all hover:bg-primary/90"
          >
            {isSending ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="mr-1.5 h-3.5 w-3.5" />
                Send reminder
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
