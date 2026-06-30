"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Mail, Send, X } from "lucide-react";
import { toast } from "sonner";

import { sendLeadEmail } from "@/lib/data/leads";
import { useLeadsData } from "@/hooks/use-leads-data";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface LeadEmailComposerProps {
  leadId: number;
  to: string;
  title: string;
  defaultSubject?: string;
  defaultBody?: string;
  onSent?: () => void;
}

export function LeadEmailComposer({
  leadId,
  to,
  title,
  defaultSubject = "",
  defaultBody = "",
  onSent,
}: LeadEmailComposerProps) {
  const { appendEmailToLead } = useLeadsData();

  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [sending, startTransition] = useTransition();

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (defaultSubject.trim()) {
      bodyRef.current?.focus();
    } else {
      subjectRef.current?.focus();
    }
  }, [defaultSubject]);

  async function handleSend() {
    if (!subject.trim()) {
      toast.error("Please enter a subject.");
      return;
    }

    if (!body.trim()) {
      toast.error("Please enter a message.");
      return;
    }

    try {
      const email = await sendLeadEmail(
        leadId,
        subject.trim(),
        body.trim(),
        to,
      );

      appendEmailToLead(leadId, email);

      setBody("");

      if (!defaultSubject) {
        setSubject("");
      }

      toast.success("Email sent successfully.");

      onSent?.();
    } catch (error) {
      console.error(error);
      toast.error("Failed to send email.");
    }
  }

  return (
    <Card className="border-dashed bg-background p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Mail className="size-4 text-primary" />
          <h4 className="text-sm font-medium">{title}</h4>
        </div>

        <Button variant="ghost" size="icon" onClick={() => onSent?.()}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>To</Label>

          <Input value={to} readOnly className="bg-muted" />
        </div>

        <div className="space-y-2">
          <Label>Subject</Label>

          <Input
            ref={subjectRef}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Enter subject..."
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Message</Label>

            <span className="text-xs text-muted-foreground">
              {body.length} characters
            </span>
          </div>

          <Textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your email..."
            className="min-h-40 resize-y"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                startTransition(handleSend);
              }
            }}
          />
        </div>

        <div className="flex justify-end">
          <Button
            disabled={sending || !to.trim() || !subject.trim() || !body.trim()}
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
                Send Email
              </>
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}
