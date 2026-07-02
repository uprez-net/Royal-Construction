"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LeadEmails } from "@prisma/client";
import { dataTimeFormat } from "@/utils/formatters";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Mail, Reply } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmailComposer } from "./email-composer";

interface LeadEmailSectionProps {
  emails: LeadEmails[];
  leadId: number;
  leadEmail: string;
  projectType: string;
  location: string;
  appendEmailToLead: (leadId: number, email: LeadEmails) => void;
}

const ROYAL_DOMAIN = "@royalconstructions.com.au";


export function LeadEmailSection({
  emails,
  leadId,
  leadEmail,
  projectType,
  location,
  appendEmailToLead,
}: LeadEmailSectionProps) {
  const [replyTarget, setReplyTarget] = useState<LeadEmails | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Chat reads oldest -> newest, top to bottom.
  const orderedEmails = useMemo(
    () =>
      [...emails].sort(
        (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
      ),
    [emails],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [orderedEmails.length]);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b py-3">
        <div className="flex items-center gap-2">
          <Mail className="size-4 text-primary" />
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Messages
          </CardTitle>
        </div>

        <Badge variant="secondary">
          {emails.length} Message{emails.length !== 1 ? "s" : ""}
        </Badge>
      </CardHeader>

      <CardContent className="p-0">
        {orderedEmails.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Mail className="mb-3 size-8 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">
              No emails recorded
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Incoming emails will automatically appear here.
            </p>
          </div>
        ) : (
          <ScrollArea className="h-72 px-4">
            <div className="flex flex-col py-4">
              {orderedEmails.map((email, index) => {
                const isSent = email.emailFrom.includes(ROYAL_DOMAIN);

                return (
                  <div
                    key={`email-${index}-${email.id}`}
                    className="mb-2 last:mb-0"
                  >
                    <div
                      className={cn(
                        "group flex items-end gap-1.5 py-0.5",
                        isSent ? "flex-row-reverse" : "flex-row",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setReplyTarget(email)}
                        aria-label={`Reply to ${email.body.slice(0, 30)}...`}
                        className="mb-1 shrink-0 rounded-full p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                      >
                        <Reply className="size-3.5" />
                      </button>

                      <div
                        className={cn(
                          "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-6",
                          isSent
                            ? "bg-royal-gold text-white rounded-br-sm"
                            : "bg-muted text-foreground rounded-bl-sm",
                        )}
                      >
                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
                          {email.subject}
                        </p>
                        <p className="whitespace-pre-wrap wrap-break-word">
                          {email.body}
                        </p>
                        <p
                          className={cn(
                            "mt-1.5 text-right text-[10px]",
                            isSent ? "text-white/70" : "text-muted-foreground",
                          )}
                        >
                          {dataTimeFormat.format(new Date(email.sentAt))}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}

              <div ref={bottomRef} />
            </div>
          </ScrollArea>
        )}

        <EmailComposer
          leadId={leadId}
          to={leadEmail}
          replyTo={replyTarget}
          onCancelReply={() => setReplyTarget(null)}
          appendEmailToLead={appendEmailToLead}
          projectType={projectType} 
          location={location}
        />
      </CardContent>
    </Card>
  );
}
