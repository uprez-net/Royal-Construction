"use client";

import { useState, useTransition } from "react";
import type { LeadEmails } from "@prisma/client";
import { Mail, Send, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLeadsData } from "@/hooks/use-leads-data";
import { toast } from "sonner";
import { sendLeadEmail } from "@/lib/data/leads";

interface LeadEmailReplyProps {
  email: LeadEmails;
  appendEmailToLead: (leadId: number, email: LeadEmails) => void;
}

export function LeadEmailReply({ email, appendEmailToLead }: LeadEmailReplyProps) {
  const [subject, setSubject] = useState(
    email.subject.startsWith("Re:") ? email.subject : `Re: ${email.subject}`,
  );
  const [body, setBody] = useState("");
  const [sending, startTransition] = useTransition();

  async function handleSend() {
    try {
      const newEmail = await sendLeadEmail(
        email.leadId,
        subject,
        body,
        email.emailFrom,
      );
      setBody("");
      appendEmailToLead(email.leadId, newEmail);
      toast.success("Email sent successfully!");
    } catch (error) {
      console.error("Error sending email:", error);
      toast.error("Failed to send email. Please try again.");
    }
  }

  return (
    <Card className="border-dashed bg-background p-4">
      <div className="mb-4 flex items-center gap-2">
        <Mail className="size-4 text-primary" />

        <h4 className="text-sm font-medium">Reply</h4>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>To</Label>

          <Input disabled value={email.emailFrom} />
        </div>

        <div className="space-y-2">
          <Label>Subject</Label>

          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label>Message</Label>

          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your reply..."
            className="min-h-40 resize-y"
          />
        </div>

        <div className="flex justify-end">
          <Button
            disabled={!body.trim() || sending}
            onClick={() => startTransition(handleSend)}
          >
            {sending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="size-4" />
                Send Reply
              </>
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}
